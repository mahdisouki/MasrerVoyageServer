const crypto = require('crypto');
const { PriceGridPrice, PromoCode } = require('../models');
const { AppError } = require('../utils/AppError');

function userKey(email) {
  return crypto.createHash('sha256').update(String(email).toLowerCase()).digest('hex');
}

async function resolveUnitPrice(voucherType, partner) {
  if (partner && partner.approvalStatus === 'approved') {
    if (partner.priceGridId) {
      const now = new Date();
      const gridPrice = await PriceGridPrice.findOne({
        priceGridId: partner.priceGridId,
        voucherTypeId: voucherType._id,
        $and: [
          { $or: [{ validFrom: null }, { validFrom: { $lte: now } }, { validFrom: { $exists: false } }] },
          { $or: [{ validTo: null }, { validTo: { $gte: now } }, { validTo: { $exists: false } }] },
        ],
      }).sort({ validFrom: -1 });
      if (gridPrice) return { unitPrice: gridPrice.unitPrice, wholesale: true };
    }
    if (voucherType.wholesalePrice == null) {
      throw new AppError(409, 'price_missing', 'No wholesale price for this voucher');
    }
    return { unitPrice: voucherType.wholesalePrice, wholesale: true };
  }
  return { unitPrice: voucherType.publicPrice, wholesale: false };
}

async function reservePromo(promo, email, session) {
  const key = userKey(email);
  const field = `userUses.${key}`;
  const filter = { _id: promo._id, active: true };
  if (promo.maxUses != null) filter.reservedUses = { $lt: promo.maxUses };
  if (promo.maxUsesPerUser != null) {
    filter.$or = [{ [field]: { $exists: false } }, { [field]: { $lt: promo.maxUsesPerUser } }];
  }
  const updated = await PromoCode.findOneAndUpdate(
    filter,
    { $inc: { reservedUses: 1, [field]: 1 } },
    { session, new: true },
  );
  if (!updated) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  return key;
}

async function releasePromo(order, session) {
  if (!order.promoCodeId || !order.promoUserKey) return;
  const field = `userUses.${order.promoUserKey}`;
  await PromoCode.updateOne(
    { _id: order.promoCodeId },
    { $inc: { reservedUses: -1, [field]: -1 } },
    { session },
  );
}

function quotePromo(promo, gross, { wholesale, customerType, voucherTypeIds, now }) {
  if (!promo || !promo.active) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  if (promo.startsAt && promo.startsAt > now) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  if (promo.endsAt && promo.endsAt < now) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  if (wholesale && !promo.allowWholesale) throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  if (promo.customerTypes?.length && !promo.customerTypes.includes(customerType)) {
    throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
  }
  if (promo.voucherTypeIds?.length) {
    const allowed = new Set(promo.voucherTypeIds.map(String));
    if (voucherTypeIds.some((id) => !allowed.has(String(id)))) {
      throw new AppError(422, 'promo_invalid', 'Promo code is not applicable');
    }
  }
  const discount = promo.type === 'percent'
    ? Math.round((gross * promo.amountBps) / 10000)
    : promo.amountMillimes;
  return Math.min(discount, gross);
}

module.exports = { resolveUnitPrice, reservePromo, releasePromo, quotePromo, userKey };
