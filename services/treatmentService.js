const mongoose = require('mongoose');
const { Treatment, Translation } = require('../models');
const { AppError } = require('../utils/AppError');
const { assertMillimes } = require('../utils/money');
const { audit } = require('./auditService');
const { LOCALES } = require('../config/constants');

const CATEGORIES = ['baths', 'showers', 'body', 'wellness'];
const FIELDS = ['name', 'summary', 'description', 'benefits', 'characteristics', 'info'];

function lines(value) {
  return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

async function writeTranslations(entityId, translations) {
  const ops = [];
  for (const locale of LOCALES) {
    const pack = translations?.[locale];
    if (!pack) continue;
    for (const field of FIELDS) {
      if (typeof pack[field] !== 'string') continue;
      const value = pack[field].trim();
      if (!value) continue;
      ops.push({
        updateOne: {
          filter: { entity: 'treatment', entityId, locale, field },
          update: { $set: { value, status: 'published' } },
          upsert: true,
        },
      });
    }
  }
  if (ops.length) await Translation.bulkWrite(ops);
}

function present(doc, rows, locale) {
  const json = doc.toJSON();
  for (const field of FIELDS) {
    const local = rows.find((row) => row.entityId.equals(doc._id) && row.locale === locale && row.field === field);
    const french = rows.find((row) => row.entityId.equals(doc._id) && row.locale === 'fr' && row.field === field);
    const chosen = local || french;
    json[field] = chosen ? chosen.value : '';
  }
  json.benefitLines = lines(json.benefits);
  json.characteristicLines = lines(json.characteristics);
  return json;
}

async function translationsFor(ids) {
  return Translation.find({ entity: 'treatment', entityId: { $in: ids }, status: 'published' });
}

function assertSlug(slug) {
  const value = String(slug || '').trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new AppError(422, 'validation_error', 'slug is invalid', [{ field: 'slug' }]);
  }
  return value;
}

function assertCategory(category) {
  if (!CATEGORIES.includes(category)) {
    throw new AppError(422, 'validation_error', 'category is invalid', [{ field: 'category' }]);
  }
  return category;
}

function assertPrice(value) {
  if (value == null || value === '') return null;
  return assertMillimes(value, 'publicPrice');
}

async function listPublic(locale) {
  const docs = await Treatment.find({ status: 'published', active: true, deletedAt: null }).sort({ featured: -1, createdAt: 1 });
  const rows = await translationsFor(docs.map((doc) => doc._id));
  const language = LOCALES.includes(locale) ? locale : 'fr';
  return docs.map((doc) => present(doc, rows, language));
}

async function getPublicBySlug(slug, locale) {
  const doc = await Treatment.findOne({ slug: String(slug || '').toLowerCase(), status: 'published', active: true, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const rows = await translationsFor([doc._id]);
  const language = LOCALES.includes(locale) ? locale : 'fr';
  return present(doc, rows, language);
}

async function adminList() {
  const docs = await Treatment.find({ deletedAt: null }).sort({ createdAt: -1 });
  const rows = await translationsFor(docs.map((doc) => doc._id));
  return docs.map((doc) => {
    const json = doc.toJSON();
    const translations = {};
    for (const locale of LOCALES) {
      translations[locale] = {};
      for (const field of FIELDS) {
        const row = rows.find((item) => item.entityId.equals(doc._id) && item.locale === locale && item.field === field);
        if (row) translations[locale][field] = row.value;
      }
    }
    json.name = translations.fr?.name || null;
    json.summary = translations.fr?.summary || '';
    json.translations = translations;
    return json;
  });
}

async function createTreatment({ body, userId }) {
  const slug = assertSlug(body.slug);
  const category = assertCategory(body.category);
  if (!body.duration || typeof body.duration !== 'string') {
    throw new AppError(422, 'validation_error', 'duration is required', [{ field: 'duration' }]);
  }
  if (!body.translations?.fr?.name) {
    throw new AppError(422, 'validation_error', 'French name is required', [{ field: 'translations.fr.name' }]);
  }
  try {
    const doc = await Treatment.create({
      slug,
      category,
      duration: body.duration.trim(),
      publicPrice: assertPrice(body.publicPrice),
      featured: Boolean(body.featured),
      active: body.active !== false,
      status: 'draft',
    });
    await writeTranslations(doc._id, body.translations);
    await audit({ userId, action: 'treatment.create', entity: 'treatment', entityId: doc._id });
    return doc;
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'duplicate', 'Slug is already used', [{ field: 'slug' }]);
    throw err;
  }
}

async function updateTreatment(id, body, userId) {
  if (!mongoose.isValidObjectId(id)) throw new AppError(404, 'not_found', 'Not found');
  const doc = await Treatment.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  if (body.category != null) doc.category = assertCategory(body.category);
  if (body.duration != null) doc.duration = String(body.duration).trim();
  if (body.publicPrice !== undefined) doc.publicPrice = assertPrice(body.publicPrice);
  if (body.featured != null) doc.featured = Boolean(body.featured);
  if (body.active != null) doc.active = Boolean(body.active);
  await doc.save();
  if (body.translations) await writeTranslations(doc._id, body.translations);
  await audit({ userId, action: 'treatment.update', entity: 'treatment', entityId: doc._id });
  return doc;
}

async function publish(id, userId) {
  const doc = await Treatment.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  const french = await Translation.findOne({ entity: 'treatment', entityId: id, locale: 'fr', field: 'name', status: 'published' });
  if (!french) throw new AppError(422, 'validation_error', 'French name is required');
  doc.status = 'published';
  await doc.save();
  await audit({ userId, action: 'treatment.publish', entity: 'treatment', entityId: id });
  return doc;
}

async function removeTreatment(id, userId) {
  const doc = await Treatment.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  doc.deletedAt = new Date();
  doc.active = false;
  await doc.save();
  await audit({ userId, action: 'treatment.delete', entity: 'treatment', entityId: id });
  return doc;
}

async function pushPhoto(id, key, userId) {
  const doc = await Treatment.findOne({ _id: id, deletedAt: null });
  if (!doc) throw new AppError(404, 'not_found', 'Not found');
  doc.photos.push(key);
  await doc.save();
  await audit({ userId, action: 'treatment.photo', entity: 'treatment', entityId: id });
  return doc;
}

module.exports = {
  CATEGORIES,
  listPublic,
  getPublicBySlug,
  adminList,
  createTreatment,
  updateTreatment,
  publish,
  removeTreatment,
  pushPhoto,
};
