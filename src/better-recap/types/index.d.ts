export type RecapSession = {
  /** The title the engine last reported for the session (`session_title`). */
  title: string | null
  /** The transcript file, read for a `/rename` made since the last prompt. */
  transcriptPath: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'better-recap': { session: RecapSession }
  }
}
