# Dokploy
# Container port: 4000, unless you set PORT to another value.
# Required env: MONGODB_URI, JWT_SECRET, REFRESH_SECRET, QR_SECRET_V1,
# PAYMENT_WEBHOOK_SECRET, TOTP_ENCRYPTION_KEY, CORS_ORIGIN, APP_PUBLIC_URL.
# Mount a volume on /data/storage so voucher and invoice PDFs survive redeploys.

FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    fonts-noto-core \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    wget \
    xdg-utils \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=4000 \
    STORAGE_DIR=/data/storage \
    PUPPETEER_CACHE_DIR=/opt/puppeteer

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm cache clean --force \
  && mkdir -p /data/storage /opt/puppeteer \
  && chown -R node:node /app /data/storage /opt/puppeteer

COPY --chown=node:node . .

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/v1/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
