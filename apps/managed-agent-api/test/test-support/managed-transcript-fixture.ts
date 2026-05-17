/**
 * Helpers for writing durable transcript fixtures used by repository/service
 * tests.
 */
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

import type {
  DemoContentItem,
  DemoInput,
  SessionEntry,
} from "../../src/control-plane/entry-factory.js"

type ManagedTranscriptRecord =
  | {
      type: "managed_session"
      sessionId: string
      runtime: "mock"
      timestamp: string
    }
  | {
      type: "managed_entry"
      sessionId: string
      entry: {
        id: string
        parentId: string | null
        createdAt: string
        messageType: SessionEntry["messageType"]
        content: DemoContentItem[]
        input?: DemoInput
      }
    }

/**
 * Persist a managed transcript fixture using the same JSONL shape that the API
 * transcript reader consumes from the durable transcript mount.
 */
export const writeManagedTranscriptFixture = async ({
  transcriptsRoot,
  relativePath,
  sessionId,
  entries,
}: {
  transcriptsRoot: string
  relativePath: string
  sessionId: string
  entries: SessionEntry[]
}) => {
  const transcriptPath = join(transcriptsRoot, relativePath)

  await mkdir(dirname(transcriptPath), { recursive: true })

  const records: ManagedTranscriptRecord[] = [
    {
      type: "managed_session",
      sessionId,
      runtime: "mock",
      timestamp: entries[0]?.createdAt ?? new Date().toISOString(),
    },
    ...entries.map((entry) => ({
      type: "managed_entry" as const,
      sessionId,
      entry: {
        id: entry.id,
        parentId: entry.parentId,
        createdAt: entry.createdAt,
        messageType: entry.messageType,
        content: entry.content,
        ...(entry.messageType === "user" ? { input: entry.input } : {}),
      },
    })),
  ]

  await writeFile(
    transcriptPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  )

  return relativePath
}
