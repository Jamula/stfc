ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /app
COPY pwa-browser/package.json pwa-browser/package-lock.json ./
RUN npm ci
COPY pwa-browser/tsconfig.json ./pwa-browser/tsconfig.json
COPY pwa-browser/src ./pwa-browser/src
COPY scripts/capture-token.mjs scripts/capture-token.d.mts ./scripts/
RUN npx tsc -p pwa-browser/tsconfig.json \
    && npx playwright install --with-deps chromium \
    && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "pwa-browser/dist/main.js"]
