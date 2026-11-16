const mongoose = require('mongoose');
const { Schema } = mongoose;

const scanLogSchema = new Schema({
  voucherId: { type: Schema.Types.ObjectId, ref: 'IssuedVoucher' },
  operatorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  scannedAt: { type: Date, required: true },
  result: { type: String, required: true },
  reason: { type: String },
  deviceId: { type: String },
  clientTimestamp: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('ScanLog', scanLogSchema);
