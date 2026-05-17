#!/usr/bin/env bash

set -euo pipefail

# Reset all repo-local durable artifacts so transcript files, test fixtures,
# and legacy app-scoped state cannot leak into the next manual verification run.
rm -rf \
  .managed-agent \
  apps/harness-worker/.managed-agent \
  apps/managed-agent-api/.managed-agent

# Recreate the canonical local mount layout immediately so follow-up runs use
# the same root without depending on side effects from the worker startup path.
mkdir -p \
  .managed-agent/mnt/transcripts \
  .managed-agent/mnt/user-data/uploads \
  .managed-agent/mnt/user-data/outputs \
  .managed-agent/mnt/user-data/tool_results \
  .managed-agent/mnt/skills \
  .managed-agent/mnt/extensions

# Reset durable metadata in the local PostgreSQL container when it is available.
if docker compose -f infra/local/docker-compose.yml exec -T postgres true >/dev/null 2>&1; then
  docker compose -f infra/local/docker-compose.yml exec -T postgres \
    psql -U postgres -d managed_agent \
    -c "TRUNCATE TABLE managed_agent_audit_records, managed_agent_user_sessions, managed_agent_sessions RESTART IDENTITY CASCADE;"
fi
