# Relay Server Dockerfile - Multi-stage build for node:22-slim

# Build stage
FROM node:22-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/relay-server/package*.json ./apps/relay-server/
COPY packages/shared/package*.json ./packages/shared/

# Install dependencies
RUN npm ci --only=production

# Copy source files
COPY apps/relay-server/src ./apps/relay-server/src
COPY packages/shared/src ./packages/shared/src

# Build TypeScript
RUN npm run build --workspace=@electron-agent/relay-server

# Production stage
FROM node:22-slim

WORKDIR /app

# Copy built files and dependencies
COPY --from=builder /app/apps/relay-server/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared

# Create non-root user
RUN useradd -m -u 1001 relayuser
RUN chown -R relayuser:relayuser /app
USER relayuser

# Expose port
EXPOSE 9300

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:9300/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "dist/index.js"]