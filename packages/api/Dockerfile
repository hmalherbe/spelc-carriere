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

# The ADEL scraper (packages/scraper) and the mailing PDF export (packages/api) both need a real
# Chromium — --with-deps also installs the OS libraries it needs on a bare Debian image (fonts,
# libnss3, etc.). This only depends on the playwright version npm ci just installed, never on our
# own source, so it's deliberately placed before the COPY of packages/*/src below: a plain code
# change (no dependency bump) then hits Docker's layer cache here instead of re-running this ~2min
# apt install on every single deploy.
RUN npx playwright install --with-deps chromium

COPY packages/domain packages/domain
COPY packages/import packages/import
COPY packages/scraper packages/scraper
COPY packages/api packages/api

RUN npm run prisma:generate -w @spelc/api

WORKDIR /app/packages/api
EXPOSE 4000

# migrate deploy (not `migrate dev`) is the production-safe command: applies pending migrations,
# never prompts, never resets. The seed is idempotent (upserts only) so re-running it on every
# start just keeps reference data in sync — see prisma/seed.ts for what SEED_DEMO_DATA gates.
CMD ["sh", "-c", "npx prisma migrate deploy && npm run seed && npx tsx src/server.ts"]
