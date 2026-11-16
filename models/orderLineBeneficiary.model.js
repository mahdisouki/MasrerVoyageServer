const mongoose = require('mongoose');
const { Schema } = mongoose;

const beneficiarySchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true, index: true },
  orderLineId: { type: Schema.Types.ObjectId, ref: 'OrderLine', required: true },
  beneficiaryName: { type: String, required: true },
  visitDate: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('OrderLineBeneficiary', beneficiarySchema);
