const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationLogSchema = new Schema({
  channel: { type: String, required: true },
  template: { type: String, required: true },
  locale: { type: String },
  recipient: { type: String },
  entity: { type: String },
  entityId: { type: Schema.Types.ObjectId },
  status: { type: String, required: true },
  attempts: { type: Number, default: 1 },
  providerRef: { type: String },
  sentAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('NotificationLog', notificationLogSchema);
