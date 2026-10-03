export type Mode = 'ask' | 'auto' | 'off'
/** Where the game is drawn: the band above the prompt, or a pane of its own. */
export type Place = 'band' | 'dock'
export type PauseSignal = { seq: number; reason: string }
/** The start screen: `seq` rises to play it in an open game, `pending` plays it in one just opened. */
export type IntroSignal = { seq: number; pending: boolean }

declare module 'claude-code' {
  interface PluginState {
    invaders: {
      mode: Mode
      place: Place
      bandOpen: boolean
      offer: boolean
      working: boolean
      pause: PauseSignal
      resetSeq: number
      intro: IntroSignal
    }
  }
}
