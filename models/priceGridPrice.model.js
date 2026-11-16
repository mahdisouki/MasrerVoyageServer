const mongoose = require('mongoose');
const { Schema } = mongoose;

const priceGridPriceSchema = new Schema({
  priceGridId: { type: Schema.Types.ObjectId, ref: 'PriceGrid', required: true, index: true },
  voucherTypeId: { type: Schema.Types.ObjectId, ref: 'VoucherType', required: true, index: true },
  unitPrice: { type: Number, required: true },
  validFrom: { type: Date },
  validTo: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('PriceGridPrice', priceGridPriceSchema);
