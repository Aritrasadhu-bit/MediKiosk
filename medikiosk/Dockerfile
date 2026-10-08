# ---- Next.js standalone build ------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Persist data volume across restarts (mounted at runtime).
ENV NEXT_TELEMETRY_DISABLED=1
# Bake image provenance for the admin deployment card + /api/health: which
# build is actually serving traffic. Defaults keep local builds working.
ARG BUILD_ID=dev
ARG BUILD_TIME=unknown
RUN printf '{"id":"%s","time":"%s"}' "$BUILD_ID" "$BUILD_TIME" > ./public/build-info.json
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Next.js standalone output (all server deps bundled).
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Persistent JSON store + seed data (users.json).
RUN mkdir -p /app/data && chown nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]