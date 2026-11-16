const { Setting } = require('../models');
const { AppError } = require('../utils/AppError');
const { audit } = require('./auditService');

const DEFAULTS = {
  onlinePaymentMinutes: 15,
  agencyPaymentHours: 48,
  b2cPricesIncludeVat: true,
  b2bPricesIncludeVat: false,
  stampDutyMillimes: 0,
  customerSelfService: false,
  maxVouchersPerOrder: 500,
  invoiceSeries: 'MV',
  creditNoteSeries: 'AV',
  legalName: '',
  taxId: '',
  address: '',
  vatMention: '',
};

async function ensure() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await Setting.updateOne({ key }, { $setOnInsert: { key, value } }, { upsert: true });
  }
}

async function get(key) {
  const row = await Setting.findOne({ key });
  if (!row) throw new AppError(500, 'settings_missing', `Setting ${key} is missing`);
  return row.value;
}

async function getMany(keys) {
  const rows = await Setting.find({ key: { $in: keys } });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  for (const key of keys) {
    if (!(key in map)) throw new AppError(500, 'settings_missing', `Setting ${key} is missing`);
  }
  return map;
}

async function list() {
  return Setting.find().sort({ key: 1 });
}

async function set(key, value, userId) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new AppError(422, 'validation_error', 'Unknown setting', [{ field: 'key' }]);
  }
  const current = await Setting.findOne({ key });
  if (!current) throw new AppError(500, 'settings_missing', `Setting ${key} is missing`);
  if (typeof value !== typeof current.value) {
    throw new AppError(422, 'validation_error', 'Setting type mismatch', [{ field: 'value' }]);
  }
  current.value = value;
  current.updatedBy = userId;
  await current.save();
  await audit({ userId, action: 'setting.update', entity: 'setting', entityId: key, meta: { value } });
  return current;
}

module.exports = { ensure, get, getMany, list, set, DEFAULTS };
