/**
 * DTO tests for the Managed Agent API transport boundary.
 */
import assert from "node:assert/strict"
import test from "node:test"

import {
  parseCreateMessageRequestDto,
  parseCreateSessionRequestDto,
  toCancelSessionResponseDto,
  toErrorResponseDto,
} from "../src/channel/web-api/dto/session-dto.js"

test("parseCreateSessionRequestDto accepts the minimal supported input", () => {
  const dto = parseCreateSessionRequestDto({
    model: "openai/gpt-5",
    thinkingLevel: "medium",
    input: {
      content: [{ type: "text", text: "分析项目结构" }],
    },
  })

  assert.equal(dto.model, "openai/gpt-5")
  assert.equal(dto.thinkingLevel, "medium")
  assert.equal(dto.input.content[0]?.type, "text")
})

test("parseCreateSessionRequestDto rejects empty content", () => {
  assert.throws(() => {
    parseCreateSessionRequestDto({
      input: {
        content: [],
      },
    })
  }, /input\.content is required/)
})

test("parseCreateMessageRequestDto accepts the minimal supported input", () => {
  const dto = parseCreateMessageRequestDto({
    input: {
      content: [{ type: "text", text: "继续分析 test 目录" }],
    },
  })

  assert.equal(dto.input.content[0]?.type, "text")
})

test("simple response dto builders preserve expected shapes", () => {
  assert.deepEqual(toCancelSessionResponseDto("sess_1", true), {
    sessionId: "sess_1",
    accepted: true,
  })

  assert.deepEqual(toErrorResponseDto("session_not_found", "missing"), {
    error: {
      code: "session_not_found",
      message: "missing",
    },
  })
})
