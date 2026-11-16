const mongoose = require('mongoose');
const { Schema } = mongoose;

const paymentSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  gateway: { type: String, required: true },
  reference: { type: String, required: true, unique: true },
  amount: { type: Number, required: true },
  status: { type: String, required: true, enum: ['pending', 'succeeded', 'failed', 'cancelled', 'refunded'] },
  idempotencyKey: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Payment', paymentSchema);
