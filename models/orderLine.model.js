const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderLineSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  voucherTypeId: { type: Schema.Types.ObjectId, ref: 'VoucherType', required: true },
  quantity: { type: Number, required: true },
  unitPrice: { type: Number, required: true },
  visitDate: { type: String, required: true },
  vatRateBps: { type: Number, required: true },
  gross: { type: Number, required: true },
  discountAmount: { type: Number, default: 0 },
  netAmount: { type: Number, required: true },
  vatAmount: { type: Number, required: true },
  total: { type: Number, required: true },
  pricesIncludeVat: { type: Boolean, required: true },
}, { timestamps: true });

module.exports = mongoose.model('OrderLine', orderLineSchema);
