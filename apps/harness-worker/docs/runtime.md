# Harness Worker Runtime Notes

## Scope

`apps/harness-worker` now contains three layers:

- `jobs`: worker job input/output contracts
- `runtime`: runtime selection and execution adapters
- `http`: internal HTTP transport for the standalone worker service

## Runtime Modes

- `mock`: default mode, deterministic local event stream for scaffold development
- `pi`: opt-in mode enabled with `MANAGED_AGENT_RUNTIME=pi`

For the current manual validation baseline, prefer:

- `DEEPSEEK_API_KEY`
- `MANAGED_AGENT_DEFAULT_MODEL=deepseek/deepseek-v4-pro`
- `MANAGED_AGENT_MOUNT_ROOT=/mnt`

## Current `pi` Integration

The `pi` path currently uses `@earendil-works/pi-coding-agent` with:

- `createAgentSession()`
- `AuthStorage.create()`
- `ModelRegistry.create()`
- `SessionManager.create()` / `SessionManager.open()`

This is intentionally minimal:

- one durable transcript/session file per managed session
- local cwd-based discovery
- best-effort model lookup from `provider/modelId`
- event mapping only for the subset of events the current API layer understands
- transcript/session files rooted at `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`

When the API record already has a `piSessionFile`, the worker reopens that
session with `SessionManager.open(...)` so later prompts can continue the same
underlying pi conversation.

## Worker Service Boundary

The standalone worker accepts a fully prepared run job over internal HTTP.
During the current phase it does not read API metadata directly. The API
service remains the orchestration owner and passes the execution parameters the
worker needs for one run.

## Known Limits

- It does not yet rebuild durable sessions.
- It does not yet mount sandboxed tools or custom operations.
- It still relies on API-side metadata to locate `piSessionFile`; there is no
  worker-side metadata read path yet.

## Durable Mount Layout

The worker treats `MANAGED_AGENT_MOUNT_ROOT` as the only durable mount entry
point and derives stable production-style suffixes from it:

- `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`
- `${MANAGED_AGENT_MOUNT_ROOT}/user-data/uploads`
- `${MANAGED_AGENT_MOUNT_ROOT}/user-data/outputs`
- `${MANAGED_AGENT_MOUNT_ROOT}/user-data/tool_results`
- `${MANAGED_AGENT_MOUNT_ROOT}/skills`
- `${MANAGED_AGENT_MOUNT_ROOT}/extensions`

In production, the root stays `/mnt`. For local validation, point it at a
repo-local directory so the logical path layout stays the same without
requiring a literal container mount.
