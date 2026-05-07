# Build stage — install dev deps and compile TypeScript
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage — only production deps and compiled output
FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# wget is used by the docker healthcheck against /health.
RUN apk add --no-cache wget

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 8080

# Listen on all interfaces inside the container; the host can map this
# port via `ports:` and front it with whatever reverse proxy it likes.
CMD ["node", "dist/index.js"]
