const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
  guestEmail: { type: String },
  language: { type: String, enum: ['fr', 'ar', 'en'], default: 'fr' },
  currency: { type: String, default: 'TND' },
  subtotal: { type: Number, required: true },
  vatTotal: { type: Number, required: true },
  discountTotal: { type: Number, default: 0 },
  stampDuty: { type: Number, default: 0 },
  total: { type: Number, required: true },
  paymentMode: { type: String, required: true, enum: ['sandbox_card', 'agency', 'credit'] },
  priceMode: { type: String, enum: ['public', 'wholesale'], default: 'public' },
  status: { type: String, required: true, index: true },
  expiresAt: { type: Date, index: true },
  paymentCode: { type: String, unique: true, sparse: true },
  orderCode: { type: String, required: true, unique: true },
  promoCodeId: { type: Schema.Types.ObjectId, ref: 'PromoCode' },
  promoUserKey: { type: String },
  requestId: { type: String },
  quotaState: { type: String, enum: ['reserved', 'sold', 'released'], required: true },
  deliverWhatsapp: { type: Boolean, default: false },
  whatsappPhone: { type: String },
  refundedAmount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Order', orderSchema);
