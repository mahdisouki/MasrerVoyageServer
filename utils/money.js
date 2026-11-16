const crypto = require('crypto');
const { AppError } = require('./AppError');

function assertMillimes(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(422, 'validation_error', `${field} must be a non-negative integer in millimes`, [{ field }]);
  }
  return value;
}

function splitVat(taxable, vatRateBps, pricesIncludeVat) {
  if (pricesIncludeVat) {
    const net = Math.round((taxable * 10000) / (10000 + vatRateBps));
    return { net, vat: taxable - net, total: taxable };
  }
  const vat = Math.round((taxable * vatRateBps) / 10000);
  return { net: taxable, vat, total: taxable + vat };
}

function randomCode(prefix, bytes = 5) {
  return `${prefix}${crypto.randomBytes(bytes).toString('hex').toUpperCase()}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parsePage(query) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

module.exports = { assertMillimes, splitVat, randomCode, sha256, parsePage };
