# Build context is the repo root (see docker-compose.yml) — npm workspaces need every package's
# package.json present to resolve the monorepo, even though this image only runs packages/api.
FROM node:22-bookworm-slim

WORKDIR /app

# Copy just the manifests first so `npm ci` is cached across builds unless a dependency changed.
COPY package.json package-lock.json ./
COPY packages/domain/package.json packages/domain/package.json
COPY packages/import/package.json packages/import/package.json
COPY packages/scraper/package.json packages/scraper/package.json
COPY packages/api/package.json packages/api/package.json
COPY packages/web/package.json packages/web/package.json
RUN npm ci

COPY packages/domain packages/domain
COPY packages/import packages/import
COPY packages/scraper packages/scraper
COPY packages/api packages/api

# The ADEL scraper (packages/scraper) needs a real Chromium — --with-deps also installs the OS
# libraries headless Chromium needs on a bare Debian image (fonts, libnss3, etc.).
RUN npx playwright install --with-deps chromium

RUN npm run prisma:generate -w @spelc/api

WORKDIR /app/packages/api
EXPOSE 4000

# migrate deploy (not `migrate dev`) is the production-safe command: applies pending migrations,
# never prompts, never resets. The seed is idempotent (upserts only) so re-running it on every
# start just keeps reference data in sync — see prisma/seed.ts for what SEED_DEMO_DATA gates.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run seed && npx tsx src/server.ts"]
