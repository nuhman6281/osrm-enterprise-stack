# OSRM Enterprise API Dockerfile
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install basic system dependencies
RUN apk add --no-cache \
    curl

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S osrm -u 1001

# Change ownership of app directory
RUN chown -R osrm:nodejs /app

# Switch to non-root user
USER osrm

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["node", "server.js"] 