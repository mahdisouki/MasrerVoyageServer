const fs = require('fs/promises');
const path = require('path');
const { asyncHandler } = require('../utils/asyncHandler');
const catalogue = require('../services/catalogueService');
const treatments = require('../services/treatmentService');
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
const listAvailability = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.adminMonthAvailability(req.query.voucherTypeId, req.query.month) });
});
const blockDay = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.setDayBlock(req.body, req.user._id) });
});
const setMonthQuota = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await catalogue.setMonthQuota(req.body, req.user._id) });
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
const deletePhoto = asyncHandler(async (req, res) => {
  const { AppError } = require('../utils/AppError');
  const { resolveStorage } = require('../services/pdfService');
  const raw = typeof req.body?.photo === 'string' ? req.body.photo : '';
  const normalized = raw.replace(/\\/g, '/').trim();
  if (!normalized || normalized.includes('..') || !normalized.startsWith('photos/')) {
    throw new AppError(422, 'validation_error', 'photo is required', [{ field: 'photo' }]);
  }
  const doc = await catalogue.updateVoucherType(req.params.id, {}, req.user._id);
  const before = Array.isArray(doc.photos) ? doc.photos.length : 0;
  doc.photos = (doc.photos || []).filter((entry) => String(entry).replace(/\\/g, '/') !== normalized);
  if (doc.photos.length === before) {
    throw new AppError(404, 'not_found', 'Photo not found');
  }
  await doc.save();
  try {
    await fs.unlink(resolveStorage(normalized));
  } catch {
    // file may already be missing on disk
  }
  res.json({ success: true, data: { photos: doc.photos } });
});
const servePhoto = asyncHandler(async (req, res) => {
  const { AppError } = require('../utils/AppError');
  const { resolveStorage } = require('../services/pdfService');
  const { VoucherType } = require('../models');
  const doc = await VoucherType.findOne({ _id: req.params.id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) {
    throw new AppError(404, 'not_found', 'Not found');
  }
  const key = Array.isArray(doc.photos) ? doc.photos[index] : null;
  const normalized = typeof key === 'string' ? key.replace(/\\/g, '/') : '';
  if (!normalized || normalized.includes('..') || !normalized.startsWith('photos/')) {
    throw new AppError(404, 'not_found', 'Not found');
  }
  res.sendFile(resolveStorage(normalized));
});

const listTreatments = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await treatments.adminList() });
});
const createTreatment = asyncHandler(async (req, res) => {
  res.status(201).json({ success: true, data: await treatments.createTreatment({ body: req.body, userId: req.user._id }) });
});
const updateTreatment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await treatments.updateTreatment(req.params.id, req.body, req.user._id) });
});
const publishTreatment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await treatments.publish(req.params.id, req.user._id) });
});
const deleteTreatment = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await treatments.removeTreatment(req.params.id, req.user._id) });
});
const treatmentPhotoUpload = asyncHandler(async (req, res) => {
  if (!req.file) {
    const { AppError } = require('../utils/AppError');
    throw new AppError(422, 'validation_error', 'photo is required', [{ field: 'photo' }]);
  }
  const key = path.join('photos', req.file.filename);
  await save(key, await fs.readFile(req.file.path));
  await treatments.pushPhoto(req.params.id, key, req.user._id);
  res.json({ success: true, data: { photo: key } });
});
const serveTreatmentPhoto = asyncHandler(async (req, res) => {
  const { AppError } = require('../utils/AppError');
  const { resolveStorage } = require('../services/pdfService');
  const { Treatment } = require('../models');
  const doc = await Treatment.findOne({ _id: req.params.id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const index = Number(req.params.index);
  const key = Array.isArray(doc.photos) ? doc.photos[index] : null;
  const normalized = typeof key === 'string' ? key.replace(/\\/g, '/') : '';
  if (!normalized || normalized.includes('..') || !normalized.startsWith('photos/')) {
    throw new AppError(404, 'not_found', 'Not found');
  }
  res.sendFile(resolveStorage(normalized));
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
  const [rows, total] = await Promise.all([
    ActivityLog.find().sort({ at: -1 }).skip(skip).limit(limit).populate('userId', 'email firstName lastName'),
    ActivityLog.countDocuments(),
  ]);
  const data = rows.map((row) => {
    const json = row.toJSON();
    const user = row.userId && typeof row.userId === 'object' ? row.userId : null;
    return {
      ...json,
      userId: user?._id || row.userId || null,
      userEmail: user?.email || null,
      userName: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') || null : null,
    };
  });
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
  createVoucherType, updateVoucherType, publishVoucher, deleteVoucher, listVoucherTypes, listAvailability, setAvailability, setMonthQuota, blockDay,
  createPriceGrid, listPriceGrids, setGridPrice, createPromo, listPromos, photo, deletePhoto, servePhoto,
  listTreatments, createTreatment, updateTreatment, publishTreatment, deleteTreatment, treatmentPhotoUpload, serveTreatmentPhoto,
  listOrders, getOrder, cancelOrder, agencyPayment, handover, markOffline,
  listPartners, approvePartner, setCredit, partnerPayment,
  createUser, listUsers, updateUser, getStats, auditLog, notifications, listSettings, updateSetting,
};
