const auth = [{ bearerAuth: [] }];

const idParam = { in: 'path', name: 'id', required: true, schema: { type: 'string' } };
const idempotency = { in: 'header', name: 'Idempotency-Key', required: true, schema: { type: 'string' } };
const page = [
  { in: 'query', name: 'page', schema: { type: 'integer' } },
  { in: 'query', name: 'limit', schema: { type: 'integer', maximum: 100 } },
];

const orderBody = {
  type: 'object',
  required: ['paymentMode', 'lines'],
  properties: {
    paymentMode: { type: 'string', enum: ['sandbox_card', 'agency', 'credit'] },
    guestEmail: { type: 'string', format: 'email' },
    language: { type: 'string', enum: ['fr', 'ar', 'en'] },
    promoCode: { type: 'string' },
    deliverWhatsapp: { type: 'boolean' },
    whatsappPhone: { type: 'string' },
    lines: {
      type: 'array',
      items: {
        type: 'object',
        required: ['voucherTypeId', 'beneficiaries'],
        properties: {
          voucherTypeId: { type: 'string' },
          beneficiaries: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'visitDate'],
              properties: {
                name: { type: 'string' },
                visitDate: { type: 'string', example: '2026-11-20' },
              },
            },
          },
        },
      },
    },
  },
};

const voucherTypeBody = {
  type: 'object',
  required: ['slug', 'duration', 'publicPrice', 'vatRateBps', 'translations'],
  properties: {
    slug: { type: 'string' },
    duration: { type: 'string' },
    publicPrice: { type: 'integer', description: 'Millimes. 1 TND = 1000' },
    wholesalePrice: { type: 'integer' },
    vatRateBps: { type: 'integer', example: 1900 },
    active: { type: 'boolean' },
    translations: {
      type: 'object',
      properties: {
        fr: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
        ar: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
        en: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
      },
    },
  },
};

function json(schema) {
  return { required: true, content: { 'application/json': { schema } } };
}

function op(tag, summary, options = {}) {
  const operation = {
    tags: [tag],
    summary,
    responses: { 200: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } } },
  };
  if (options.auth) operation.security = auth;
  if (options.params) operation.parameters = options.params;
  if (options.body) operation.requestBody = json(options.body);
  if (options.body === 'multipart') {
    operation.requestBody = {
      required: true,
      content: { 'multipart/form-data': { schema: options.schema } },
    };
  }
  if (options.pdf) {
    operation.responses[200] = { description: 'PDF file', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } };
  }
  if (options.csv) {
    operation.responses[200] = { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } };
  }
  return operation;
}

const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Master Voyage API',
    version: '1.0.0',
    description: 'Phase 1 API. Money is integer millimes. Visit dates are YYYY-MM-DD in Africa/Tunis. Send Accept-Language: fr, ar, or en. Protected routes use a Bearer access token. Admin and agent tokens must be issued after TOTP.',
  },
  servers: [{ url: '/api/v1' }],
  tags: [
    { name: 'Health' },
    { name: 'Auth' },
    { name: 'Catalogue' },
    { name: 'Orders' },
    { name: 'Payments' },
    { name: 'Account' },
    { name: 'Partners' },
    { name: 'Station' },
    { name: 'Admin' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Envelope: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          code: { type: 'string' },
          message: { type: 'string' },
          fields: { type: 'array', items: { type: 'object' } },
          data: {},
        },
      },
    },
  },
  paths: {
    '/health': {
      get: op('Health', 'Database and process health'),
    },
    '/auth/register': {
      post: op('Auth', 'Register a customer', {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            phone: { type: 'string' },
            language: { type: 'string', enum: ['fr', 'ar', 'en'] },
          },
        },
      }),
    },
    '/auth/login': {
      post: op('Auth', 'Login with email and password', {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: { email: { type: 'string' }, password: { type: 'string' } },
        },
      }),
    },
    '/auth/refresh': {
      post: op('Auth', 'Rotate the refresh token', {
        body: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } },
      }),
    },
    '/auth/logout': {
      post: op('Auth', 'Revoke the current refresh token', { auth: true }),
    },
    '/auth/password/forgot': {
      post: op('Auth', 'Request a password reset email', {
        body: { type: 'object', required: ['email'], properties: { email: { type: 'string' } } },
      }),
    },
    '/auth/password/reset': {
      post: op('Auth', 'Set a new password with the reset token', {
        body: {
          type: 'object',
          required: ['token', 'password'],
          properties: { token: { type: 'string' }, password: { type: 'string', minLength: 8 } },
        },
      }),
    },
    '/auth/2fa/setup': {
      post: op('Auth', 'Start TOTP setup for an admin or agent', { auth: true }),
    },
    '/auth/2fa/confirm': {
      post: op('Auth', 'Confirm TOTP and receive recovery codes', {
        auth: true,
        body: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
      }),
    },
    '/auth/2fa/verify': {
      post: op('Auth', 'Complete login with a TOTP code', {
        auth: true,
        body: { type: 'object', required: ['code'], properties: { code: { type: 'string' } } },
      }),
    },
    '/vouchers': {
      get: op('Catalogue', 'Published voucher types'),
    },
    '/vouchers/{id}/availability': {
      get: op('Catalogue', 'Availability for one month', {
        params: [idParam, { in: 'query', name: 'month', required: true, schema: { type: 'string', example: '2026-11' } }],
      }),
    },
    '/vouchers/{id}': {
      get: op('Catalogue', 'One published voucher type', { params: [idParam] }),
    },
    '/vouchers/issued/{id}/pdf': {
      get: op('Account', 'Download an issued voucher PDF', { auth: true, params: [idParam], pdf: true }),
    },
    '/orders': {
      post: op('Orders', 'Create an order', { params: [idempotency], body: orderBody }),
      get: op('Orders', 'List the signed-in customer or partner orders', { auth: true, params: page }),
    },
    '/orders/access': {
      post: op('Orders', 'Email a guest access link', {
        body: {
          type: 'object',
          required: ['email', 'orderCode'],
          properties: { email: { type: 'string' }, orderCode: { type: 'string' } },
        },
      }),
    },
    '/orders/access/{token}': {
      get: op('Orders', 'Read an order with a guest access token', {
        params: [{ in: 'path', name: 'token', required: true, schema: { type: 'string' } }],
      }),
    },
    '/orders/{id}': {
      get: op('Orders', 'Read one owned order', { auth: true, params: [idParam] }),
    },
    '/orders/{id}/cancellation-requests': {
      post: op('Orders', 'Ask staff to cancel an order', {
        auth: true,
        params: [idParam],
        body: { type: 'object', required: ['reason'], properties: { reason: { type: 'string' } } },
      }),
    },
    '/orders/{id}/payments': {
      post: op('Payments', 'Create a pending sandbox card payment', {
        params: [idParam, idempotency],
        body: { type: 'object', properties: { email: { type: 'string', description: 'Required for a guest order' } } },
      }),
    },
    '/me/vouchers': {
      get: op('Account', 'List vouchers for the signed-in user', { auth: true }),
    },
    '/me/vouchers/{id}/resend': {
      post: op('Account', 'Queue another voucher email', { auth: true, params: [idParam] }),
    },
    '/me/invoices': {
      get: op('Account', 'List invoices for the signed-in user', { auth: true }),
    },
    '/invoices/{id}/pdf': {
      get: op('Account', 'Download an invoice PDF', { auth: true, params: [idParam], pdf: true }),
    },
    '/partners/register': {
      post: op('Partners', 'Register a partner account with documents', {
        body: 'multipart',
        schema: {
          type: 'object',
          required: ['email', 'password', 'businessName', 'taxId', 'partnerType', 'documents'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
            businessName: { type: 'string' },
            taxId: { type: 'string' },
            partnerType: { type: 'string', enum: ['agency', 'hotel', 'reseller'] },
            contactName: { type: 'string' },
            phone: { type: 'string' },
            language: { type: 'string', enum: ['fr', 'ar', 'en'] },
            docType: { type: 'string' },
            documents: { type: 'array', items: { type: 'string', format: 'binary' } },
          },
        },
      }),
    },
    '/partner/vouchers': {
      get: op('Partners', 'Wholesale catalogue for an approved partner', { auth: true }),
    },
    '/partner/dashboard': {
      get: op('Partners', 'Partner balance and invoice summary', { auth: true }),
    },
    '/partner/statement': {
      get: op('Partners', 'Partner ledger statement', { auth: true, params: page }),
    },
    '/partner/exports/orders': {
      get: op('Partners', 'Download partner orders as CSV', { auth: true, csv: true }),
    },
    '/partner/orders': {
      post: op('Partners', 'Create a partner order', { auth: true, params: [idempotency], body: orderBody }),
    },
    '/station/scan': {
      post: op('Station', 'Validate a voucher by QR token or number', {
        auth: true,
        params: [{ in: 'header', name: 'X-Device-Id', schema: { type: 'string' } }],
        body: {
          type: 'object',
          properties: {
            token: { type: 'string' },
            number: { type: 'string' },
            clientTimestamp: { type: 'string' },
          },
        },
      }),
    },
    '/station/vouchers': {
      get: op('Station', 'Look up a voucher without consuming it', {
        auth: true,
        params: [{ in: 'query', name: 'number', required: true, schema: { type: 'string' } }],
      }),
    },
    '/station/report': {
      get: op('Station', 'Daily scan report. format=csv returns a file', {
        auth: true,
        params: [
          { in: 'query', name: 'date', schema: { type: 'string', example: '2026-11-14' } },
          { in: 'query', name: 'format', schema: { type: 'string', enum: ['csv'] } },
        ],
      }),
    },
    '/admin/orders': {
      get: op('Admin', 'List orders', { auth: true, params: [...page, { in: 'query', name: 'status', schema: { type: 'string' } }, { in: 'query', name: 'paymentCode', schema: { type: 'string' } }] }),
    },
    '/admin/orders/{id}': {
      get: op('Admin', 'Read any order', { auth: true, params: [idParam] }),
    },
    '/admin/orders/{id}/cancel': {
      post: op('Admin', 'Cancel an order and optionally refund it', {
        auth: true,
        params: [idParam, idempotency],
        body: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string' }, refundAmount: { type: 'integer', description: 'Required when the order was paid. Millimes.' } },
        },
      }),
    },
    '/admin/orders/{id}/agency-payment': {
      post: op('Admin', 'Record an agency cash or card payment', {
        auth: true,
        params: [idParam, idempotency],
        body: {
          type: 'object',
          required: ['method', 'amount'],
          properties: { method: { type: 'string', enum: ['cash', 'card'] }, amount: { type: 'integer' } },
        },
      }),
    },
    '/admin/orders/{id}/handover': {
      post: op('Admin', 'Record a voucher handed over at the agency', {
        auth: true,
        params: [idParam],
        body: { type: 'object', required: ['voucherId'], properties: { voucherId: { type: 'string' } } },
      }),
    },
    '/admin/vouchers/mark-used-offline': {
      post: op('Admin', 'Mark vouchers used from an offline list', {
        auth: true,
        body: { type: 'object', required: ['publicIds'], properties: { publicIds: { type: 'array', items: { type: 'string' } } } },
      }),
    },
    '/admin/voucher-types': {
      get: op('Admin', 'List voucher types, including drafts', { auth: true }),
      post: op('Admin', 'Create a draft voucher type', { auth: true, body: voucherTypeBody }),
    },
    '/admin/voucher-types/{id}': {
      patch: op('Admin', 'Update a voucher type', { auth: true, params: [idParam], body: voucherTypeBody }),
      delete: op('Admin', 'Soft-delete a voucher type', { auth: true, params: [idParam] }),
    },
    '/admin/voucher-types/{id}/publish': {
      post: op('Admin', 'Publish a voucher type', { auth: true, params: [idParam] }),
    },
    '/admin/voucher-types/{id}/photos': {
      post: op('Admin', 'Upload a voucher photo', {
        auth: true,
        params: [idParam],
        body: 'multipart',
        schema: { type: 'object', required: ['photo'], properties: { photo: { type: 'string', format: 'binary' } } },
      }),
      delete: op('Admin', 'Remove a voucher photo', {
        auth: true,
        params: [idParam],
        body: {
          type: 'object',
          required: ['photo'],
          properties: { photo: { type: 'string', example: 'photos/cover.jpg' } },
        },
      }),
    },
    '/admin/availability/month': {
      put: op('Admin', 'Set the same daily quota for every day of a month', {
        auth: true,
        body: {
          type: 'object',
          required: ['voucherTypeId', 'month'],
          properties: {
            voucherTypeId: { type: 'string' },
            month: { type: 'string', example: '2026-11' },
            quota: { type: 'integer', nullable: true },
          },
        },
      }),
    },
    '/admin/availability/block': {
      put: op('Admin', 'Close or reopen one day for a bon', {
        auth: true,
        body: {
          type: 'object',
          required: ['voucherTypeId', 'day', 'blocked'],
          properties: {
            voucherTypeId: { type: 'string' },
            day: { type: 'string' },
            blocked: { type: 'boolean' },
          },
        },
      }),
    },
    '/admin/availability': {
      get: op('Admin', 'Daily quota, sold and reserved for one bon and one month', {
        auth: true,
        params: [
          { in: 'query', name: 'voucherTypeId', required: true, schema: { type: 'string' } },
          { in: 'query', name: 'month', required: true, schema: { type: 'string', example: '2026-11' } },
        ],
      }),
      put: op('Admin', 'Set the daily quota', {
        auth: true,
        body: {
          type: 'object',
          required: ['voucherTypeId', 'day'],
          properties: { voucherTypeId: { type: 'string' }, day: { type: 'string' }, quota: { type: 'integer', nullable: true } },
        },
      }),
    },
    '/admin/price-grids': {
      get: op('Admin', 'List price grids', { auth: true }),
      post: op('Admin', 'Create a price grid', {
        auth: true,
        body: {
          type: 'object',
          required: ['partnerType', 'name'],
          properties: { partnerType: { type: 'string', enum: ['agency', 'hotel', 'reseller'] }, name: { type: 'string' } },
        },
      }),
    },
    '/admin/price-grids/prices': {
      post: op('Admin', 'Add a wholesale price to a grid', {
        auth: true,
        body: {
          type: 'object',
          required: ['priceGridId', 'voucherTypeId', 'unitPrice'],
          properties: {
            priceGridId: { type: 'string' },
            voucherTypeId: { type: 'string' },
            unitPrice: { type: 'integer' },
            validFrom: { type: 'string', format: 'date-time' },
            validTo: { type: 'string', format: 'date-time' },
          },
        },
      }),
    },
    '/admin/promo-codes': {
      get: op('Admin', 'List promo codes', { auth: true }),
      post: op('Admin', 'Create a promo code', {
        auth: true,
        body: {
          type: 'object',
          required: ['code', 'type'],
          properties: {
            code: { type: 'string' },
            type: { type: 'string', enum: ['percent', 'fixed'] },
            amountBps: { type: 'integer' },
            amountMillimes: { type: 'integer' },
            voucherTypeIds: { type: 'array', items: { type: 'string' } },
            customerTypes: { type: 'array', items: { type: 'string', enum: ['customer', 'partner'] } },
            allowWholesale: { type: 'boolean' },
            startsAt: { type: 'string', format: 'date-time' },
            endsAt: { type: 'string', format: 'date-time' },
            maxUses: { type: 'integer' },
            maxUsesPerUser: { type: 'integer' },
          },
        },
      }),
    },
    '/admin/partners': {
      get: op('Admin', 'List partners', { auth: true }),
    },
    '/admin/partners/{id}/approval': {
      post: op('Admin', 'Approve, reject, or suspend a partner', {
        auth: true,
        params: [idParam],
        body: {
          type: 'object',
          required: ['approvalStatus'],
          properties: {
            approvalStatus: { type: 'string', enum: ['approved', 'rejected', 'suspended'] },
            creditLimit: { type: 'integer' },
            paymentDays: { type: 'integer' },
            priceGridId: { type: 'string' },
          },
        },
      }),
    },
    '/admin/partners/{id}/credit': {
      post: op('Admin', 'Change a partner credit limit', {
        auth: true,
        params: [idParam],
        body: {
          type: 'object',
          required: ['creditLimit'],
          properties: { creditLimit: { type: 'integer' }, paymentDays: { type: 'integer' } },
        },
      }),
    },
    '/admin/partners/{id}/payments': {
      post: op('Admin', 'Record a partner payment against open invoices', {
        auth: true,
        params: [idParam],
        body: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } },
      }),
    },
    '/admin/users': {
      get: op('Admin', 'List users', { auth: true }),
      post: op('Admin', 'Create an administrator, agent, customer, or station operator', {
        auth: true,
        body: {
          type: 'object',
          required: ['email', 'password', 'role'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
            role: { type: 'string', enum: ['customer', 'agent', 'admin', 'station_operator'] },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            language: { type: 'string', enum: ['fr', 'ar', 'en'] },
          },
        },
      }),
    },
    '/admin/users/{id}': {
      patch: op('Admin', 'Change a user role or status', {
        auth: true,
        params: [idParam],
        body: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['customer', 'agent', 'admin', 'station_operator'] },
            status: { type: 'string', enum: ['active', 'disabled'] },
          },
        },
      }),
    },
    '/admin/stats': {
      get: op('Admin', 'Order and voucher counts', { auth: true }),
    },
    '/admin/audit': {
      get: op('Admin', 'Audit log', { auth: true, params: page }),
    },
    '/admin/notifications': {
      get: op('Admin', 'Recent admin notifications', { auth: true }),
    },
    '/admin/settings': {
      get: op('Admin', 'List settings', { auth: true }),
      put: op('Admin', 'Update one setting', {
        auth: true,
        body: { type: 'object', required: ['key', 'value'], properties: { key: { type: 'string' }, value: {} } },
      }),
    },
    '/webhooks/payments/{gateway}': {
      post: op('Payments', 'Signed payment webhook. Send the raw JSON body and X-Signature.', {
        params: [
          { in: 'path', name: 'gateway', required: true, schema: { type: 'string', enum: ['sandbox'] } },
          { in: 'header', name: 'X-Signature', required: true, schema: { type: 'string' } },
        ],
        body: {
          type: 'object',
          required: ['eventId', 'reference', 'status'],
          properties: {
            eventId: { type: 'string' },
            reference: { type: 'string' },
            status: { type: 'string', enum: ['succeeded', 'failed'] },
          },
        },
      }),
    },
  },
};

module.exports = spec;
