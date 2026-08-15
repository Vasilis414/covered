FROM node:20-slim

# Some transitive installs shell out to git.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

# Expo Go fetches the bundle and assets from whatever host the manifest
# advertises. Inside a container that would be the container's own 172.x
# address, which the phone cannot reach — so pin it to the public one.
ENV REACT_NATIVE_PACKAGER_HOSTNAME=193.23.127.23
ENV EXPO_NO_TELEMETRY=1
ENV CI=1
# The host has no swap and little headroom; cap the heap so a runaway bundler
# dies alone rather than pressuring the other containers.
ENV NODE_OPTIONS=--max-old-space-size=900

EXPOSE 8081
CMD ["npx", "expo", "start", "--port", "8081"]
