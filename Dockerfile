FROM node:20-alpine

WORKDIR /app

# Install build deps for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install dependencies first (cached layer)
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Create uploads directory
RUN mkdir -p /app/backend/uploads

# Runtime user (non-root)
RUN addgroup -S portal && adduser -S portal -G portal
RUN chown -R portal:portal /app
USER portal

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/departments || exit 1

CMD ["node", "backend/server.js"]
