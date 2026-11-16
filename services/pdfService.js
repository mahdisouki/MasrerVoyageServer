const fs = require('fs/promises');
const path = require('path');
const QRCode = require('qrcode');
const { Order, OrderLine, IssuedVoucher, Invoice, VoucherType } = require('../models');
const { AppError } = require('../utils/AppError');
const settings = require('./settingsService');
const vouchers = require('./voucherService');
const { enqueue } = require('./jobQueue');

function storagePath(key) {
  if (!process.env.STORAGE_DIR) throw new AppError(500, 'storage_not_configured', 'STORAGE_DIR is required');
  return path.join(process.env.STORAGE_DIR, key);
}

async function save(key, buffer) {
  const full = storagePath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buffer);
  return key;
}

async function read(key) {
  return fs.readFile(storagePath(key));
}

function htmlShell(locale, title, body) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return `<!doctype html><html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><title>${title}</title>
  <style>body{font-family:"Segoe UI","Noto Naskh Arabic",Tahoma,sans-serif;margin:32px;color:#172033}h1{font-size:22px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #d8dee9;padding:8px;text-align:start}</style>
  </head><body>${body}</body></html>`;
}

async function renderPdf(html) {
  const puppeteer = require('puppeteer');
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
}

async function generateForOrder({ orderId }) {
  const order = await Order.findById(orderId);
  if (!order) throw new AppError(404, 'not_found', 'Not found');
  const [lines, issued, invoice, legal] = await Promise.all([
    OrderLine.find({ orderId }),
    IssuedVoucher.find({ orderId }),
    Invoice.findOne({ orderId, docType: 'invoice' }),
    settings.getMany(['legalName', 'taxId', 'address', 'vatMention']),
  ]);
  const types = await VoucherType.find({ _id: { $in: lines.map((line) => line.voucherTypeId) } });
  for (const voucher of issued) {
    const qr = await QRCode.toDataURL(vouchers.tokenFor(voucher.publicId, voucher.visitDate));
    const type = types.find((item) => item._id.equals(voucher.voucherTypeId));
    const html = htmlShell(order.language, 'Voucher', `
      <h1>Master Voyage</h1>
      <p>${voucher.beneficiary}</p>
      <p>${voucher.visitDate}</p>
      <p>${type?.duration || ''}</p>
      <p>${voucher.publicId}</p>
      <img alt="QR" src="${qr}" width="180" height="180"/>`);
    const key = `vouchers/${voucher.publicId}.pdf`;
    await save(key, await renderPdf(html));
    voucher.pdfKey = key;
    await voucher.save();
  }
  if (invoice && !invoice.pdfKey) {
    const html = htmlShell(order.language, invoice.number, `
      <h1>${invoice.number}</h1>
      <p>${legal.legalName} ${legal.taxId}</p>
      <p>${legal.address}</p>
      <p>${legal.vatMention}</p>
      <table><tr><th>Net</th><td>${invoice.netAmount}</td></tr>
      <tr><th>VAT</th><td>${invoice.vatAmount}</td></tr>
      <tr><th>Stamp</th><td>${invoice.stampDuty}</td></tr>
      <tr><th>Total</th><td>${invoice.total}</td></tr></table>`);
    const key = `invoices/${invoice.number}.pdf`;
    await save(key, await renderPdf(html));
    invoice.pdfKey = key;
    await invoice.save();
  }
  const jobs = [{ type: 'send_email', payload: { template: 'order_paid', orderId: order._id.toString(), locale: order.language } }];
  if (order.deliverWhatsapp) {
    jobs.push({ type: 'send_whatsapp', payload: { orderId: order._id.toString(), locale: order.language } });
  }
  await enqueue(null, jobs);
}

module.exports = { save, read, generateForOrder, storagePath };
