# Stage 1: Build the application
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dev and production dependencies for compilation
RUN npm install

# Copy the rest of the source code
COPY . .

# Run the build script (Vite bundling + server compilation to dist/server.cjs)
RUN npm run build

# Stage 2: Clean production image
FROM node:20-slim AS runner

WORKDIR /app

# Define production environment variables
ENV NODE_ENV=production
ENV PORT=3000

# yt-dlp for YouTube audio. InnerTube gets "confirm you're not a bot" from
# most datacenter IPs; this build is a static binary, so no Python is needed.
# If it is blocked where this runs, the resolver simply falls back to previews.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 && apt-get purge -y curl \
 && rm -rf /var/lib/apt/lists/*

# Copy dependency files, public assets, and build output
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/static.html ./static.html
COPY --from=builder /app/static.svg ./static.svg

# Install only production dependencies
RUN npm install --omit=dev

# Expose port 3000
EXPOSE 3000

# Run the production bundle
CMD ["npm", "run", "start"]
