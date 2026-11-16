const mongoose = require('mongoose');
const { Schema } = mongoose;

const refundSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  creditNoteId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  amount: { type: Number, required: true },
  method: { type: String, required: true, enum: ['gateway', 'manual', 'credit'] },
  status: { type: String, required: true, enum: ['pending', 'completed'] },
  reason: { type: String, required: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });

module.exports = mongoose.model('Refund', refundSchema);
