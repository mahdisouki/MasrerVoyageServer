const mongoose = require('mongoose');
const { Schema } = mongoose;

const translationSchema = new Schema({
  entity: { type: String, required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  locale: { type: String, required: true, enum: ['fr', 'ar', 'en'] },
  field: { type: String, required: true },
  value: { type: String, required: true },
  status: { type: String, enum: ['missing', 'draft', 'reviewed', 'published'], default: 'published' },
}, { timestamps: true });

translationSchema.index({ entity: 1, entityId: 1, locale: 1, field: 1 }, { unique: true });

module.exports = mongoose.model('Translation', translationSchema);
