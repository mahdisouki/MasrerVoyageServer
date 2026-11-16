const { IssuedVoucher, ScanLog, User, VoucherType } = require('../models');
const { AppError } = require('../utils/AppError');
const { todayTunis } = require('../utils/dates');
const { runTransaction } = require('../utils/transaction');
const vouchers = require('./voucherService');
const { audit } = require('./auditService');

function scanReason(voucher, today) {
  if (!voucher) return 'not_found';
  if (voucher.status === 'used') return 'already_used';
  if (voucher.status === 'cancelled' || voucher.status === 'refunded') return 'cancelled';
  if (voucher.status === 'expired' || voucher.visitDate < today) return 'expired';
  if (voucher.visitDate !== today) return 'wrong_date';
  return 'not_found';
}

async function logScan(fields) {
  await ScanLog.create({ scannedAt: new Date(), ...fields });
}

async function describe(voucher, code) {
  let operatorEmail;
  if (code === 'already_used' && voucher.usedBy) {
    const operator = await User.findById(voucher.usedBy);
    operatorEmail = operator?.email;
  }
  const type = await VoucherType.findById(voucher.voucherTypeId);
  return {
    code,
    publicId: voucher.publicId,
    beneficiary: voucher.beneficiary,
    visitDate: voucher.visitDate,
    voucherType: type?.duration,
    usedAt: voucher.usedAt,
    operatorEmail,
  };
}

async function consume(voucher, operator, deviceId, clientTimestamp) {
  const today = todayTunis();
  const outcome = await runTransaction(async (session) => {
    const updated = await IssuedVoucher.findOneAndUpdate(
      { _id: voucher._id, status: 'issued', visitDate: today },
      { $set: { status: 'used', usedAt: new Date(), usedBy: operator._id } },
      { session, new: true },
    );
    const current = updated || await IssuedVoucher.findById(voucher._id).session(session);
    const code = updated ? 'valid' : scanReason(current, today);
    await ScanLog.create([{
      voucherId: voucher._id,
      operatorId: operator._id,
      scannedAt: new Date(),
      result: code,
      deviceId,
      clientTimestamp,
    }], { session });
    return { code, voucher: current };
  });
  const data = await describe(outcome.voucher, outcome.code);
  return { status: 200, body: { success: true, code: outcome.code, message: outcome.code, data } };
}

async function scan({ token, number, operator, deviceId, clientTimestamp }) {
  if (token) {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') {
      await logScan({ operatorId: operator._id, result: 'invalid', reason: 'invalid_signature', deviceId, clientTimestamp });
      throw new AppError(400, 'invalid_signature', 'QR token is not valid');
    }
    const voucher = await IssuedVoucher.findOne({ publicId: parts[1] });
    if (!voucher || !vouchers.signaturesMatch(voucher.publicId, voucher.visitDate, parts[2])) {
      await logScan({
        voucherId: voucher?._id, operatorId: operator._id, result: 'invalid', reason: 'invalid_signature', deviceId, clientTimestamp,
      });
      throw new AppError(400, 'invalid_signature', 'QR token is not valid');
    }
    return consume(voucher, operator, deviceId, clientTimestamp);
  }
  if (!number) throw new AppError(422, 'validation_error', 'token or number is required');
  const voucher = await IssuedVoucher.findOne({ publicId: number });
  if (!voucher) {
    await logScan({ operatorId: operator._id, result: 'not_found', deviceId, clientTimestamp });
    return { status: 200, body: { success: true, code: 'not_found', message: 'not_found' } };
  }
  return consume(voucher, operator, deviceId, clientTimestamp);
}

async function lookup(number, operator, deviceId) {
  const voucher = await IssuedVoucher.findOne({ publicId: number });
  await logScan({
    voucherId: voucher?._id,
    operatorId: operator._id,
    result: 'lookup',
    reason: voucher ? voucher.status : 'not_found',
    deviceId,
  });
  if (!voucher) return { code: 'not_found' };
  return { code: 'lookup', ...(await describe(voucher, voucher.status)) };
}

async function report(date) {
  const { assertIsoDate } = require('../utils/dates');
  assertIsoDate(date, 'date');
  const today = todayTunis();
  const list = await IssuedVoucher.find({ visitDate: date });
  const types = await VoucherType.find({ _id: { $in: list.map((item) => item.voucherTypeId) } });
  const start = new Date(`${date}T00:00:00.000Z`);
  const end = new Date(`${date}T23:59:59.999Z`);
  const failures = await ScanLog.countDocuments({
    scannedAt: { $gte: start, $lte: end },
    result: { $nin: ['valid', 'lookup'] },
  });
  const grouped = new Map();
  for (const voucher of list) {
    const key = String(voucher.voucherTypeId);
    if (!grouped.has(key)) grouped.set(key, { voucherTypeId: key, issued: 0, used: 0, noShows: 0 });
    const row = grouped.get(key);
    row.issued += 1;
    if (voucher.status === 'used') row.used += 1;
    if (date < today && (voucher.status === 'issued' || voucher.status === 'expired')) row.noShows += 1;
    if (date >= today && voucher.status === 'expired') row.noShows += 1;
  }
  const rows = [...grouped.values()].map((row) => ({
    ...row,
    name: types.find((type) => String(type._id) === row.voucherTypeId)?.duration || '',
  }));
  return { date, rows, scanFailures: failures };
}

function reportCsv(reportData) {
  const header = 'date,voucherType,issued,used,noShows,scanFailures';
  const lines = reportData.rows.map((row) => [reportData.date, row.name, row.issued, row.used, row.noShows, reportData.scanFailures].join(','));
  return [header, ...lines].join('\n');
}

async function markUsedOffline(publicIds, actor) {
  if (!Array.isArray(publicIds) || publicIds.length === 0) {
    throw new AppError(422, 'validation_error', 'publicIds is required', [{ field: 'publicIds' }]);
  }
  return runTransaction(async (session) => {
    for (const publicId of publicIds) {
      const updated = await IssuedVoucher.findOneAndUpdate(
        { publicId, status: 'issued' },
        { $set: { status: 'used', usedAt: new Date(), usedBy: actor._id, usedOffline: true } },
        { session, new: true },
      );
      if (!updated) throw new AppError(409, 'already_used', `Voucher ${publicId} cannot be marked used`);
      await ScanLog.create([{
        voucherId: updated._id,
        operatorId: actor._id,
        scannedAt: new Date(),
        result: 'valid',
        reason: 'used_offline',
      }], { session });
      await audit({ userId: actor._id, action: 'voucher.used_offline', entity: 'issued_voucher', entityId: updated._id, session });
    }
    return { updated: publicIds.length };
  });
}

module.exports = { scan, lookup, report, reportCsv, markUsedOffline };
