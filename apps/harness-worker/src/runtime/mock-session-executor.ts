import type {
  SessionExecutor,
  SessionRunCompletion,
  SessionRunEvent,
  SessionRunJob,
} from "../jobs/session-run-job.js"
import { createMockTranscriptStore } from "./mock-transcript-store.js"

/**
 * Mock executor used when the project runs without a real pi-backed model.
 *
 * It preserves the worker event contract so the API and control-plane layers
 * can be developed before durable storage and real sandbox execution land.
 */
const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })

const summarizeInput = (job: SessionRunJob) => {
  const firstText = job.input.content.find((item) => item.type === "text")

  if (!firstText?.text) {
    return "收到一个非文本输入，当前本地 runtime 只返回最小确认结果。"
  }

  return `已接收请求：${firstText.text}`
}

const buildFinalText = (job: SessionRunJob) => {
  const firstText = job.input.content.find((item) => item.type === "text")

  if (!firstText?.text) {
    return "当前本地运行已完成，但现在只对文本输入生成更具体的结果。"
  }

  return `当前本地运行已完成。mock harness worker 已返回最小 SSE 事件流，并保留 session transcript。输入内容：${firstText.text}`
}

/**
 * Build a deterministic worker executor for the local mock path.
 */
export const createMockSessionExecutor = ({
  transcriptStore = createMockTranscriptStore(),
}: {
  transcriptStore?: ReturnType<typeof createMockTranscriptStore>
} = {}): SessionExecutor => {
  return {
    async *run(
      job: SessionRunJob,
    ): AsyncGenerator<SessionRunEvent, SessionRunCompletion> {
      const firstText = job.input.content.find((item) => item.type === "text")
      const toolCallId = "tool_call_mock_1"

      // Keep the event order stable so local transcript projection is predictable.
      yield {
        type: "process.delta",
        data: {
          sessionId: job.sessionId,
          entryId: job.processEntryId,
          parentId: job.userEntry.id,
          text: summarizeInput(job),
        },
      }

      await delay(30)

      yield {
        type: "action.started",
        data: {
          sessionId: job.sessionId,
          entryId: job.processEntryId,
          parentId: job.userEntry.id,
          toolCallId,
          name: "mock-harness-worker",
          arguments: firstText?.text,
        },
      }

      await delay(30)

      yield {
        type: "action.completed",
        data: {
          sessionId: job.sessionId,
          entryId: job.processEntryId,
          parentId: job.userEntry.id,
          toolCallId,
          name: "mock-harness-worker",
          arguments: firstText?.text,
          result: "ok",
        },
      }

      await delay(30)

      const finalText = buildFinalText(job)

      yield {
        type: "final.output.delta",
        data: {
          sessionId: job.sessionId,
          entryId: job.finalEntryId,
          parentId: job.processEntryId,
          text: finalText,
        },
      }

      await delay(10)

      yield {
        type: "final.output.completed",
        data: {
          sessionId: job.sessionId,
          entryId: job.finalEntryId,
        },
      }

      const transcriptFile = await transcriptStore.appendRunTranscript({
        job,
        summaryText: summarizeInput(job),
        toolCallId,
        finalText,
      })

      return {
        piSessionFile: transcriptFile,
      }
    },
  }
}
