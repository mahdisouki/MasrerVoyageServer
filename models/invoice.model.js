const mongoose = require('mongoose');
const { Schema } = mongoose;

const invoiceSchema = new Schema({
  number: { type: String, required: true, unique: true },
  series: { type: String, required: true },
  year: { type: Number, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner' },
  docType: { type: String, required: true, enum: ['invoice', 'credit_note'] },
  netAmount: { type: Number, required: true },
  vatAmount: { type: Number, required: true },
  stampDuty: { type: Number, default: 0 },
  total: { type: Number, required: true },
  dueDate: { type: String, required: true },
  paidAt: { type: Date },
  paidAmount: { type: Number, default: 0 },
  originalInvoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  pdfKey: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema);
