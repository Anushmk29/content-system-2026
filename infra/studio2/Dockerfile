# Isolated shared-VPS image. The build is run in a resource-capped BuildKit worker.
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=1536
COPY package.json package-lock.json ./
COPY content-pipeline/package.json content-pipeline/package-lock.json content-pipeline/
RUN npm ci --prefix content-pipeline && npm ci
COPY . .
# One page-data worker keeps the build from competing with the other VPS applications.
RUN node -e "const fs=require('fs');const p='next.config.mjs';const s=fs.readFileSync(p,'utf8');if(!s.includes('experimental: {'))throw Error('Review build worker configuration');fs.writeFileSync(p,s.replace('experimental: {','experimental: { cpus: 1,'));"
RUN npm run build
RUN npm prune --omit=dev && npm --prefix content-pipeline prune --omit=dev

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg ca-certificates \
    && python3 -m venv /opt/transcriber \
    && /opt/transcriber/bin/pip install --no-cache-dir yt-dlp faster-whisper \
    && rm -rf /var/lib/apt/lists/*
ENV PATH="/opt/transcriber/bin:${PATH}"
RUN groupadd --gid 1003 studio2 && useradd --uid 1003 --gid 1003 --create-home --shell /usr/sbin/nologin studio2
COPY --from=build --chown=studio2:studio2 /app/package.json ./package.json
COPY --from=build --chown=studio2:studio2 /app/node_modules ./node_modules
COPY --from=build --chown=studio2:studio2 /app/.next ./.next
COPY --from=build --chown=studio2:studio2 /app/next.config.mjs ./next.config.mjs
COPY --from=build --chown=studio2:studio2 /app/content-pipeline ./content-pipeline
COPY --from=build --chown=studio2:studio2 /app/db/schema.sql ./db/schema.sql
RUN mkdir -p /app/.next/cache /home/studio2/.cache && chown -R studio2:studio2 /app/.next/cache /home/studio2/.cache
USER studio2
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:3000/content/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
