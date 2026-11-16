const nodemailer = require('nodemailer');
const { Order, IssuedVoucher, User, NotificationLog } = require('../models');
const { AppError } = require('../utils/AppError');
const { read } = require('./pdfService');

const COPY = {
  order_paid: {
    fr: { subject: 'Votre commande Master Voyage', text: 'Votre paiement est confirmé. Le voucher est joint.' },
    ar: { subject: 'طلب Master Voyage', text: 'تم تأكيد الدفع. القسيمة مرفقة.' },
    en: { subject: 'Your Master Voyage order', text: 'Your payment is confirmed. The voucher is attached.' },
  },
  voucher: {
    fr: { subject: 'Votre voucher', text: 'Votre voucher est joint.' },
    ar: { subject: 'قسيمتك', text: 'قسيمتك مرفقة.' },
    en: { subject: 'Your voucher', text: 'Your voucher is attached.' },
  },
  password_reset: {
    fr: { subject: 'Réinitialisation du mot de passe', text: 'Utilisez ce jeton : ' },
    ar: { subject: 'إعادة تعيين كلمة المرور', text: 'استخدم هذا الرمز: ' },
    en: { subject: 'Password reset', text: 'Use this token: ' },
  },
  guest_access: {
    fr: { subject: 'Accès à votre commande', text: 'Lien de commande : ' },
    ar: { subject: 'الوصول إلى طلبك', text: 'رابط الطلب: ' },
    en: { subject: 'Access your order', text: 'Order link: ' },
  },
  payment_reminder: {
    fr: { subject: 'Facture à régler', text: 'Une facture est échue.' },
    ar: { subject: 'فاتورة مستحقة', text: 'هناك فاتورة متأخرة.' },
    en: { subject: 'Invoice due', text: 'An invoice is overdue.' },
  },
  visit_reminder: {
    fr: { subject: 'Rappel de visite', text: 'Votre visite est prévue le ' },
    ar: { subject: 'تذكير بالزيارة', text: 'زيارتك بتاريخ ' },
    en: { subject: 'Visit reminder', text: 'Your visit is on ' },
  },
};

function textFor(template, locale) {
  const row = COPY[template];
  if (!row) throw new AppError(500, 'settings_missing', `Unknown template ${template}`);
  return row[locale] || row.fr;
}

function transport() {
  if (!process.env.SMTP_HOST) throw new AppError(503, 'email_not_configured', 'SMTP_HOST is required');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
}

async function sendEmail(payload) {
  const locale = payload.locale || 'fr';
  const copy = textFor(payload.template, locale);
  let to;
  let extra = '';
  const attachments = [];
  if (payload.userId && payload.template === 'password_reset') {
    const user = await User.findById(payload.userId);
    if (!user) throw new AppError(404, 'not_found', 'Not found');
    to = user.email;
    extra = payload.token;
  } else if (payload.orderId) {
    const order = await Order.findById(payload.orderId);
    if (!order) throw new AppError(404, 'not_found', 'Not found');
    const user = order.userId ? await User.findById(order.userId) : null;
    to = user?.email || order.guestEmail;
    if (payload.template === 'guest_access') extra = `${process.env.APP_PUBLIC_URL || ''}/orders/access/${payload.token}`;
    if (payload.template === 'visit_reminder') extra = payload.visitDate;
    if (payload.template === 'order_paid' || payload.template === 'voucher') {
      const issued = await IssuedVoucher.find({ orderId: order._id, pdfKey: { $ne: null } });
      for (const voucher of issued) {
        attachments.push({ filename: `${voucher.publicId}.pdf`, content: await read(voucher.pdfKey) });
        voucher.deliveredAt = new Date();
        await voucher.save();
      }
    }
  }
  if (!to) throw new AppError(422, 'validation_error', 'Recipient is missing');
  const info = await transport().sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: copy.subject,
    text: `${copy.text}${extra}`,
  });
  await NotificationLog.create({
    channel: 'email',
    template: payload.template,
    locale,
    recipient: to,
    entity: payload.orderId ? 'order' : 'user',
    entityId: payload.orderId || payload.userId,
    status: 'sent',
    providerRef: info.messageId,
    sentAt: new Date(),
  });
}

async function sendWhatsApp(payload) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const template = process.env.WHATSAPP_TEMPLATE;
  if (!token || !phoneId || !template) throw new AppError(503, 'whatsapp_not_configured', 'WhatsApp is not configured');
  const order = await Order.findById(payload.orderId);
  if (!order?.whatsappPhone) throw new AppError(422, 'validation_error', 'whatsappPhone is required');
  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: order.whatsappPhone,
      type: 'template',
      template: { name: template, language: { code: payload.locale || order.language || 'fr' } },
    }),
  });
  if (!response.ok) throw new AppError(502, 'whatsapp_failed', 'WhatsApp request failed');
  const body = await response.json();
  await NotificationLog.create({
    channel: 'whatsapp',
    template,
    locale: payload.locale,
    recipient: order.whatsappPhone,
    entity: 'order',
    entityId: order._id,
    status: 'sent',
    providerRef: body.messages?.[0]?.id,
    sentAt: new Date(),
  });
}

module.exports = { sendEmail, sendWhatsApp };
