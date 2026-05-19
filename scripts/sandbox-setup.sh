#!/bin/bash
# Setup local sandbox environment (kind cluster + harness image).
# Run from repo root. Requires Docker and kind.
set -euo pipefail

KIND_CLUSTER="${1:-managed-agent}"
HARNESS_DIR="apps/harness"
IMAGE="managed-agent-sandbox:latest"

echo "=== Checking prerequisites ==="
command -v docker >/dev/null 2>&1 || { echo "docker not found"; exit 1; }
command -v kind >/dev/null 2>&1 || { echo "kind not found"; exit 1; }

echo "=== Building harness image ==="
docker build --platform linux/amd64 \
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
echo "Start services: npm run dev:all:sandbox"
