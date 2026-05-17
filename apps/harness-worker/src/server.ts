/**
 * Composition root for the standalone Harness Worker service.
 */
import { createServer } from "node:http"

import { createInternalRunHttpHandler } from "./http/internal-run-server.js"
import { createSessionExecutor } from "./runtime/create-session-executor.js"

const port = Number(process.env.HARNESS_WORKER_PORT ?? "4000")

const server = createServer(
  createInternalRunHttpHandler({
    executor: createSessionExecutor(),
  }),
)

server.listen(port, () => {
  process.stdout.write(`harness-worker listening on http://127.0.0.1:${port}\n`)
})
