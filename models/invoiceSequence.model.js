const mongoose = require('mongoose');
const { Schema } = mongoose;

const invoiceSequenceSchema = new Schema({
  series: { type: String, required: true },
  year: { type: Number, required: true },
  lastNumber: { type: Number, default: 0 },
}, { timestamps: true });

invoiceSequenceSchema.index({ series: 1, year: 1 }, { unique: true });

module.exports = mongoose.model('InvoiceSequence', invoiceSequenceSchema);
