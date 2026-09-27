# Linux dev image for the organ explorer. Dependencies are installed inside the
# image so native modules (sharp, etc.) are built for Linux, not macOS.
FROM node:22-bookworm

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci
# Headless Chromium for the Playwright suite (npm run test:e2e) and npm run capture.
RUN npx playwright install --with-deps chromium

COPY . .

EXPOSE 3000
# Bind to 0.0.0.0 so the server is reachable from outside the container.
CMD ["sh", "-c", "npm run sync:decoders && npm run dev -- -H 0.0.0.0"]
