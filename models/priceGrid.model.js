const mongoose = require('mongoose');
const { Schema } = mongoose;

const priceGridSchema = new Schema({
  partnerType: { type: String, required: true, enum: ['agency', 'hotel', 'reseller'] },
  name: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('PriceGrid', priceGridSchema);
