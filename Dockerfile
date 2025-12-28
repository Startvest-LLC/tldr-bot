# Use Node.js LTS with full build tools for native modules
FROM node:20-alpine AS builder

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++ sqlite-dev

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (this compiles better-sqlite3)
RUN npm ci --only=production

# Production image
FROM node:20-alpine

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache sqlite-libs

WORKDIR /app

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application code
COPY . .

# Create data directory for SQLite
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production

# Start the bot
CMD ["node", "index.js"]
