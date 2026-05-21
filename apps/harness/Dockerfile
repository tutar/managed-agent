# Agent sandbox image – multi-agent support via AGENT_ADAPTER build arg.
#
# Build:
#   docker build --build-arg AGENT_ADAPTER=pi ... -t managed-agent-sandbox:pi
#   docker build --build-arg AGENT_ADAPTER=claude-code ... -t managed-agent-sandbox:claude-code
#
# AGENT_ADAPTER values:
#   pi            – pi agent SDK  (default)
#   claude-code   – Claude Code CLI

ARG AGENT_ADAPTER=pi

# ── build stage (shared) ────────────────────────────────────────────────────
FROM node:22-alpine AS build
RUN apk add --no-cache bash git curl
WORKDIR /agent

# Copy workspace dependency so npm install resolves it.
COPY packages/managed-agent-contracts /tmp/contracts
COPY apps/harness/package.json /agent/package.json
RUN sed -i 's|"@managed-agent/contracts": "0.0.0"|"@managed-agent/contracts": "file:/tmp/contracts"|' /agent/package.json \
 && npm install 2>&1
COPY apps/harness/tsconfig.json /agent/tsconfig.json
COPY apps/harness/src /agent/src
RUN ./node_modules/.bin/tsc -p tsconfig.json --outDir dist 2>&1

# ── runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine
ARG AGENT_ADAPTER=pi
RUN apk add --no-cache bash git curl
WORKDIR /agent

# Install agent-specific tools
RUN if [ "$AGENT_ADAPTER" = "claude-code" ]; then \
      npm install -g @anthropic-ai/claude-code 2>&1; \
    fi

COPY --from=build /agent/dist /agent/dist
COPY --from=build /agent/node_modules /agent/node_modules

ENV MANAGED_AGENT_ADAPTER=$AGENT_ADAPTER
ENTRYPOINT ["node", "/agent/dist/entrypoint.js"]
