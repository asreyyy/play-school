# Production image for the clinic app.
FROM node:22-slim

ENV NODE_ENV=production \
    PORT=3000 \
    DB_FILE=/app/data/clinic.db

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public

# /app/data holds the database and daily backups; mount a persistent disk here.
VOLUME /app/data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
