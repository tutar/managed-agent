# Agent sandbox image with pi harness.
# Production: swapped with Kata rootfs base image.

# ── build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN apk add --no-cache bash git curl
WORKDIR /agent
COPY apps/harness/package.json /agent/package.json
RUN npm install 2>&1
COPY apps/harness/tsconfig.json /agent/tsconfig.json
COPY apps/harness/src /agent/src
RUN ./node_modules/.bin/tsc -p tsconfig.json --outDir dist 2>&1

# ── runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache bash git curl
WORKDIR /agent
COPY --from=build /agent/dist /agent/dist
COPY --from=build /agent/node_modules /agent/node_modules
ENTRYPOINT ["node", "/agent/dist/entrypoint.js"]
