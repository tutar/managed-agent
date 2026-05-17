import type { IncomingMessage, ServerResponse } from "node:http"

import { closeSse, openSse, writeSseEvent } from "../api-channel/sse.js"

type DemoEvent = {
  type: string
  data: unknown
}

export const createEventPublisher = () => {
  return {
    open(response: ServerResponse<IncomingMessage>) {
      openSse(response)
    },
    publish(response: ServerResponse<IncomingMessage>, event: DemoEvent) {
      writeSseEvent(response, event.type, event.data)
    },
    close(response: ServerResponse<IncomingMessage>) {
      closeSse(response)
    },
  }
}
