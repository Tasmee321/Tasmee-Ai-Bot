FROM node:20-bookworm-slim

# Set working directory
WORKDIR /app

# Install system dependencies:
# - python3 + curl: needed to install yt-dlp
# - ffmpeg: not required (we use combined pre-merged formats), kept out to stay lightweight
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy the rest of the project
COPY . .

# Render (and similar platforms) provide a PORT env var; our health-check
# server in index.js binds to it automatically. 9090 is just the local default.
EXPOSE 9090

# Run the bot directly (no PM2 wrapper) so the platform can correctly
# detect crashes/restarts.
CMD ["node", "index.js"]
