const mongoose = require('mongoose');
const { Schema } = mongoose;

const webhookEventSchema = new Schema({
  gateway: { type: String, required: true },
  eventId: { type: String, required: true },
  rawPayload: { type: String, required: true },
  status: { type: String, required: true },
  processedAt: { type: Date },
}, { timestamps: true });

webhookEventSchema.index({ gateway: 1, eventId: 1 }, { unique: true });

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
