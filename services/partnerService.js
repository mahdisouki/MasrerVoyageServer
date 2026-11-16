const fs = require('fs/promises');
const path = require('path');
const {
  User, Partner, PartnerDocument, PartnerLedgerEntry, Invoice, IssuedVoucher, Order, Notification,
} = require('../models');
const { AppError } = require('../utils/AppError');
const { assertMillimes } = require('../utils/money');
const { todayTunis } = require('../utils/dates');
const { runTransaction } = require('../utils/transaction');
const { audit } = require('./auditService');
const auth = require('./authService');
const catalogue = require('./catalogueService');
const { enqueue } = require('./jobQueue');

async function register(body, files) {
  if (!files?.length) throw new AppError(422, 'validation_error', 'A supporting document is required', [{ field: 'documents' }]);
  if (!body.businessName || !body.taxId || !['agency', 'hotel', 'reseller'].includes(body.partnerType)) {
    throw new AppError(422, 'validation_error', 'businessName, taxId and partnerType are required');
  }
  const email = auth.assertEmail(body.email);
  if (typeof body.password !== 'string' || body.password.length < 8) {
    throw new AppError(422, 'validation_error', 'Password must be at least 8 characters', [{ field: 'password' }]);
  }
  const bcrypt = require('bcrypt');
  const rounds = process.env.NODE_ENV === 'test' ? 4 : 12;
  const user = await User.create({
    email,
    passwordHash: await bcrypt.hash(body.password, rounds),
    role: 'partner',
    firstName: body.contactName || '',
    phone: body.phone || '',
    language: body.language || 'fr',
  }).catch((err) => {
    if (err.code === 11000) throw new AppError(409, 'duplicate', 'Email is already registered', [{ field: 'email' }]);
    throw err;
  });
  const partner = await Partner.create({
    userId: user._id,
    businessName: body.businessName,
    taxId: body.taxId,
    partnerType: body.partnerType,
    phone: body.phone || '',
    contactName: body.contactName || '',
    approvalStatus: 'pending',
  });
  const dir = path.join(process.env.STORAGE_DIR, 'partner-docs', partner._id.toString());
  await fs.mkdir(dir, { recursive: true });
  for (const file of files) {
    const storageKey = `partner-docs/${partner._id}/${file.filename}`;
    await fs.rename(file.path, path.join(process.env.STORAGE_DIR, storageKey));
    await PartnerDocument.create({ partnerId: partner._id, docType: body.docType || 'registration', storageKey });
  }
  await Notification.create({ type: 'partner_pending', title: 'Partner awaiting approval', entity: 'partner', entityId: partner._id });
  return { partner, user: auth.publicUser(user) };
}

async function requirePartner(user) {
  const partner = await Partner.findOne({ userId: user._id });
  if (!partner) throw new AppError(403, 'partner_not_approved', 'Partner account is not approved');
  if (partner.approvalStatus === 'blocked_credit') throw new AppError(409, 'account_blocked', 'Credit is blocked');
  if (partner.approvalStatus !== 'approved') throw new AppError(403, 'partner_not_approved', 'Partner account is not approved');
  return partner;
}

async function listWholesale(user, locale) {
  const partner = await requirePartner(user);
  const items = await catalogue.listPublic(locale);
  const { PriceGridPrice, VoucherType } = require('../models');
  const prices = partner.priceGridId
    ? await PriceGridPrice.find({ priceGridId: partner.priceGridId })
    : [];
  return Promise.all(items.map(async (item) => {
    const grid = prices.find((price) => String(price.voucherTypeId) === String(item._id || item.id));
    const type = await VoucherType.findById(item._id || item.id);
    return { ...item, wholesalePrice: grid ? grid.unitPrice : type.wholesalePrice };
  }));
}

async function approve(id, body, actor) {
  const partner = await Partner.findById(id);
  if (!partner) throw new AppError(404, 'not_found', 'Not found');
  if (!['approved', 'rejected', 'suspended'].includes(body.approvalStatus)) {
    throw new AppError(422, 'validation_error', 'approvalStatus is invalid', [{ field: 'approvalStatus' }]);
  }
  if (body.approvalStatus === 'approved') {
    if (!Number.isInteger(body.creditLimit) || body.creditLimit < 0) {
      throw new AppError(422, 'validation_error', 'creditLimit is required', [{ field: 'creditLimit' }]);
    }
    if (!Number.isInteger(body.paymentDays) || body.paymentDays < 0) {
      throw new AppError(422, 'validation_error', 'paymentDays is required', [{ field: 'paymentDays' }]);
    }
    partner.creditLimit = body.creditLimit;
    partner.paymentDays = body.paymentDays;
    if (body.priceGridId) partner.priceGridId = body.priceGridId;
  }
  partner.approvalStatus = body.approvalStatus;
  partner.blockedReason = undefined;
  partner.blockedAt = undefined;
  await partner.save();
  await audit({ userId: actor._id, action: 'partner.approval', entity: 'partner', entityId: partner._id, meta: { approvalStatus: partner.approvalStatus, creditLimit: partner.creditLimit } });
  return partner;
}

async function setCredit(id, body, actor) {
  const partner = await Partner.findById(id);
  if (!partner) throw new AppError(404, 'not_found', 'Not found');
  partner.creditLimit = assertMillimes(body.creditLimit, 'creditLimit');
  if (body.paymentDays != null) partner.paymentDays = body.paymentDays;
  await partner.save();
  await audit({ userId: actor._id, action: 'partner.credit', entity: 'partner', entityId: partner._id, meta: { creditLimit: partner.creditLimit } });
  return partner;
}

async function dashboard(user) {
  const partner = await requirePartner(user);
  const [unpaidInvoices, issued, used] = await Promise.all([
    Invoice.countDocuments({ partnerId: partner._id, docType: 'invoice', paidAt: null }),
    IssuedVoucher.countDocuments({ orderId: { $in: await orderIds(partner._id) } }),
    IssuedVoucher.countDocuments({ orderId: { $in: await orderIds(partner._id) }, status: 'used' }),
  ]);
  return {
    balance: partner.balance,
    creditLimit: partner.creditLimit,
    approvalStatus: partner.approvalStatus,
    paymentDays: partner.paymentDays,
    unpaidInvoices,
    vouchersIssued: issued,
    vouchersUsed: used,
  };
}

async function orderIds(partnerId) {
  const rows = await Order.find({ partnerId }).select('_id');
  return rows.map((row) => row._id);
}

async function statement(user, query) {
  const partner = await requirePartner(user);
  const filter = { partnerId: partner._id };
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }
  const entries = await PartnerLedgerEntry.find(filter).sort({ createdAt: 1 });
  const opening = entries.length ? partner.balance - entries.reduce((sum, entry) => sum + entry.amount, 0) : partner.balance;
  return { opening, closing: partner.balance, entries };
}

async function exportOrders(user) {
  const partner = await requirePartner(user);
  const rows = await Order.find({ partnerId: partner._id }).sort({ createdAt: -1 });
  const header = ['orderId', 'date', 'status', 'total', 'paymentMode'];
  const lines = rows.map((order) => [order._id, order.createdAt.toISOString(), order.status, order.total, order.paymentMode].join(','));
  return [header.join(','), ...lines].join('\n');
}

async function recordPayment(id, amount, actor) {
  assertMillimes(amount, 'amount');
  if (amount < 1) throw new AppError(422, 'validation_error', 'amount must be positive', [{ field: 'amount' }]);
  return runTransaction(async (session) => {
    const partner = await Partner.findById(id).session(session);
    if (!partner) throw new AppError(404, 'not_found', 'Not found');
    let remaining = amount;
    const invoices = await Invoice.find({ partnerId: id, docType: 'invoice', paidAt: null }).sort({ dueDate: 1 }).session(session);
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const due = invoice.total - invoice.paidAmount;
      const pay = Math.min(due, remaining);
      invoice.paidAmount += pay;
      if (invoice.paidAmount === invoice.total) invoice.paidAt = new Date();
      await invoice.save({ session });
      remaining -= pay;
    }
    if (remaining > 0) throw new AppError(422, 'validation_error', 'Amount exceeds unpaid invoices');
    await Partner.updateOne({ _id: id }, { $inc: { balance: -amount } }, { session });
    await PartnerLedgerEntry.create([{
      partnerId: id,
      entryType: 'payment_credit',
      amount: -amount,
      createdBy: actor._id,
    }], { session });
    const overdue = await Invoice.countDocuments({
      partnerId: id,
      docType: 'invoice',
      paidAt: null,
      dueDate: { $lt: todayTunis() },
    }).session(session);
    if (overdue === 0 && partner.approvalStatus === 'blocked_credit') {
      await Partner.updateOne(
        { _id: id },
        { $set: { approvalStatus: 'approved' }, $unset: { blockedReason: '', blockedAt: '' } },
        { session },
      );
    }
    await audit({ userId: actor._id, action: 'partner.payment', entity: 'partner', entityId: id, session, meta: { amount } });
    return { amount, overdue };
  });
}

async function creditChecks() {
  const today = todayTunis();
  const overdue = await Invoice.find({ docType: 'invoice', paidAt: null, partnerId: { $ne: null }, dueDate: { $lt: today } });
  const partnerIds = [...new Set(overdue.map((invoice) => String(invoice.partnerId)))];
  for (const partnerId of partnerIds) {
    const partner = await Partner.findById(partnerId);
    if (!partner) continue;
    if (partner.approvalStatus === 'approved') {
      partner.approvalStatus = 'blocked_credit';
      partner.blockedReason = 'overdue_invoice';
      partner.blockedAt = new Date();
      await partner.save();
    }
    const invoice = overdue.find((item) => String(item.partnerId) === partnerId);
    const { NotificationLog } = require('../models');
    const already = await NotificationLog.findOne({
      template: 'payment_reminder',
      entityId: invoice._id,
      sentAt: { $gte: new Date(`${today}T00:00:00.000Z`) },
    });
    if (!already) {
      const user = await User.findById(partner.userId);
      await enqueue(null, [{
        type: 'send_email',
        payload: { template: 'payment_reminder', orderId: invoice.orderId.toString(), locale: user?.language || 'fr' },
      }]);
    }
  }
}

async function auditBalances() {
  const sums = await PartnerLedgerEntry.aggregate([{ $group: { _id: '$partnerId', sum: { $sum: '$amount' } } }]);
  for (const row of sums) {
    const partner = await Partner.findById(row._id);
    if (partner && partner.balance !== row.sum) {
      const existing = await Notification.findOne({ type: 'ledger_mismatch', entityId: partner._id, readAt: null });
      if (!existing) {
        await Notification.create({
          type: 'ledger_mismatch',
          title: 'Ledger balance mismatch',
          body: `balance ${partner.balance} ledger ${row.sum}`,
          entity: 'partner',
          entityId: partner._id,
        });
      }
    }
  }
}

async function listPartners() {
  return Partner.find().sort({ createdAt: -1 });
}

module.exports = {
  register, requirePartner, listWholesale, approve, setCredit, dashboard,
  statement, exportOrders, recordPayment, creditChecks, auditBalances, listPartners,
};
