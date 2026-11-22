const { AppError } = require('./AppError');

const MESSAGES = {
  validation_error: { fr: 'Champs invalides', ar: 'حقول غير صالحة', en: 'Invalid or missing fields' },
  unauthenticated: { fr: 'Authentification requise', ar: 'يلزم تسجيل الدخول', en: 'Not logged in' },
  forbidden: { fr: 'Accès refusé', ar: 'الوصول مرفوض', en: 'Forbidden' },
  rate_limited: { fr: 'Trop de tentatives', ar: 'محاولات كثيرة', en: 'Too many attempts' },
  sold_out: { fr: 'Date complète', ar: 'التاريخ مكتمل', en: 'Not enough quota for the chosen date' },
  day_blocked: { fr: 'Journée fermée', ar: 'اليوم مغلق', en: 'This date is closed' },
  quota_too_low: {
    fr: 'La quantité est inférieure aux ventes déjà engagées sur un jour du mois',
    ar: 'الكمية أقل من المبيعات المحجوزة في أحد أيام الشهر',
    en: 'Quantity is below sales already committed on a day of the month',
  },
  order_expired: { fr: 'La réservation a expiré', ar: 'انتهت صلاحية الحجز', en: 'The reservation has expired' },
  idempotency_conflict: { fr: 'Clé d’idempotence réutilisée', ar: 'أعيد استخدام مفتاح التكرار', en: 'Idempotency-Key reused with a different request' },
  request_in_progress: { fr: 'Requête en cours', ar: 'الطلب قيد المعالجة', en: 'Request is still being processed' },
  partner_not_approved: { fr: 'Compte partenaire non validé', ar: 'حساب الشريك غير معتمد', en: 'Partner account is not approved' },
  credit_limit_exceeded: { fr: 'Plafond de crédit dépassé', ar: 'تم تجاوز سقف الائتمان', en: 'Credit limit would be exceeded' },
  account_blocked: { fr: 'Crédit bloqué', ar: 'الائتمان موقوف', en: 'Credit is blocked for late payment' },
  promo_invalid: { fr: 'Code promo invalide', ar: 'رمز ترويجي غير صالح', en: 'Promo code is not applicable' },
  payment_failed: { fr: 'Paiement refusé', ar: 'رُفض الدفع', en: 'The payment was refused' },
  invalid_signature: { fr: 'Signature invalide', ar: 'توقيع غير صالح', en: 'Signature is not valid' },
  already_used: { fr: 'Déjà utilisé', ar: 'مستعمل مسبقا', en: 'Already used' },
  expired: { fr: 'Expiré', ar: 'منتهي الصلاحية', en: 'Expired' },
  wrong_date: { fr: 'Date non conforme', ar: 'التاريخ غير مطابق', en: 'Wrong date' },
  cancelled: { fr: 'Annulé', ar: 'ملغى', en: 'Cancelled' },
  not_found: { fr: 'Introuvable', ar: 'غير موجود', en: 'Not found' },
  unknown_gateway: { fr: 'Passerelle inconnue', ar: 'بوابة دفع غير معروفة', en: 'Unknown gateway' },
  email_not_configured: { fr: 'E-mail non configuré', ar: 'البريد غير مهيأ', en: 'Email is not configured' },
  whatsapp_not_configured: { fr: 'WhatsApp non configuré', ar: 'واتساب غير مهيأ', en: 'WhatsApp is not configured' },
  pdf_not_ready: { fr: 'PDF pas encore prêt', ar: 'ملف PDF غير جاهز', en: 'PDF is not ready' },
  settings_missing: { fr: 'Paramètre manquant', ar: 'إعداد مفقود', en: 'Required setting is missing' },
  internal_error: { fr: 'Erreur interne', ar: 'خطأ داخلي', en: 'An error occurred' },
  duplicate: { fr: 'Valeur déjà utilisée', ar: 'القيمة مستخدمة', en: 'Duplicate value' },
  role_not_allowed: {
    fr: 'Ce rôle ne peut pas être attribué ici',
    ar: 'لا يمكن تعيين هذا الدور من هنا',
    en: 'This role cannot be assigned here',
  },
  cannot_disable_self: {
    fr: 'Vous ne pouvez pas désactiver votre propre compte',
    ar: 'لا يمكنك تعطيل حسابك',
    en: 'You cannot disable your own account',
  },
  last_admin: {
    fr: 'Le dernier administrateur ne peut pas être retiré',
    ar: 'لا يمكن إزالة آخر مسؤول',
    en: 'The last administrator cannot be removed',
  },
};

function translate(code, locale, fallback) {
  const row = MESSAGES[code];
  if (!row) return fallback;
  return row[locale] || row.fr || fallback;
}

function errorBody(err, locale) {
  if (err instanceof AppError) {
    return {
      success: false,
      code: err.code,
      message: translate(err.code, locale, err.message),
      ...(err.fields ? { fields: err.fields } : {}),
    };
  }
  if (err && err.code === 11000) {
    return { success: false, code: 'duplicate', message: translate('duplicate', locale, 'Duplicate value') };
  }
  return { success: false, code: 'internal_error', message: translate('internal_error', locale, 'An error occurred') };
}

module.exports = { MESSAGES, translate, errorBody };
