const mongoose = require('mongoose');
const { Schema } = mongoose;

const partnerLedgerSchema = new Schema({
  partnerId: { type: Schema.Types.ObjectId, ref: 'Partner', required: true, index: true },
  entryType: { type: String, required: true, enum: ['order_debit', 'payment_credit', 'credit_note', 'adjustment'] },
  amount: { type: Number, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
  invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('PartnerLedgerEntry', partnerLedgerSchema);
