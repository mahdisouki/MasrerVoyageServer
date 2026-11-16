const mongoose = require('mongoose');
const { Schema } = mongoose;

const orderAccessTokenSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
  tokenHash: { type: String, required: true, unique: true },
  expiresAt: { type: Date, required: true },
  lastUsedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('OrderAccessToken', orderAccessTokenSchema);
