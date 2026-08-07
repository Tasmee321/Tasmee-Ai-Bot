FROM node:20-bookworm-slim

WORKDIR /app

# Install system packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    ffmpeg \
    git \
    curl \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp
RUN python3 -m pip install --no-cache-dir --upgrade pip && \
    python3 -m pip install --no-cache-dir "yt-dlp[default]"

# Copy package files
COPY package*.json ./

# Install Node dependencies
RUN npm install --omit=dev

# Copy project
COPY . .

# Health port
EXPOSE 9090

# Start bot
CMD ["node", "index.js"]
