# Production image for the EcoGuardian CYL backend (Node.js/Express API).
#
# Two stages: the first installs dependencies with full devDependencies
# available (none are needed at runtime here, but keeping the pattern
# consistent with frontend/Dockerfile costs nothing); the second copies
# only node_modules + source into a clean, smaller final image so the
# npm cache and any build-time-only files never ship to production.
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src

# Runs as a non-root user - defense in depth, this process only ever
# talks to Postgres and the model-service over the network, it has no
# business needing root inside its own container.
# /app/uploads: videos de vuelos y fotogramas (se monta como volumen; debe ser
# escribible por el usuario sin privilegios).
RUN useradd --system --uid 1001 ecoguardian \
 && mkdir -p /app/uploads && chown -R ecoguardian /app/uploads
USER ecoguardian

EXPOSE 4000
CMD ["node", "src/index.js"]
