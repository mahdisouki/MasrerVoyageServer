const crypto = require('crypto');
const { Payment, Order, AgencyPayment, WebhookEvent } = require('../models');
const { AppError } = require('../utils/AppError');
const { randomCode } = require('../utils/money');
const { runTransaction } = require('../utils/transaction');
const { errorBody } = require('../utils/messages');
const idempotency = require('./idempotencyService');
const orders = require('./orderService');
const invoices = require('./invoiceService');
const settings = require('./settingsService');
const { todayTunis } = require('../utils/dates');
const { audit } = require('./auditService');

function signBody(raw) {
  return crypto.createHmac('sha256', process.env.PAYMENT_WEBHOOK_SECRET).update(raw).digest('hex');
}

function assertSignature(raw, signature) {
  const expected = signBody(raw);
  const left = Buffer.from(String(signature || ''));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new AppError(400, 'invalid_signature', 'Signature is not valid');
  }
}

async function createPayment({ orderId, user, email, idempotencyKey, locale }) {
  const scope = `payment.create:${orderId}`;
    const claim = await idempotency.claim(idempotencyKey, scope, { orderId, email });
  if (!claim.claimed) return { status: claim.existing.statusCode, body: claim.existing.response };
  try {
    return await runTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError(404, 'not_found', 'Not found');
      if (order.userId) {
        const owns = user && order.userId.equals(user._id);
        const staff = user && ['admin', 'agent'].includes(user.role);
        if (!owns && !staff) throw new AppError(403, 'forbidden', 'Forbidden');
      } else if (String(email || '').toLowerCase() !== order.guestEmail) {
        throw new AppError(403, 'forbidden', 'Forbidden');
      }
      if (order.paymentMode !== 'sandbox_card') throw new AppError(422, 'validation_error', 'This order is not a card payment');
      if (order.status !== 'pending_payment') throw new AppError(409, 'order_expired', 'The reservation is not awaiting payment');
      if (order.expiresAt && order.expiresAt < new Date()) throw new AppError(409, 'order_expired', 'The reservation has expired');
      const [payment] = await Payment.create([{
        orderId: order._id,
        gateway: 'sandbox',
        reference: randomCode('PAY'),
        amount: order.total,
        status: 'pending',
        idempotencyKey,
      }], { session });
      const response = {
        success: true,
        data: { reference: payment.reference, gateway: 'sandbox', amount: payment.amount, status: payment.status },
      };
      await idempotency.complete(idempotencyKey, scope, 201, response, session);
      return { status: 201, body: response };
    });
  } catch (err) {
    if (err instanceof AppError && err.status < 500) await idempotency.finishError(idempotencyKey, scope, err.status, errorBody(err, locale));
    else await idempotency.abandon(idempotencyKey, scope);
    throw err;
  }
}

async function applyGatewayResult(session, { reference, status }) {
  const payment = await Payment.findOne({ reference }).session(session);
  if (!payment) throw new AppError(404, 'not_found', 'Payment not found');
  if (payment.status !== 'pending') return;
  if (status === 'failed') {
    payment.status = 'failed';
    await payment.save({ session });
    const order = await Order.findOneAndUpdate(
      { _id: payment.orderId, status: 'pending_payment' },
      { $set: { status: 'failed', quotaState: 'released' } },
      { session, new: true },
    );
    if (order) {
      const { releaseReserved } = require('./quotaService');
      const { releasePromo } = require('./pricingService');
      const { groupsFor } = require('./orderService');
      await releaseReserved(session, await groupsFor(order, session));
      await releasePromo(order, session);
    }
    return;
  }
  if (status !== 'succeeded') throw new AppError(422, 'validation_error', 'Unknown payment status');
  const order = await Order.findOneAndUpdate(
    { _id: payment.orderId, status: 'pending_payment' },
    { $set: { status: 'paid' } },
    { session, new: true },
  );
  payment.status = 'succeeded';
  await payment.save({ session });
  if (!order) return;
  await orders.fulfillPaid(order, session);
}

async function handleWebhook({ gateway, raw, signature }) {
  if (gateway !== 'sandbox') throw new AppError(400, 'unknown_gateway', 'Unknown gateway');
  assertSignature(raw, signature);
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new AppError(400, 'validation_error', 'Malformed JSON');
  }
  if (!payload.eventId || !payload.reference || !payload.status) {
    throw new AppError(422, 'validation_error', 'eventId, reference and status are required');
  }
  await invoices.ensureSequence(await settings.get('invoiceSeries'), Number(todayTunis().slice(0, 4)));
  try {
    await runTransaction(async (session) => {
      await WebhookEvent.create([{
        gateway,
        eventId: payload.eventId,
        rawPayload: raw.toString('utf8'),
        status: 'processed',
        processedAt: new Date(),
      }], { session });
      await applyGatewayResult(session, payload);
    });
  } catch (err) {
    if (err.code === 11000) return { success: true, code: 'duplicate', message: 'Already processed' };
    throw err;
  }
  return { success: true };
}

async function recordAgencyPayment({ orderId, actor, method, amount, idempotencyKey, locale }) {
  if (!['cash', 'card'].includes(method)) throw new AppError(422, 'validation_error', 'method must be cash or card', [{ field: 'method' }]);
  const scope = `agency.payment:${orderId}`;
  const claim = await idempotency.claim(idempotencyKey, scope, { method, amount });
  if (!claim.claimed) return { status: claim.existing.statusCode, body: claim.existing.response };
  await invoices.ensureSequence(await settings.get('invoiceSeries'), Number(todayTunis().slice(0, 4)));
  try {
    return await runTransaction(async (session) => {
      const order = await Order.findById(orderId).session(session);
      if (!order) throw new AppError(404, 'not_found', 'Not found');
      if (order.paymentMode !== 'agency' || order.status !== 'pending_payment') {
        throw new AppError(409, 'order_expired', 'The reservation is not awaiting agency payment');
      }
      if (amount !== order.total) throw new AppError(422, 'validation_error', 'amount must equal the order total', [{ field: 'amount' }]);
      await AgencyPayment.create([{
        orderId: order._id,
        paymentCode: order.paymentCode,
        agentId: actor._id,
        method,
        amount,
        recordedAt: new Date(),
      }], { session });
      await Payment.create([{
        orderId: order._id,
        gateway: 'agency',
        reference: randomCode('AGP'),
        amount,
        status: 'succeeded',
        idempotencyKey,
      }], { session });
      order.status = 'paid';
      await orders.fulfillPaid(order, session, actor._id);
      await audit({ userId: actor._id, action: 'agency.payment', entity: 'order', entityId: order._id, session, meta: { method, amount } });
      const response = { success: true, data: await orders.presentOrder(order, session) };
      await idempotency.complete(idempotencyKey, scope, 200, response, session);
      return { status: 200, body: response };
    });
  } catch (err) {
    if (err instanceof AppError && err.status < 500) await idempotency.finishError(idempotencyKey, scope, err.status, errorBody(err, locale));
    else await idempotency.abandon(idempotencyKey, scope);
    throw err;
  }
}

async function reconcilePayments() {
  const pending = await Payment.find({ gateway: 'sandbox', status: 'pending', createdAt: { $lte: new Date(Date.now() - 2 * 60 * 1000) } }).limit(20);
  for (const payment of pending) {
    if (payment.status !== 'pending') throw new AppError(409, 'payment_failed', 'Payment is not pending');
  }
}

module.exports = { createPayment, handleWebhook, recordAgencyPayment, reconcilePayments, signBody };
