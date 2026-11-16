const fs = require('fs/promises');
const path = require('path');
const { asyncHandler } = require('../utils/asyncHandler');
const catalogue = require('../services/catalogueService');
const orders = require('../services/orderService');
const payments = require('../services/paymentService');
const partners = require('../services/partnerService');
const auth = require('../services/authService');
const station = require('../services/stationService');
const stats = require('../services/statsService');
const settings = require('../services/settingsService');
const { ActivityLog, Notification } = require('../models');
const { parsePage } = require('../utils/money');
const { save } = require('../services/pdfService');

const createVoucherType = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await catalogue.createVoucherType({ body: req.body, userId: req.user._id }) });
});
const updateVoucherType = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.updateVoucherType(req.params.id, req.body, req.user._id) });
});
const publishVoucher = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.publish(req.params.id, req.user._id) });
});
const deleteVoucher = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.removeVoucherType(req.params.id, req.user._id) });
});
const listVoucherTypes = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.adminList() });
});
const setAvailability = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.setAvailability(req.body, req.user._id) });
});
const createPriceGrid = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await catalogue.createPriceGrid(req.body, req.user._id) });
});
const listPriceGrids = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.listPriceGrids() });
});
const setGridPrice = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await catalogue.setGridPrice(req.body, req.user._id) });
});
const createPromo = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await catalogue.createPromo(req.body, req.user._id) });
});
const listPromos = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.listPromos() });
});
const photo = asyncHandler(async (req, res) => {
  if (!req.file) {
    const { AppError } = require('../utils/AppError');
    throw new AppError(422, 'validation_error', 'photo is required', [{ field: 'photo' }]);
  }
  const key = path.join('photos', req.file.filename);
  await save(key, await fs.readFile(req.file.path));
  const doc = await catalogue.updateVoucherType(req.params.id, {}, req.user._id);
  doc.photos.push(key);
  await doc.save();
  res.json({ success: true, data: { photo: key } });
});

const listOrders = asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await orders.adminList(req.query)) });
});
const getOrder = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await orders.adminGet(req.params.id) });
});
const cancelOrder = asyncHandler(async (req, res) => {
  const result = await orders.cancelOrder({
    orderId: req.params.id,
    actor: req.user,
    reason: req.body.reason,
    refundAmount: req.body.refundAmount,
    idempotencyKey: req.get('Idempotency-Key'),
    locale: req.locale,
  });
  res.status(result.status).json(result.body);
});
const agencyPayment = asyncHandler(async (req, res) => {
  const result = await payments.recordAgencyPayment({
    orderId: req.params.id,
    actor: req.user,
    method: req.body.method,
    amount: req.body.amount,
    idempotencyKey: req.get('Idempotency-Key'),
    locale: req.locale,
  });
  res.status(result.status).json(result.body);
});
const handover = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await orders.handover({ orderId: req.params.id, voucherId: req.body.voucherId, actor: req.user }) });
});
const markOffline = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await station.markUsedOffline(req.body.publicIds, req.user) });
});

const listPartners = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.listPartners() });
});
const approvePartner = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.approve(req.params.id, req.body, req.user) });
});
const setCredit = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.setCredit(req.params.id, req.body, req.user) });
});
const partnerPayment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await partners.recordPayment(req.params.id, req.body.amount, req.user) });
});

const createUser = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await auth.createStaff(req.body, req.user._id) });
});
const listUsers = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await auth.listUsers() });
});
const updateUser = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await auth.updateUser(req.params.id, req.body, req.user._id) });
});

const getStats = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await stats.summary() });
});
const auditLog = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePage(req.query);
  const [data, total] = await Promise.all([
    ActivityLog.find().sort({ at: -1 }).skip(skip).limit(limit),
    ActivityLog.countDocuments(),
  ]);
  res.json({ success: true, data, page, limit, total });
});
const notifications = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await Notification.find().sort({ createdAt: -1 }).limit(50) });
});
const listSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settings.list() });
});
const updateSetting = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await settings.set(req.body.key, req.body.value, req.user._id) });
});

module.exports = {
  createVoucherType, updateVoucherType, publishVoucher, deleteVoucher, listVoucherTypes, setAvailability,
  createPriceGrid, listPriceGrids, setGridPrice, createPromo, listPromos, photo,
  listOrders, getOrder, cancelOrder, agencyPayment, handover, markOffline,
  listPartners, approvePartner, setCredit, partnerPayment,
  createUser, listUsers, updateUser, getStats, auditLog, notifications, listSettings, updateSetting,
};
