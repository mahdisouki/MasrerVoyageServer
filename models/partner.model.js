const mongoose = require('mongoose');
const { Schema } = mongoose;

const partnerSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  businessName: { type: String, required: true },
  taxId: { type: String, required: true },
  partnerType: { type: String, required: true, enum: ['agency', 'hotel', 'reseller'] },
  priceGridId: { type: Schema.Types.ObjectId, ref: 'PriceGrid' },
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended', 'blocked_credit'], default: 'pending' },
  creditLimit: { type: Number, default: 0 },
  paymentDays: { type: Number, default: 30 },
  balance: { type: Number, default: 0 },
  blockedReason: { type: String },
  blockedAt: { type: Date },
  phone: { type: String, default: '' },
  contactName: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Partner', partnerSchema);
