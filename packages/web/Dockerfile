# Build context is the repo root (see docker-compose.yml).
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/import/package.json packages/import/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/web packages/web
RUN npm run build -w @spelc/web

FROM nginx:1.27-alpine
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
