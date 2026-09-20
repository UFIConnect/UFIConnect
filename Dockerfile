# Default Docker entry point for tools that discover only ./Dockerfile.
# Build context: repository root. Render's Blueprint uses native Node services.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=320
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node backend/ ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", "index.js"]
