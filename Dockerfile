FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:22-bookworm-slim AS production

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY --from=builder /app/dist ./dist
RUN mkdir -p logs
RUN chmod +x ./dist/index.js

ENV NODE_ENV=production
ENV MCP_HTTP_PORT=8000

EXPOSE 8000

CMD ["node", "dist/index.js"]