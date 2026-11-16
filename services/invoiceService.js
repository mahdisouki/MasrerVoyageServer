const { Invoice, InvoiceSequence } = require('../models');
const { AppError } = require('../utils/AppError');
const { todayTunis, addDays } = require('../utils/dates');
const settings = require('./settingsService');

async function ensureSequence(series, year) {
  await InvoiceSequence.updateOne(
    { series, year },
    { $setOnInsert: { series, year, lastNumber: 0 } },
    { upsert: true },
  );
}

async function nextNumber(session, series) {
  const year = Number(todayTunis().slice(0, 4));
  const row = await InvoiceSequence.findOneAndUpdate(
    { series, year },
    { $inc: { lastNumber: 1 } },
    { session, new: true },
  );
  if (!row) throw new AppError(500, 'settings_missing', 'Invoice sequence is missing');
  return { year, number: `${series}-${year}-${String(row.lastNumber).padStart(6, '0')}` };
}

async function issueInvoice(session, order, { partner, paid }) {
  const series = await settings.get('invoiceSeries');
  const allocated = await nextNumber(session, series);
  const dueDate = partner
    ? addDays(todayTunis(), partner.paymentDays || 0)
    : todayTunis();
  const [invoice] = await Invoice.create([{
    number: allocated.number,
    series,
    year: allocated.year,
    orderId: order._id,
    partnerId: partner?._id,
    docType: 'invoice',
    netAmount: order.subtotal,
    vatAmount: order.vatTotal,
    stampDuty: order.stampDuty,
    total: order.total,
    dueDate,
    paidAt: paid ? new Date() : undefined,
    paidAmount: paid ? order.total : 0,
  }], { session });
  return invoice;
}

async function issueCreditNote(session, order, amount, original) {
  const series = await settings.get('creditNoteSeries');
  const { year, number } = await nextNumber(session, series);
  const ratio = order.total === 0 ? 0 : amount / order.total;
  const [note] = await Invoice.create([{
    number,
    series,
    year,
    orderId: order._id,
    partnerId: order.partnerId,
    docType: 'credit_note',
    netAmount: Math.round(order.subtotal * ratio),
    vatAmount: Math.round(order.vatTotal * ratio),
    stampDuty: 0,
    total: amount,
    dueDate: todayTunis(),
    paidAt: new Date(),
    paidAmount: amount,
    originalInvoiceId: original?._id,
  }], { session });
  return note;
}

module.exports = { ensureSequence, issueInvoice, issueCreditNote };
