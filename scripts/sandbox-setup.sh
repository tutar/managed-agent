#!/bin/bash
# Setup local sandbox environment (kind cluster + harness image).
# Run from repo root. Requires Docker and kind.
#
# Usage:
#   ./scripts/sandbox-setup.sh              # pi adapter (default)
#   ./scripts/sandbox-setup.sh claude-code   # Claude Code adapter
set -euo pipefail

ADAPTER="${1:-pi}"
KIND_CLUSTER="${2:-managed-agent}"
HARNESS_DIR="apps/harness"
IMAGE="managed-agent-sandbox:${ADAPTER}"

echo "=== Building harness image (adapter: ${ADAPTER}) ==="
docker build --platform linux/amd64 \
  --build-arg "AGENT_ADAPTER=${ADAPTER}" \
  -f "$HARNESS_DIR/Dockerfile" \
  . \
  -t "$IMAGE"

echo "=== Ensuring kind cluster '$KIND_CLUSTER' ==="
if ! kind get clusters 2>/dev/null | grep -q "^${KIND_CLUSTER}$"; then
  HTTP_PROXY="" HTTPS_PROXY="" http_proxy="" https_proxy="" \
  kind create cluster --name "$KIND_CLUSTER"
else
  echo "Cluster '$KIND_CLUSTER' already exists."
fi

echo "=== Loading image into kind ==="
docker save "$IMAGE" -o /tmp/sandbox-image.tar
docker exec -i "${KIND_CLUSTER}-control-plane" \
  ctr --namespace=k8s.io images import \
  --base-name "docker.io/library/$IMAGE" \
  - < /tmp/sandbox-image.tar
rm -f /tmp/sandbox-image.tar

echo "=== Done ==="
echo "Start: MANAGED_AGENT_ADAPTER=${ADAPTER} npm run dev:all:sandbox"
