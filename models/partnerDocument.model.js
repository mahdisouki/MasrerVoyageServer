const mongoose = require('mongoose');
const { Schema } = mongoose;

const partnerDocumentSchema = new Schema({
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
  docType: { type: String, required: true },
  storageKey: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

module.exports = mongoose.model('PartnerDocument', partnerDocumentSchema);
