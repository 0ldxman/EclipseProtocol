# Aether: the wiki, the admin and the map, served by one Fastify process.
#
# Three stages. `deps` resolves the production dependency tree, `build` has the
# full toolchain and produces four dist folders plus the compiled server, and
# the final stage carries only what is needed to run them.
#
# The geo bundle is copied to /app/geo rather than left under data/, because
# data/ becomes a volume at runtime and a mounted volume would hide it.

# The manifests are copied on their own, before any source, so that editing a
# source file does not invalidate the install layer.
FROM node:20-alpine AS manifests
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/wiki/package.json frontend/wiki/
COPY frontend/wiki-admin/package.json frontend/wiki-admin/
COPY frontend/map-proto/package.json frontend/map-proto/
COPY packages/markup/package.json packages/markup/
COPY packages/theme/package.json packages/theme/

# ---- runtime dependencies ------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app
COPY --from=manifests /app ./
# A separate, clean install rather than pruning the build tree: what ends up in
# the image is then exactly what the lockfile calls a production install.
#
# Only the server and the markup package are installed. The frontends' runtime
# dependencies - maplibre-gl, codemirror - are bundled into their dist by Vite
# and are never loaded by node, so installing them here would add 75 MB the
# container can't use.
RUN npm ci --omit=dev \
      --workspace @aether/server \
      --workspace @aether/markup \
      --include-workspace-root

# ---- build ---------------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=manifests /app ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime -------------------------------------------------------------
FROM node:20-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3010 \
    GEO_DIR=/app/geo \
    GEO_DETAIL_DIR=/app/geo-detail \
    DATA_DIR=/data \
    LOG_LEVEL=info

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend/package.json ./backend/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/packages/markup/package.json ./packages/markup/package.json
COPY --from=build /app/packages/markup/dist ./packages/markup/dist
COPY --from=build /app/frontend/wiki/dist ./frontend/wiki/dist
COPY --from=build /app/frontend/wiki-admin/dist ./frontend/wiki-admin/dist
COPY --from=build /app/frontend/map-proto/dist ./frontend/map-proto/dist

# The baked province topology: a build artefact, not user data.
COPY --from=build /app/data/runtime ./geo

# The fine levels, read a slice at a time rather than served as files. Kept out
# of ./geo on purpose: everything under it is statically downloadable, and these
# are tens of megabytes each. Whichever levels the directory happens to hold are
# the ones the server offers; a missing level just shortens the client's ladder.
COPY --from=build /app/data/geo-detail ./geo-detail

# /data is created here and owned by the unprivileged user, so a fresh named
# volume inherits that ownership and the first write succeeds.
RUN mkdir -p /data && chown -R node:node /data
USER node

VOLUME ["/data"]
EXPOSE 3010

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

CMD ["node", "backend/dist/index.js"]
