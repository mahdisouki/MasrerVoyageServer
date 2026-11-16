const mongoose = require('mongoose');
const { Schema } = mongoose;

const idempotencySchema = new Schema({
  key: { type: String, required: true },
  scope: { type: String, required: true },
  requestHash: { type: String, required: true },
  status: { type: String, required: true, enum: ['processing', 'completed'] },
  statusCode: { type: Number },
  response: { type: Schema.Types.Mixed },
}, { timestamps: true });

idempotencySchema.index({ key: 1, scope: 1 }, { unique: true });
idempotencySchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('IdempotencyRecord', idempotencySchema);
