const crypto = require('crypto');
const { IdempotencyRecord } = require('../models');
const { AppError } = require('../utils/AppError');

function hashBody(body) {
  return crypto.createHash('sha256').update(JSON.stringify(body || {})).digest('hex');
}

async function claim(key, scope, body) {
  if (!key) throw new AppError(422, 'validation_error', 'Idempotency-Key is required', [{ field: 'Idempotency-Key' }]);
  const requestHash = hashBody(body);
  try {
    await IdempotencyRecord.create({ key, scope, requestHash, status: 'processing' });
    return { claimed: true, key, scope };
  } catch (err) {
    if (err.code !== 11000) throw err;
    const existing = await IdempotencyRecord.findOne({ key, scope });
    if (!existing) throw new AppError(409, 'request_in_progress', 'Request is still being processed');
    if (existing.requestHash !== requestHash) {
      throw new AppError(422, 'idempotency_conflict', 'Idempotency-Key reused with a different request');
    }
    if (existing.status !== 'completed' || !existing.response) {
      throw new AppError(409, 'request_in_progress', 'Request is still being processed');
    }
    return { claimed: false, existing };
  }
}

async function complete(key, scope, statusCode, response, session) {
  const updated = await IdempotencyRecord.updateOne(
    { key, scope, status: 'processing' },
    { $set: { status: 'completed', statusCode, response } },
    { session },
  );
  if (updated.matchedCount !== 1) {
    throw new AppError(409, 'request_in_progress', 'Request is still being processed');
  }
}

async function finishError(key, scope, statusCode, response) {
  await IdempotencyRecord.updateOne(
    { key, scope, status: 'processing' },
    { $set: { status: 'completed', statusCode, response } },
  );
}

async function abandon(key, scope) {
  await IdempotencyRecord.deleteOne({ key, scope, status: 'processing' });
}

module.exports = { claim, complete, finishError, abandon };
