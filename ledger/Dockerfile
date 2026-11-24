# Ledger for Home Assistant. Stage 1 builds the web pages; stage 2 is what runs.
# The same as the ordinary Dockerfile except that it runs as the add-on's own user, which owns /data.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 LEDGER_DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 4317
CMD ["node", "server/index.js"]
