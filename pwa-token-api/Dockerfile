ARG NODE_VERSION
FROM node:${NODE_VERSION}-bookworm-slim

WORKDIR /app
COPY pwa-token-api/package.json pwa-token-api/package-lock.json ./
RUN npm ci
COPY pwa-token-api/tsconfig.json ./pwa-token-api/tsconfig.json
COPY pwa-token-api/src ./pwa-token-api/src
COPY shared/token-accounts.ts ./shared/token-accounts.ts
COPY shared/token-account-schema.mjs shared/token-account-schema.d.mts ./shared/
RUN npx tsc -p pwa-token-api/tsconfig.json && npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["node", "pwa-token-api/dist/pwa-token-api/src/main.js"]
