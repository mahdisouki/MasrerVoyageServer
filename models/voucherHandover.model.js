const mongoose = require('mongoose');
const { Schema } = mongoose;

const handoverSchema = new Schema({
  issuedVoucherId: { type: Schema.Types.ObjectId, ref: 'IssuedVoucher', required: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  handedAt: { type: Date, required: true },
  channel: { type: String, default: 'agency' },
}, { timestamps: true });

module.exports = mongoose.model('VoucherHandover', handoverSchema);
