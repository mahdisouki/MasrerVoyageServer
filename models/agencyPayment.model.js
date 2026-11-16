const mongoose = require('mongoose');
const { Schema } = mongoose;

const agencyPaymentSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  paymentCode: { type: String, required: true },
  agentId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  method: { type: String, required: true, enum: ['cash', 'card'] },
  amount: { type: Number, required: true },
  recordedAt: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('AgencyPayment', agencyPaymentSchema);
