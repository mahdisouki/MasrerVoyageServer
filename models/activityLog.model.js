const mongoose = require('mongoose');
const { Schema } = mongoose;

const activityLogSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User' },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String },
  meta: { type: Schema.Types.Mixed },
  at: { type: Date, required: true },
}, { timestamps: false });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
