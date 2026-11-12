# Content Studio: the Next.js dashboard + the engine, one image. Used by infra/app/docker-compose.yml
# for both the web app and the scheduler (same image, different command). See docs/DEPLOY.md.
# Transcription (yt-dlp + faster-whisper) is not in this image; Decode works without it.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY content-pipeline/package.json content-pipeline/package-lock.json content-pipeline/
RUN npm ci --prefix content-pipeline && npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=node:node /app ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:3000/content/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start", "-p", "3000"]
