const mongoose = require('mongoose');
const { Schema } = mongoose;

const treatmentSchema = new Schema({
  slug: { type: String, required: true, unique: true },
  category: { type: String, required: true, enum: ['baths', 'showers', 'body', 'wellness'] },
  duration: { type: String, required: true },
  publicPrice: { type: Number, default: null },
  featured: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ['draft', 'published'], default: 'draft' },
  photos: { type: [{ type: String }], default: [] },
  deletedAt: { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Treatment', treatmentSchema);
