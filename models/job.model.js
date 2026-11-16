const mongoose = require('mongoose');
const { Schema } = mongoose;

const jobSchema = new Schema({
  type: { type: String, required: true },
  payload: { type: Schema.Types.Mixed, required: true },
  status: { type: String, required: true, enum: ['pending', 'running', 'succeeded', 'failed'], default: 'pending' },
  runAt: { type: Date, required: true, index: true },
  attempts: { type: Number, default: 0 },
  maxAttempts: { type: Number, default: 5 },
  lastError: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Job', jobSchema);
