const mongoose = require('mongoose');
const { Schema } = mongoose;

const promoRedemptionSchema = new Schema({
  promoCodeId: { type: Schema.Types.ObjectId, ref: 'PromoCode', required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  discountAmount: { type: Number, required: true },
}, { timestamps: true });

module.exports = mongoose.model('PromoRedemption', promoRedemptionSchema);
