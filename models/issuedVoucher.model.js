const mongoose = require('mongoose');
const { Schema } = mongoose;

const issuedVoucherSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderLineId: { type: Schema.Types.ObjectId, ref: 'OrderLine', required: true },
  beneficiaryId: { type: Schema.Types.ObjectId, ref: 'OrderLineBeneficiary', required: true },
  voucherTypeId: { type: Schema.Types.ObjectId, ref: 'VoucherType', required: true },
  beneficiary: { type: String, required: true },
  visitDate: { type: String, required: true },
  qrSignature: { type: String, required: true },
  qrVersion: { type: String, default: 'v1' },
  status: { type: String, required: true, enum: ['issued', 'used', 'expired', 'cancelled', 'refunded'], index: true },
  usedAt: { type: Date },
  usedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  usedOffline: { type: Boolean, default: false },
  deliveredAt: { type: Date },
  lastResentAt: { type: Date },
  pdfKey: { type: String },
}, { timestamps: true });

issuedVoucherSchema.index({ status: 1, visitDate: 1 });

module.exports = mongoose.model('IssuedVoucher', issuedVoucherSchema);
