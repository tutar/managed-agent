# Managed Agent API Module Notes

## Scope

`apps/managed-agent-api` currently contains:

- `api-channel`: transport-facing HTTP/SSE code
- `control-plane`: session orchestration and projections
- `dto`: request/response normalization for the public API

## Public Contract

- Frontend-facing API boundary is specified in [openapi.yaml](./openapi.yaml).
- The OpenAPI file covers the current browser contract:
  - `GET /health`
  - `POST /sessions`
  - `PATCH /sessions/{sessionId}`
  - `DELETE /sessions/{sessionId}`
  - `POST /sessions/{sessionId}/messages`
  - `GET /sessions/{sessionId}`
  - `GET /users/{userId}/sessions`
  - `POST /sessions/{sessionId}/cancel`
  - `POST /triggers`
- SSE is documented as `text/event-stream` plus explicit event definitions under the `x-sseEvents` extension so frontend and backend can align on event names and payload shapes.
- V1 lifecycle decisions are frozen in the public contract:
  - Running sessions may be renamed.
  - Running sessions may not be deleted.
  - `DELETE /sessions/{sessionId}` is irreversible soft delete / archive.
  - `POST /sessions/{sessionId}/messages` relies on client-side prevention while `status=running`; the server does not yet hard-reject concurrent submissions.
  - Recent-session pagination uses `limit` and `cursor`, with responses returning `items`, `nextCursor`, and `hasMore`.

## Current Boundaries

- Routes parse HTTP input into DTOs before calling services.
- `ManagedSessionService` operates on domain records and worker events, not raw HTTP bodies.
- Repository contracts live under `control-plane/repositories` so service orchestration stays isolated from the concrete PostgreSQL durable store.
- The runtime now uses PostgreSQL-backed durable metadata selected by
  `MANAGED_AGENT_DATABASE_URL`.
- API tests use `PGlite` to exercise the same PostgreSQL repository
  implementations without Docker.
- Durable transcript reads now follow one configurable mount-root contract:
  - `MANAGED_AGENT_MOUNT_ROOT` maps local or container runtime storage onto the
    logical `/mnt/*` layout
  - `GET /sessions/{id}` reads pi-managed transcript files from
    `${MANAGED_AGENT_MOUNT_ROOT}/transcripts`
- Session detail responses now include durable session status and timestamps, while transcript entries include per-entry `createdAt` metadata and can persist process/tool-call replay content for frontend refresh.
- Session metadata now carries `archivedAt` so archive semantics stay separate from the runtime status enum.
- The recent-session projection now supports cursor pagination and removes archived sessions from user-facing list responses.
- Worker execution contracts are imported from `apps/harness-worker/src/jobs`, which is acceptable during scaffold stage but should become a shared internal contract package only when the shape stabilizes.
- `SessionRecord` now carries optional `piSessionFile` metadata so the worker can continue the same underlying pi session across multiple HTTP prompts.
- The current worker contract is still job-first: the API assembles execution parameters from durable metadata, while the worker does not yet read session metadata directly.
- Durable transcript truth is now treated separately from durable metadata:
  - metadata / projection / audit can live in PostgreSQL
  - transcript truth stays in pi-managed JSONL files
  - `GET /sessions/{id}` reads transcript content through `piSessionFile` instead of relying on a second platform-managed transcript store

## Near-Term Evolution

- Make PostgreSQL the default metadata backend in non-local environments.
- Keep `/mnt/*` as the logical storage contract, but make the physical mount
  root configurable through `MANAGED_AGENT_MOUNT_ROOT` for local and production
  parity.
- Move job contracts into a stable internal contract module only after API and worker shapes stop changing frequently.
- Extend the new `POST /sessions/{id}/messages` flow to support queueing and cancellation semantics instead of immediate single-run execution.
