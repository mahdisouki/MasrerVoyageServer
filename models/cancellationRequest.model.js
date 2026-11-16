const mongoose = require('mongoose');
const { Schema } = mongoose;

const cancellationRequestSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  reason: { type: String, required: true },
  status: { type: String, enum: ['open', 'done'], default: 'open' },
}, { timestamps: true });

module.exports = mongoose.model('CancellationRequest', cancellationRequestSchema);
