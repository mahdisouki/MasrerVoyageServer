const crypto = require('crypto');
const {
  IssuedVoucher, OrderLine, OrderLineBeneficiary, Order, VoucherType,
} = require('../models');
const { AppError } = require('../utils/AppError');
const { enqueue } = require('./jobQueue');
const { addDays, tunisLocalToUtc, todayTunis } = require('../utils/dates');

function signVoucher(publicId, visitDate) {
  return crypto.createHmac('sha256', process.env.QR_SECRET_V1).update(`${publicId}.${visitDate}`).digest('hex');
}

function tokenFor(publicId, visitDate) {
  return `v1.${publicId}.${signVoucher(publicId, visitDate)}`;
}

function signaturesMatch(publicId, visitDate, signature) {
  const expected = signVoucher(publicId, visitDate);
  const left = Buffer.from(String(signature));
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function issueForOrder(session, order) {
  const lines = await OrderLine.find({ orderId: order._id }).session(session);
  const beneficiaries = await OrderLineBeneficiary.find({ orderId: order._id }).session(session);
  const created = [];
  for (const beneficiary of beneficiaries) {
    const line = lines.find((item) => item._id.equals(beneficiary.orderLineId));
    const publicId = crypto.randomBytes(9).toString('base64url');
    const qrSignature = signVoucher(publicId, beneficiary.visitDate);
    const [voucher] = await IssuedVoucher.create([{
      publicId,
      orderId: order._id,
      orderLineId: line._id,
      beneficiaryId: beneficiary._id,
      voucherTypeId: line.voucherTypeId,
      beneficiary: beneficiary.beneficiaryName,
      visitDate: beneficiary.visitDate,
      qrSignature,
      status: 'issued',
    }], { session });
    created.push(voucher);
  }
  const dates = [...new Set(created.map((voucher) => voucher.visitDate))];
  const jobs = [{ type: 'generate_pdf', payload: { orderId: order._id.toString() } }];
  for (const visitDate of dates) {
    const runAt = tunisLocalToUtc(addDays(visitDate, -1), 9, 0);
    if (runAt > new Date()) {
      jobs.push({ type: 'visit_reminder', payload: { orderId: order._id.toString(), visitDate }, runAt });
    }
  }
  await enqueue(session, jobs);
  return created;
}

async function presentOwned(vouchers) {
  const types = await VoucherType.find({ _id: { $in: vouchers.map((voucher) => voucher.voucherTypeId) } });
  return vouchers.map((voucher) => ({
    id: voucher._id,
    publicId: voucher.publicId,
    status: voucher.status,
    beneficiary: voucher.beneficiary,
    visitDate: voucher.visitDate,
    qrToken: tokenFor(voucher.publicId, voucher.visitDate),
    pdfReady: Boolean(voucher.pdfKey),
    voucherTypeId: voucher.voucherTypeId,
    duration: types.find((type) => type._id.equals(voucher.voucherTypeId))?.duration,
  }));
}

async function listForUser(userId) {
  const orders = await Order.find({ userId, status: { $in: ['paid', 'credit_approved', 'fulfilled', 'cancelled', 'refunded'] } });
  const vouchers = await IssuedVoucher.find({ orderId: { $in: orders.map((order) => order._id) } }).sort({ visitDate: 1 });
  return presentOwned(vouchers);
}

async function listForOrder(orderId) {
  const vouchers = await IssuedVoucher.find({ orderId }).sort({ visitDate: 1 });
  return presentOwned(vouchers);
}

async function assertOwner(voucherId, user) {
  const voucher = await IssuedVoucher.findById(voucherId);
  if (!voucher) throw new AppError(404, 'not_found', 'Not found');
  const order = await Order.findById(voucher.orderId);
  const staff = user && ['admin', 'agent'].includes(user.role);
  if (!staff && (!user || !order.userId || !order.userId.equals(user._id))) {
    throw new AppError(403, 'forbidden', 'Forbidden');
  }
  return { voucher, order };
}

async function resend(voucherId, user) {
  const { voucher } = await assertOwner(voucherId, user);
  voucher.lastResentAt = new Date();
  await voucher.save();
  await enqueue(null, [{ type: 'send_email', payload: { template: 'voucher', orderId: voucher.orderId.toString() } }]);
  return { queued: true };
}

async function expireVouchers() {
  const today = todayTunis();
  await IssuedVoucher.updateMany(
    { status: 'issued', visitDate: { $lt: today } },
    { $set: { status: 'expired' } },
  );
}

module.exports = {
  signVoucher, tokenFor, signaturesMatch, issueForOrder, presentOwned,
  listForUser, listForOrder, assertOwner, resend, expireVouchers,
};
