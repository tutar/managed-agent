export const createActiveSessionRegistry = () => {
  const activeSessions = new Map<string, { cancel(): void }>()

  return {
    markActive(sessionId: string, options?: { cancel?: () => void }) {
      activeSessions.set(sessionId, {
        cancel: options?.cancel ?? (() => undefined),
      })
    },
    markIdle(sessionId: string) {
      activeSessions.delete(sessionId)
    },
    isActive(sessionId: string) {
      return activeSessions.has(sessionId)
    },
    cancel(sessionId: string) {
      const activeSession = activeSessions.get(sessionId)

      if (!activeSession) {
        return false
      }

      activeSession.cancel()
      return true
    },
  }
}
