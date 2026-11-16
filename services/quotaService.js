const { Availability } = require('../models');
const { AppError } = require('../utils/AppError');

async function ensureRow(voucherTypeId, day) {
  await Availability.updateOne(
    { voucherTypeId, day },
    { $setOnInsert: { voucherTypeId, day, quota: null, sold: 0, reserved: 0 } },
    { upsert: true },
  );
}

function quotaFilter(voucherTypeId, day, qty) {
  return {
    voucherTypeId,
    day,
    $or: [
      { quota: null },
      { $expr: { $lte: [{ $add: ['$sold', '$reserved', qty] }, '$quota'] } },
    ],
  };
}

async function reserve(session, groups) {
  for (const group of groups) {
    const updated = await Availability.findOneAndUpdate(
      quotaFilter(group.voucherTypeId, group.visitDate, group.qty),
      { $inc: { reserved: group.qty } },
      { session, new: true },
    );
    if (!updated) throw new AppError(409, 'sold_out', 'Not enough quota for the chosen date');
  }
}

async function moveReservedToSold(session, groups) {
  for (const group of groups) {
    const updated = await Availability.findOneAndUpdate(
      { voucherTypeId: group.voucherTypeId, day: group.visitDate, reserved: { $gte: group.qty } },
      { $inc: { reserved: -group.qty, sold: group.qty } },
      { session },
    );
    if (!updated) throw new AppError(500, 'quota_inconsistent', 'Could not confirm the reservation');
  }
}

async function releaseReserved(session, groups) {
  for (const group of groups) {
    const updated = await Availability.findOneAndUpdate(
      { voucherTypeId: group.voucherTypeId, day: group.visitDate, reserved: { $gte: group.qty } },
      { $inc: { reserved: -group.qty } },
      { session },
    );
    if (!updated) throw new AppError(500, 'quota_inconsistent', 'Could not release the reservation');
  }
}

async function releaseSold(session, groups) {
  for (const group of groups) {
    const updated = await Availability.findOneAndUpdate(
      { voucherTypeId: group.voucherTypeId, day: group.visitDate, sold: { $gte: group.qty } },
      { $inc: { sold: -group.qty } },
      { session },
    );
    if (!updated) throw new AppError(500, 'quota_inconsistent', 'Could not release sold quota');
  }
}

module.exports = { ensureRow, reserve, moveReservedToSold, releaseReserved, releaseSold };
