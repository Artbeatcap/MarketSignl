# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY apps/backend/package.json ./apps/backend/
COPY packages/core/package.json ./packages/core/

# Install dependencies (--ignore-scripts skips root postinstall/patch-package; patches are Expo-only)
RUN npm ci --workspace=backend --workspace=@chartsignl/core --ignore-scripts
# Workspaces hoist to root; ensure backend node_modules exists so runner COPY succeeds (resolution uses root)
RUN mkdir -p /app/apps/backend/node_modules

# Copy source code
COPY packages/core ./packages/core
COPY apps/backend ./apps/backend
COPY tsconfig.base.json ./

# Build
WORKDIR /app/apps/backend
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy workspace structure for proper module resolution
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

# Copy node_modules from builder (has all dependencies including workspace links)
COPY --from=builder /app/node_modules ./node_modules
# Also copy workspace-specific node_modules (where dotenv is located)
COPY --from=builder /app/apps/backend/node_modules ./apps/backend/node_modules

# Create symlinks for workspace dependencies in root node_modules so ESM can find them
RUN if [ -d "./apps/backend/node_modules" ]; then \
      for dir in ./apps/backend/node_modules/*; do \
        if [ ! -e "./node_modules/$(basename $dir)" ]; then \
          ln -s "../apps/backend/node_modules/$(basename $dir)" "./node_modules/$(basename $dir)" || true; \
        fi; \
      done; \
    fi

# Copy built files and set working directory to backend where node_modules exists
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist
COPY --from=builder /app/apps/backend/package.json ./apps/backend/package.json

# Set working directory to backend
WORKDIR /app/apps/backend

# Set environment
ENV NODE_ENV=production
ENV PORT=4000

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
