# Ledger for Home Assistant. Stage 1 builds the web pages; stage 2 is what runs.
# It runs as root, as add-ons do: Home Assistant gives the add-on a /data folder that root owns.
# The base image is pinned to one exact published build (the part after @), so everyone who installs a
# given version of Ledger builds from the same thing. Move it on deliberately, with a new version.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 LEDGER_DATA_DIR=/data
# The repository this image was published from, so "report a problem" can point at its issues page.
ARG LEDGER_REPO=""
ENV LEDGER_REPO=$LEDGER_REPO
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 4317
CMD ["node", "server/index.js"]
