const mongoose = require('mongoose');
const {
  VoucherType, Translation, Availability, PriceGrid, PriceGridPrice, PromoCode,
} = require('../models');
const { AppError } = require('../utils/AppError');
const { assertMillimes } = require('../utils/money');
const { assertIsoDate, todayTunis } = require('../utils/dates');
const { audit } = require('./auditService');
const { LOCALES } = require('../config/constants');

const FIELDS = ['name', 'description', 'conditions'];

async function attachTranslations(docs, locale) {
  const ids = docs.map((doc) => doc._id);
  const rows = await Translation.find({
    entity: 'voucher_type',
    entityId: { $in: ids },
    status: 'published',
    locale: { $in: [locale, 'fr'] },
  });
  return docs.map((doc) => {
    const json = doc.toJSON();
    for (const field of FIELDS) {
      const local = rows.find((row) => row.entityId.equals(doc._id) && row.locale === locale && row.field === field);
      const french = rows.find((row) => row.entityId.equals(doc._id) && row.locale === 'fr' && row.field === field);
      const chosen = local || french;
      json[field] = chosen ? chosen.value : null;
    }
    return json;
  });
}

async function missingLocales(entityId) {
  const rows = await Translation.find({ entity: 'voucher_type', entityId, field: 'name', status: 'published' });
  const present = new Set(rows.map((row) => row.locale));
  return LOCALES.filter((locale) => !present.has(locale));
}

async function writeTranslations(entityId, translations) {
  const ops = [];
  for (const locale of LOCALES) {
    const pack = translations?.[locale];
    if (!pack) continue;
    for (const field of FIELDS) {
      if (typeof pack[field] !== 'string' || !pack[field].trim()) continue;
      ops.push({
        updateOne: {
          filter: { entity: 'voucher_type', entityId, locale, field },
          update: { $set: { value: pack[field].trim(), status: 'published' } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await Translation.bulkWrite(ops);
}

async function listPublic(locale) {
  const docs = await VoucherType.find({ status: 'published', active: true, deletedAt: null }).sort({ createdAt: 1 });
  return attachTranslations(docs, locale);
}

async function getPublic(id, locale) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'not_found', 'Not found');
  const doc = await VoucherType.findOne({ _id: id, status: 'published', active: true, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const [item] = await attachTranslations([doc], locale);
  return item;
}

async function monthAvailability(voucherTypeId, month) {
  if (!/^\d{4}-\d{2}$/.test(month || '')) {
    throw new AppError(422, 'validation_error', 'month must be YYYY-MM', [{ field: 'month' }]);
  }
  await getPublic(voucherTypeId, 'fr');
  const [year, monthNumber] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const prefix = month;
  const rows = await Availability.find({
    voucherTypeId,
    day: { $gte: `${prefix}-01`, $lte: `${prefix}-31` },
  });
  const byDay = new Map(rows.map((row) => [row.day, row]));
  const today = todayTunis();
  const days = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = `${prefix}-${String(day).padStart(2, '0')}`;
    const row = byDay.get(iso);
    const sold = row ? row.sold : 0;
    const reserved = row ? row.reserved : 0;
    const quota = row ? row.quota : null;
    const remaining = quota == null ? null : quota - sold - reserved;
    days.push({
      day: iso,
      available: iso >= today && (remaining == null || remaining > 0),
      remaining,
    });
  }
  return days;
}

async function createVoucherType({ body, userId }) {
  assertMillimes(body.publicPrice, 'publicPrice');
  if (body.wholesalePrice != null) assertMillimes(body.wholesalePrice, 'wholesalePrice');
  if (!Number.isInteger(body.vatRateBps) || body.vatRateBps < 0) {
    throw new AppError(422, 'validation_error', 'vatRateBps is required', [{ field: 'vatRateBps' }]);
  }
  if (!body.slug || !body.duration) throw new AppError(422, 'validation_error', 'slug and duration are required');
  if (!body.translations?.fr?.name) throw new AppError(422, 'validation_error', 'French name is required', [{ field: 'translations.fr.name' }]);
  const doc = await VoucherType.create({
    slug: String(body.slug).trim().toLowerCase(),
    duration: body.duration,
    publicPrice: body.publicPrice,
    wholesalePrice: body.wholesalePrice,
    vatRateBps: body.vatRateBps,
    active: body.active !== false,
    status: 'draft',
  });
  await writeTranslations(doc._id, body.translations);
  await audit({ userId, action: 'voucher_type.create', entity: 'voucher_type', entityId: doc._id });
  return doc;
}

async function updateVoucherType(id, body, userId) {
  const doc = await VoucherType.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  if (body.publicPrice != null) doc.publicPrice = assertMillimes(body.publicPrice, 'publicPrice');
  if (body.wholesalePrice != null) doc.wholesalePrice = assertMillimes(body.wholesalePrice, 'wholesalePrice');
  if (body.vatRateBps != null) doc.vatRateBps = body.vatRateBps;
  if (body.duration != null) doc.duration = body.duration;
  if (body.active != null) doc.active = Boolean(body.active);
  await doc.save();
  if (body.translations) await writeTranslations(doc._id, body.translations);
  await audit({ userId, action: 'voucher_type.update', entity: 'voucher_type', entityId: doc._id, meta: { publicPrice: doc.publicPrice, wholesalePrice: doc.wholesalePrice } });
  return doc;
}

async function publish(id, userId) {
  const doc = await VoucherType.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const french = await Translation.findOne({ entity: 'voucher_type', entityId: id, locale: 'fr', field: 'name', status: 'published' });
  if (!french) throw new AppError(422, 'validation_error', 'French name is required');
  doc.status = 'published';
  await doc.save();
  await audit({ userId, action: 'voucher_type.publish', entity: 'voucher_type', entityId: id });
  return doc;
}

async function removeVoucherType(id, userId) {
  const doc = await VoucherType.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  doc.deletedAt = new Date();
  doc.active = false;
  await doc.save();
  await audit({ userId, action: 'voucher_type.delete', entity: 'voucher_type', entityId: id });
  return doc;
}

async function adminList() {
  const docs = await VoucherType.find({ deletedAt: null }).sort({ createdAt: -1 });
  const translated = await attachTranslations(docs, 'fr');
  return Promise.all(translated.map(async (item) => ({ ...item, missingLocales: await missingLocales(item._id) })));
}

async function setAvailability({ voucherTypeId, day, quota }, userId) {
  assertIsoDate(day, 'day');
  if (quota != null && (!Number.isInteger(quota) || quota < 0)) {
    throw new AppError(422, 'validation_error', 'quota must be a non-negative integer or null', [{ field: 'quota' }]);
  }
  const type = await VoucherType.findOne({ _id: voucherTypeId, deletedAt: null });
  if (!type) throw new AppError(404, 'not_found', 'Not found');
  const existing = await Availability.findOne({ voucherTypeId, day });
  if (existing && quota != null && quota < existing.sold + existing.reserved) {
    throw new AppError(422, 'validation_error', 'quota is below sold and reserved', [{ field: 'quota' }]);
  }
  const row = await Availability.findOneAndUpdate(
    { voucherTypeId, day },
    { $set: { quota }, $setOnInsert: { sold: 0, reserved: 0 } },
    { upsert: true, new: true },
  );
  await audit({ userId, action: 'availability.update', entity: 'availability', entityId: row._id, meta: { day, quota } });
  return row;
}

async function createPriceGrid({ partnerType, name }, userId) {
  if (!['agency', 'hotel', 'reseller'].includes(partnerType) || !name) {
    throw new AppError(422, 'validation_error', 'partnerType and name are required');
  }
  const grid = await PriceGrid.create({ partnerType, name });
  await audit({ userId, action: 'price_grid.create', entity: 'price_grid', entityId: grid._id });
  return grid;
}

async function setGridPrice({ priceGridId, voucherTypeId, unitPrice, validFrom, validTo }, userId) {
  assertMillimes(unitPrice, 'unitPrice');
  const price = await PriceGridPrice.create({ priceGridId, voucherTypeId, unitPrice, validFrom, validTo });
  await audit({ userId, action: 'price_grid.price', entity: 'price_grid', entityId: priceGridId, meta: { voucherTypeId, unitPrice } });
  return price;
}

async function listPriceGrids() {
  return PriceGrid.find().sort({ name: 1 });
}

async function createPromo(body, userId) {
  if (!body.code || !['percent', 'fixed'].includes(body.type)) {
    throw new AppError(422, 'validation_error', 'code and type are required');
  }
  if (body.type === 'percent' && !Number.isInteger(body.amountBps)) {
    throw new AppError(422, 'validation_error', 'amountBps is required', [{ field: 'amountBps' }]);
  }
  if (body.type === 'fixed') assertMillimes(body.amountMillimes, 'amountMillimes');
  const promo = await PromoCode.create({
    code: String(body.code).toUpperCase(),
    type: body.type,
    amountBps: body.amountBps,
    amountMillimes: body.amountMillimes,
    voucherTypeIds: body.voucherTypeIds || [],
    customerTypes: body.customerTypes || [],
    allowWholesale: Boolean(body.allowWholesale),
    startsAt: body.startsAt,
    endsAt: body.endsAt,
    maxUses: body.maxUses,
    maxUsesPerUser: body.maxUsesPerUser,
    active: body.active !== false,
  });
  await audit({ userId, action: 'promo.create', entity: 'promo_code', entityId: promo._id });
  return promo;
}

async function listPromos() {
  return PromoCode.find().sort({ createdAt: -1 });
}

module.exports = {
  listPublic,
  getPublic,
  monthAvailability,
  createVoucherType,
  updateVoucherType,
  publish,
  removeVoucherType,
  adminList,
  setAvailability,
  createPriceGrid,
  setGridPrice,
  listPriceGrids,
  createPromo,
  listPromos,
  attachTranslations,
};
