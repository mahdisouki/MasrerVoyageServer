const mongoose = require('mongoose');
const { Schema } = mongoose;

const promoCodeSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  type: { type: String, required: true, enum: ['percent', 'fixed'] },
  amountBps: { type: Number },
  amountMillimes: { type: Number },
  voucherTypeIds: [{ type: Schema.Types.ObjectId, ref: 'VoucherType' }],
  customerTypes: [{ type: String, enum: ['customer', 'partner'] }],
  allowWholesale: { type: Boolean, default: false },
  startsAt: { type: Date },
  endsAt: { type: Date },
  maxUses: { type: Number },
  maxUsesPerUser: { type: Number },
  reservedUses: { type: Number, default: 0 },
  userUses: { type: Schema.Types.Mixed, default: {} },
  active: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('PromoCode', promoCodeSchema);
