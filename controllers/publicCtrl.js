const { asyncHandler } = require('../utils/asyncHandler');
const catalogue = require('../services/catalogueService');
const orders = require('../services/orderService');
const payments = require('../services/paymentService');
const vouchers = require('../services/voucherService');
const { Invoice } = require('../models');
const { AppError } = require('../utils/AppError');
const { read } = require('../services/pdfService');

const listVouchers = asyncHandler(async (req, res) => {
  const data = await catalogue.listPublic(req.locale);
  res.json({ success: true, data });
});

const getVoucher = asyncHandler(async (req, res) => {
  const data = await catalogue.getPublic(req.params.id, req.locale);
  res.json({ success: true, data });
});

const availability = asyncHandler(async (req, res) => {
  const data = await catalogue.monthAvailability(req.params.id, req.query.month);
  res.json({ success: true, data });
});

const createOrder = asyncHandler(async (req, res) => {
  const result = await orders.createOrder({
    body: req.body,
    user: req.user,
    idempotencyKey: req.get('Idempotency-Key'),
    requestId: req.id,
    locale: req.locale,
  });
  res.status(result.status).json(result.body);
});

const listOrders = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await orders.listMine(req.user, req.query)) });
});

const getOrder = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orders.getMine(req.user, req.params.id) });
});

const guestAccess = asyncHandler(async (req, res) => {
  res.json(await orders.requestGuestAccess(req.body));
});

const byToken = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orders.getByAccessToken(req.params.token) });
});

const cancellationRequest = asyncHandler(async (req, res) => {
  const data = await orders.requestCancellation(req.user, req.params.id, req.body.reason);
  res.status(201).json({ success: true, data });
});

const createPayment = asyncHandler(async (req, res) => {
  const result = await payments.createPayment({
    orderId: req.params.id,
    user: req.user,
    email: req.body.email,
    idempotencyKey: req.get('Idempotency-Key'),
    locale: req.locale,
  });
  res.status(result.status).json(result.body);
});

const myVouchers = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await vouchers.listForUser(req.user._id) });
});

const resendVoucher = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await vouchers.resend(req.params.id, req.user) });
});

const voucherPdf = asyncHandler(async (req, res) => {
  const { voucher } = await vouchers.assertOwner(req.params.id, req.user);
  if (!voucher.pdfKey) throw new AppError(409, 'pdf_not_ready', 'PDF is not ready');
  const file = await read(voucher.pdfKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.send(file);
});

const myInvoices = asyncHandler(async (req, res) => {
  const mine = await orders.listMine(req.user, { page: 1, limit: 100 });
  const ids = mine.data.map((order) => order.id);
  const data = await Invoice.find({ orderId: { $in: ids } }).sort({ createdAt: -1 });
  res.json({ success: true, data });
});

const invoicePdf = asyncHandler(async (req, res) => {
  const { Invoice, Order } = require('../models');
  const invoice = await Invoice.findById(req.params.id);
  if (!invoice) throw new AppError(404, 'not_found', 'Not found');
  const order = await Order.findById(invoice.orderId);
  const staff = ['admin', 'agent'].includes(req.user.role);
  const owner = order?.userId && order.userId.equals(req.user._id);
  if (!staff && !owner) throw new AppError(403, 'forbidden', 'Forbidden');
  if (!invoice.pdfKey) throw new AppError(409, 'pdf_not_ready', 'PDF is not ready');
  const file = await read(invoice.pdfKey);
  res.setHeader('Content-Type', 'application/pdf');
  res.send(file);
});

module.exports = {
  listVouchers, getVoucher, availability, createOrder, listOrders, getOrder, guestAccess, byToken,
  cancellationRequest, createPayment, myVouchers, resendVoucher, voucherPdf, myInvoices, invoicePdf,
};
