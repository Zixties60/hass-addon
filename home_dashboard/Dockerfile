# Works both as a Home Assistant add-on (built by the Supervisor) and as a plain container.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ARG BUILD_VERSION=0.1.0
ENV NODE_ENV=production \
    PORT=8099 \
    DATA_DIR=/data \
    WEB_ROOT=/app/dist/web \
    APP_VERSION=${BUILD_VERSION}
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 8099
CMD ["node", "dist/server.js"]
