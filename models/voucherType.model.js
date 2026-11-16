const mongoose = require('mongoose');
const { Schema } = mongoose;

const voucherTypeSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  duration: { type: String, required: true },
  publicPrice: { type: Number, required: true },
  wholesalePrice: { type: Number },
  vatRateBps: { type: Number, required: true },
  active: { type: Boolean, default: true },
  validityMode: { type: String, enum: ['single_day'], default: 'single_day' },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  photos: { type: [{ type: String }], default: [] },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('VoucherType', voucherTypeSchema);
