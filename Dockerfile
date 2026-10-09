# Telegram bot for supplier drawings (see bot/README.md).
# Build from the repository root:  docker build -t parts-bot .
FROM node:22-slim

# Fonts for rendering the drawing preview images
RUN apt-get update \
 && apt-get install -y --no-install-recommends fonts-liberation ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Shared drawing / CAD / AI code from the web app
COPY parts-app/core parts-app/core
COPY parts-app/vendor/cad.js parts-app/vendor/replicad_single.wasm parts-app/vendor/

COPY bot/package.json bot/package-lock.json bot/
RUN cd bot && npm ci --omit=dev
COPY bot/index.js bot/lib.js bot/

ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
WORKDIR /app/bot
CMD ["node", "index.js"]
