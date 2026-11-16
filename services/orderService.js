const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  VoucherType, PromoCode, PromoRedemption, Order, OrderLine, OrderLineBeneficiary,
  Partner, PartnerLedgerEntry, IssuedVoucher, Invoice, Refund, Notification,
  OrderAccessToken, CancellationRequest, User, VoucherHandover,
} = require('../models');
const { AppError } = require('../utils/AppError');
const { assertMillimes, splitVat, randomCode, sha256, parsePage } = require('../utils/money');
const { assertIsoDate, todayTunis, addDays } = require('../utils/dates');
const { runTransaction } = require('../utils/transaction');
const { errorBody } = require('../utils/messages');
const idempotency = require('./idempotencyService');
const settings = require('./settingsService');
const pricing = require('./pricingService');
const quota = require('./quotaService');
const invoices = require('./invoiceService');
const vouchers = require('./voucherService');
const { audit } = require('./auditService');
const { enqueue } = require('./jobQueue');
const { LOCALES } = require('../config/constants');

function actorEmail(user, body) {
  return user?.email || body.guestEmail;
}

function buildGroups(lines) {
  const map = new Map();
  for (const line of lines) {
    if (!mongoose.isValidObjectId(line.voucherTypeId)) {
      throw new AppError(422, 'validation_error', 'Invalid voucher type', [{ field: 'voucherTypeId' }]);
    }
    if (!Array.isArray(line.beneficiaries) || line.beneficiaries.length === 0) {
      throw new AppError(422, 'validation_error', 'At least one beneficiary is required', [{ field: 'beneficiaries' }]);
    }
    for (const beneficiary of line.beneficiaries) {
      if (!beneficiary?.name || typeof beneficiary.name !== 'string') {
        throw new AppError(422, 'validation_error', 'Beneficiary name is required', [{ field: 'beneficiary.name' }]);
      }
      const visitDate = assertIsoDate(beneficiary.visitDate, 'visitDate');
      if (visitDate < todayTunis()) throw new AppError(422, 'validation_error', 'Visit date is in the past', [{ field: 'visitDate' }]);
      const key = `${line.voucherTypeId}|${visitDate}`;
      if (!map.has(key)) map.set(key, { voucherTypeId: line.voucherTypeId, visitDate, names: [] });
      map.get(key).names.push(beneficiary.name.trim());
    }
  }
  return [...map.values()]
    .map((group) => ({ ...group, qty: group.names.length }))
    .sort((a, b) => `${a.voucherTypeId}|${a.visitDate}`.localeCompare(`${b.voucherTypeId}|${b.visitDate}`));
}

async function priceGroups(groups, partner, config) {
  const types = await VoucherType.find({ _id: { $in: groups.map((group) => group.voucherTypeId) }, deletedAt: null, status: 'published', active: true });
  const priced = [];
  let wholesale = false;
  for (const group of groups) {
    const type = types.find((item) => item._id.equals(group.voucherTypeId));
    if (!type) throw new AppError(404, 'not_found', 'Voucher type not found');
    const price = await pricing.resolveUnitPrice(type, partner);
    wholesale = wholesale || price.wholesale;
    const includeVat = price.wholesale ? config.b2bPricesIncludeVat : config.b2cPricesIncludeVat;
    priced.push({ ...group, type, unitPrice: price.unitPrice, pricesIncludeVat: includeVat, gross: price.unitPrice * group.qty });
  }
  return { priced, wholesale };
}

function applyDiscount(priced, discount) {
  const gross = priced.reduce((sum, line) => sum + line.gross, 0);
  let remaining = discount;
  return priced.map((line, index) => {
    const share = index === priced.length - 1 ? remaining : Math.floor((discount * line.gross) / gross);
    remaining -= share;
    const taxable = line.gross - share;
    const vat = splitVat(taxable, line.type.vatRateBps, line.pricesIncludeVat);
    return { ...line, discountAmount: share, ...vat, netAmount: vat.net, vatAmount: vat.vat };
  });
}

async function loadPartner(user) {
  if (!user || user.role !== 'partner') return null;
  return Partner.findOne({ userId: user._id });
}

function assertBuyer(user, body) {
  if (user && ['agent', 'admin', 'station_operator'].includes(user.role)) {
    throw new AppError(403, 'forbidden', 'This account cannot place orders');
  }
  if (!user && !body.guestEmail) throw new AppError(422, 'validation_error', 'guestEmail is required', [{ field: 'guestEmail' }]);
  if (body.guestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.guestEmail)) {
    throw new AppError(422, 'validation_error', 'Invalid email', [{ field: 'guestEmail' }]);
  }
}

async function createOrder({ body, user, idempotencyKey, requestId, locale }) {
  assertBuyer(user, body);
  if (!['sandbox_card', 'agency', 'credit'].includes(body.paymentMode)) {
    throw new AppError(422, 'validation_error', 'Invalid payment mode', [{ field: 'paymentMode' }]);
  }
  const scope = `order.create:${user?._id || String(body.guestEmail || '').toLowerCase()}`;
  const claim = await idempotency.claim(idempotencyKey, scope, body);
  if (!claim.claimed) return { status: claim.existing.statusCode, body: claim.existing.response };
  try {
    const result = await placeOrder({ body, user, requestId, locale, idempotencyKey, scope });
    return result;
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      await idempotency.finishError(idempotencyKey, scope, err.status, errorBody(err, locale));
    } else {
      await idempotency.abandon(idempotencyKey, scope);
    }
    throw err;
  }
}

async function placeOrder({ body, user, requestId, locale, idempotencyKey, scope }) {
  const config = await settings.getMany([
    'onlinePaymentMinutes', 'agencyPaymentHours', 'b2cPricesIncludeVat', 'b2bPricesIncludeVat',
    'stampDutyMillimes', 'maxVouchersPerOrder', 'invoiceSeries',
  ]);
  const groups = buildGroups(body.lines || []);
  const count = groups.reduce((sum, group) => sum + group.qty, 0);
  if (count < 1 || count > config.maxVouchersPerOrder) {
    throw new AppError(422, 'validation_error', 'Voucher count is outside the allowed range');
  }
  const partner = await loadPartner(user);
  if (body.paymentMode === 'credit') {
    if (!partner) throw new AppError(403, 'partner_not_approved', 'Partner account is not approved');
    if (partner.approvalStatus === 'blocked_credit') throw new AppError(409, 'account_blocked', 'Credit is blocked');
    if (partner.approvalStatus !== 'approved') throw new AppError(403, 'partner_not_approved', 'Partner account is not approved');
  }
  if (body.deliverWhatsapp && !body.whatsappPhone) {
    throw new AppError(422, 'validation_error', 'whatsappPhone is required', [{ field: 'whatsappPhone' }]);
  }
  const { priced, wholesale } = await priceGroups(groups, partner, config);
  let promo = null;
  if (body.promoCode) {
    promo = await PromoCode.findOne({ code: String(body.promoCode).toUpperCase() });
    if (!promo) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  }
  const gross = priced.reduce((sum, line) => sum + line.gross, 0);
  const discount = promo ? pricing.quotePromo(promo, gross, {
    wholesale,
    customerType: user?.role === 'partner' ? 'partner' : 'customer',
    voucherTypeIds: priced.map((line) => line.voucherTypeId),
    now: new Date(),
  }) : 0;
  const lines = applyDiscount(priced, discount);
  const subtotal = lines.reduce((sum, line) => sum + line.netAmount, 0);
  const vatTotal = lines.reduce((sum, line) => sum + line.vatAmount, 0);
  const total = subtotal + vatTotal + config.stampDutyMillimes;
  const language = LOCALES.includes(body.language) ? body.language : (user?.language || locale || 'fr');
  const minutes = body.paymentMode === 'agency' ? config.agencyPaymentHours * 60 : config.onlinePaymentMinutes;
  for (const group of groups) await quota.ensureRow(group.voucherTypeId, group.visitDate);
  if (body.paymentMode === 'credit') await invoices.ensureSequence(config.invoiceSeries, Number(todayTunis().slice(0, 4)));

  return runTransaction(async (session) => {
    await quota.reserve(session, groups);
    let promoUserKey;
    if (promo) promoUserKey = await pricing.reservePromo(promo, actorEmail(user, body), session);
    let orderStatus = 'pending_payment';
    let quotaState = 'reserved';
    if (body.paymentMode === 'credit') {
      const updated = await Partner.findOneAndUpdate(
        {
          _id: partner._id,
          approvalStatus: 'approved',
          $expr: { $lte: [{ $add: ['$balance', total] }, '$creditLimit'] },
        },
        { $inc: { balance: total } },
        { session, new: true },
      );
      if (!updated) {
        const current = await Partner.findById(partner._id).session(session);
        if (current?.approvalStatus === 'blocked_credit') throw new AppError(409, 'account_blocked', 'Credit is blocked');
        if (current?.approvalStatus !== 'approved') throw new AppError(403, 'partner_not_approved', 'Partner account is not approved');
        throw new AppError(409, 'credit_limit_exceeded', 'Credit limit would be exceeded');
      }
      orderStatus = 'credit_approved';
      quotaState = 'sold';
    }
    const [order] = await Order.create([{
      userId: user?._id,
      partnerId: partner && wholesale ? partner._id : undefined,
      guestEmail: user ? undefined : String(body.guestEmail).toLowerCase(),
      language,
      subtotal,
      vatTotal,
      discountTotal: discount,
      stampDuty: config.stampDutyMillimes,
      total,
      paymentMode: body.paymentMode,
      priceMode: wholesale ? 'wholesale' : 'public',
      status: orderStatus,
      expiresAt: body.paymentMode === 'credit' ? undefined : new Date(Date.now() + minutes * 60 * 1000),
      paymentCode: body.paymentMode === 'agency' ? randomCode('AG') : undefined,
      orderCode: randomCode('MV'),
      promoCodeId: promo?._id,
      promoUserKey,
      requestId,
      quotaState,
      deliverWhatsapp: Boolean(body.deliverWhatsapp),
      whatsappPhone: body.whatsappPhone,
    }], { session });
    for (const line of lines) {
      const [saved] = await OrderLine.create([{
        orderId: order._id,
        voucherTypeId: line.voucherTypeId,
        quantity: line.qty,
        unitPrice: line.unitPrice,
        visitDate: line.visitDate,
        vatRateBps: line.type.vatRateBps,
        gross: line.gross,
        discountAmount: line.discountAmount,
        netAmount: line.netAmount,
        vatAmount: line.vatAmount,
        total: line.total,
        pricesIncludeVat: line.pricesIncludeVat,
      }], { session });
      await OrderLineBeneficiary.create(line.names.map((name) => ({
        orderId: order._id,
        orderLineId: saved._id,
        beneficiaryName: name,
        visitDate: line.visitDate,
      })), { session, ordered: true });
    }
    let issued = [];
    if (body.paymentMode === 'credit') {
      await quota.moveReservedToSold(session, groups);
      issued = await vouchers.issueForOrder(session, order);
      const invoice = await invoices.issueInvoice(session, order, { partner, paid: false });
      await PartnerLedgerEntry.create([{
        partnerId: partner._id,
        entryType: 'order_debit',
        amount: total,
        orderId: order._id,
        invoiceId: invoice._id,
        createdBy: user._id,
      }], { session });
      if (promo) {
        await PromoRedemption.create([{ promoCodeId: promo._id, orderId: order._id, userId: user._id, discountAmount: discount }], { session });
      }
      order.status = 'fulfilled';
      await order.save({ session });
    }
    await Notification.create([{
      type: 'new_order',
      title: 'New order',
      entity: 'order',
      entityId: order._id,
    }], { session });
    const data = await presentOrder(order, session, issued);
    const response = { success: true, data };
    await idempotency.complete(idempotencyKey, scope, 201, response, session);
    return { status: 201, body: response };
  });
}

async function presentOrder(order, session, issued) {
  const lines = await OrderLine.find({ orderId: order._id }).session(session || null);
  const beneficiaries = await OrderLineBeneficiary.find({ orderId: order._id }).session(session || null);
  const voucherDocs = issued || await IssuedVoucher.find({ orderId: order._id }).session(session || null);
  return {
    id: order._id,
    orderCode: order.orderCode,
    status: order.status,
    paymentMode: order.paymentMode,
    paymentCode: order.paymentCode,
    priceMode: order.priceMode,
    language: order.language,
    currency: order.currency,
    subtotal: order.subtotal,
    vatTotal: order.vatTotal,
    discountTotal: order.discountTotal,
    stampDuty: order.stampDuty,
    total: order.total,
    expiresAt: order.expiresAt,
    lines: lines.map((line) => ({
      id: line._id,
      voucherTypeId: line.voucherTypeId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      visitDate: line.visitDate,
      netAmount: line.netAmount,
      vatAmount: line.vatAmount,
      total: line.total,
      beneficiaries: beneficiaries.filter((item) => item.orderLineId.equals(line._id)).map((item) => item.beneficiaryName),
    })),
    vouchers: voucherDocs.map((voucher) => ({
      id: voucher._id,
      publicId: voucher.publicId,
      beneficiary: voucher.beneficiary,
      visitDate: voucher.visitDate,
      status: voucher.status,
      qrToken: vouchers.tokenFor(voucher.publicId, voucher.visitDate),
    })),
  };
}

async function listMine(user, query) {
  const { page, limit, skip } = parsePage(query);
  const filter = { userId: user._id };
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  const data = [];
  for (const order of rows) data.push(await presentOrder(order));
  return { data, page, limit, total };
}

async function getMine(user, id) {
  const order = await Order.findOne({ _id: id, userId: user._id });
  if (!order) throw new AppError(404, 'not_found', 'Not found');
  return presentOrder(order);
}

async function requestGuestAccess({ orderCode, email }) {
  const order = await Order.findOne({ orderCode, guestEmail: String(email || '').toLowerCase() });
  if (order) {
    const token = crypto.randomBytes(32).toString('hex');
    const latest = await OrderLine.find({ orderId: order._id }).sort({ visitDate: -1 }).limit(1);
    const visit = latest[0]?.visitDate || todayTunis();
    await OrderAccessToken.create({
      orderId: order._id,
      tokenHash: sha256(token),
      expiresAt: new Date(`${addDays(visit, 30)}T23:59:59.000Z`),
    });
    await enqueue(null, [{
      type: 'send_email',
      payload: { template: 'guest_access', orderId: order._id.toString(), token, locale: order.language },
    }]);
  }
  return { success: true, message: 'If the order exists, an email was sent' };
}

async function getByAccessToken(token) {
  const row = await OrderAccessToken.findOne({ tokenHash: sha256(token || '') });
  if (!row || row.expiresAt < new Date()) throw new AppError(404, 'not_found', 'Not found');
  row.lastUsedAt = new Date();
  await row.save();
  const order = await Order.findById(row.orderId);
  if (!order) throw new AppError(404, 'not_found', 'Not found');
  return presentOrder(order);
}

async function requestCancellation(user, orderId, reason) {
  const selfService = await settings.get('customerSelfService');
  if (selfService) throw new AppError(409, 'validation_error', 'Use the cancel endpoint');
  const order = await Order.findOne({ _id: orderId, userId: user._id });
  if (!order) throw new AppError(404, 'not_found', 'Not found');
  if (!reason) throw new AppError(422, 'validation_error', 'reason is required', [{ field: 'reason' }]);
  return CancellationRequest.create({ orderId, userId: user._id, reason });
}

async function groupsFor(order, session) {
  const lines = await OrderLine.find({ orderId: order._id }).session(session);
  return lines.map((line) => ({ voucherTypeId: line.voucherTypeId, visitDate: line.visitDate, qty: line.quantity }))
    .sort((a, b) => `${a.voucherTypeId}|${a.visitDate}`.localeCompare(`${b.voucherTypeId}|${b.visitDate}`));
}

async function cancelOrder({ orderId, actor, reason, refundAmount, idempotencyKey, locale }) {
  if (!reason) throw new AppError(422, 'validation_error', 'reason is required', [{ field: 'reason' }]);
  const scope = `order.cancel:${orderId}`;
  const claim = await idempotency.claim(idempotencyKey, scope, { reason, refundAmount });
  if (!claim.claimed) return { status: claim.existing.statusCode, body: claim.existing.response };
  if (Number.isInteger(refundAmount) && refundAmount > 0) {
    await invoices.ensureSequence(await settings.get('creditNoteSeries'), Number(todayTunis().slice(0, 4)));
  }
  try {
    const result = await runTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError(404, 'not_found', 'Not found');
      if (['cancelled', 'refunded', 'expired', 'failed'].includes(order.status)) {
        throw new AppError(409, 'validation_error', 'Order cannot be cancelled');
      }
      const used = await IssuedVoucher.countDocuments({ orderId, status: 'used' }).session(session);
      if (used) throw new AppError(409, 'already_used', 'A voucher on this order is already used');
      const groups = await groupsFor(order, session);
      if (order.quotaState === 'reserved') await quota.releaseReserved(session, groups);
      if (order.quotaState === 'sold') await quota.releaseSold(session, groups);
      await pricing.releasePromo(order, session);
      await IssuedVoucher.updateMany({ orderId, status: 'issued' }, { $set: { status: 'cancelled' } }, { session });
      let creditNote;
      const paidLike = ['paid', 'credit_approved', 'fulfilled'].includes(order.status);
      if (paidLike) {
        if (!Number.isInteger(refundAmount) || refundAmount < 0 || refundAmount > order.total - order.refundedAmount) {
          throw new AppError(422, 'validation_error', 'refundAmount is required and must not exceed the order total', [{ field: 'refundAmount' }]);
        }
        if (refundAmount > 0) {
          const original = await Invoice.findOne({ orderId, docType: 'invoice' }).session(session);
          creditNote = await invoices.issueCreditNote(session, order, refundAmount, original);
          await Refund.create([{
            orderId,
            creditNoteId: creditNote._id,
            amount: refundAmount,
            method: order.paymentMode === 'credit' ? 'credit' : order.paymentMode === 'sandbox_card' ? 'gateway' : 'manual',
            status: 'completed',
            reason,
            requestedBy: actor._id,
          }], { session });
          order.refundedAmount += refundAmount;
          if (order.partnerId) {
            await Partner.updateOne({ _id: order.partnerId }, { $inc: { balance: -refundAmount } }, { session });
            await PartnerLedgerEntry.create([{
              partnerId: order.partnerId,
              entryType: 'credit_note',
              amount: -refundAmount,
              orderId,
              invoiceId: creditNote._id,
              createdBy: actor._id,
            }], { session });
          }
        }
      }
      order.quotaState = 'released';
      order.status = order.refundedAmount > 0 && order.refundedAmount >= order.total ? 'refunded' : 'cancelled';
      if (order.status === 'refunded') {
        await IssuedVoucher.updateMany({ orderId, status: 'cancelled' }, { $set: { status: 'refunded' } }, { session });
      }
      await order.save({ session });
      await audit({
        userId: actor._id, action: 'order.cancel', entity: 'order', entityId: order._id, session,
        meta: { reason, refundAmount: refundAmount || 0, creditNote: creditNote?.number },
      });
      const response = { success: true, data: await presentOrder(order, session) };
      await idempotency.complete(idempotencyKey, scope, 200, response, session);
      return { status: 200, body: response };
    });
    return result;
  } catch (err) {
    if (err instanceof AppError && err.status < 500) await idempotency.finishError(idempotencyKey, scope, err.status, errorBody(err, locale));
    else await idempotency.abandon(idempotencyKey, scope);
    throw err;
  }
}

async function adminList(query) {
  const { page, limit, skip } = parsePage(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.paymentCode) filter.paymentCode = query.paymentCode;
  const [rows, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(filter),
  ]);
  const data = [];
  for (const order of rows) data.push(await presentOrder(order));
  return { data, page, limit, total };
}

async function adminGet(id) {
  const order = await Order.findById(id);
  if (!order) throw new AppError(404, 'not_found', 'Not found');
  return presentOrder(order);
}

async function fulfillPaid(order, session, actorId) {
  if (order.quotaState !== 'reserved') throw new AppError(409, 'order_expired', 'The reservation is not open');
  const groups = await groupsFor(order, session);
  await quota.moveReservedToSold(session, groups);
  const issued = await vouchers.issueForOrder(session, order);
  const partner = order.partnerId ? await Partner.findById(order.partnerId).session(session) : null;
  await invoices.issueInvoice(session, order, { partner, paid: order.paymentMode !== 'credit' });
  if (order.promoCodeId) {
    await PromoRedemption.create([{
      promoCodeId: order.promoCodeId,
      orderId: order._id,
      userId: order.userId,
      discountAmount: order.discountTotal,
    }], { session });
  }
  order.quotaState = 'sold';
  order.status = 'fulfilled';
  await order.save({ session });
  await audit({ userId: actorId, action: 'order.fulfill', entity: 'order', entityId: order._id, session });
  return issued;
}

async function expireOrders() {
  const due = await Order.find({ status: 'pending_payment', expiresAt: { $lte: new Date() } }).limit(50);
  for (const candidate of due) {
    await runTransaction(async (session) => {
      const order = await Order.findOneAndUpdate(
        { _id: candidate._id, status: 'pending_payment' },
        { $set: { status: 'expired', quotaState: 'released' } },
        { session, new: true },
      );
      if (!order) return;
      await quota.releaseReserved(session, await groupsFor(order, session));
      await pricing.releasePromo(order, session);
    });
  }
}

async function userById(id) {
  return User.findById(id);
}

async function handover({ orderId, voucherId, actor }) {
  const voucher = await IssuedVoucher.findOne({ _id: voucherId, orderId });
  if (!voucher) throw new AppError(404, 'not_found', 'Not found');
  if (!['issued', 'used'].includes(voucher.status)) throw new AppError(409, 'cancelled', 'Voucher cannot be handed over');
  const row = await VoucherHandover.create({
    issuedVoucherId: voucher._id,
    agentId: actor._id,
    handedAt: new Date(),
    channel: 'agency',
  });
  await audit({ userId: actor._id, action: 'voucher.handover', entity: 'issued_voucher', entityId: voucher._id });
  return row;
}

module.exports = {
  createOrder, listMine, getMine, requestGuestAccess, getByAccessToken, requestCancellation,
  cancelOrder, adminList, adminGet, fulfillPaid, expireOrders, presentOrder, groupsFor, userById, handover,
};
