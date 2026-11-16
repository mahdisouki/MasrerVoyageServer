const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationSchema = new Schema({
  type: { type: String, required: true },
  title: { type: String, required: true },
  body: { type: String, default: '' },
  entity: { type: String },
  entityId: { type: Schema.Types.ObjectId },
  readAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
