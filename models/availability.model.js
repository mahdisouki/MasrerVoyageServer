const mongoose = require('mongoose');
const { Schema } = mongoose;

const availabilitySchema = new Schema({
  voucherTypeId: { type: Schema.Types.ObjectId, ref: 'VoucherType', required: true },
  day: { type: String, required: true },
  quota: { type: Number, default: null },
  sold: { type: Number, default: 0 },
  reserved: { type: Number, default: 0 },
  blocked: { type: Boolean, default: false },
}, { timestamps: true });

availabilitySchema.index({ voucherTypeId: 1, day: 1 }, { unique: true });

module.exports = mongoose.model('Availability', availabilitySchema);
