import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

import { ANSI, INK, TICK_MS, W, draw, drawIntro, fire, fitHeight, move, newGame, resize, restore, savedHi, step } from './engine'
import type { Game } from './engine'

export type GameProps = {
  save: JsonValue
  pause: { seq: number; reason: string }
  resetSeq: number
  intro: { seq: number; pending: boolean }
  working: boolean
  isFocused: boolean
  /** Rows the pane shows (its body), so the board can fit them. */
  bodyRows: number
  /** A pane's seat (`dock`, `inline`), or `band` for the band above the prompt. */
  placement: 'dock' | 'inline' | 'band'
  /** The terminal's width, to say how wide it must be for the pane to dock. */
  terminalColumns: number
}

type Local = {
  game: Game
  paused: boolean
  note: string
  seenPause: number
  seenReset: number
  wasFocused: boolean
  sinceSave: number
  room: number
  /** Folded to one line, the game paused beneath, until h shows it again. */
  hidden: boolean
  /** Ticks into the start screen, or -1 when it is not playing. */
  intro: number
  seenIntro: number
  /**
   * Whether keys reach the board. A pane says (`isFocused`); the band does not,
   * so there it is false until a click or key arrives, and again once a prompt is sent.
   */
  hasKeys: boolean
}

/** Lines around the board: the top border with the score, the bottom with the keys. */
const CHROME = 2
const SAVE_EVERY = 8
// Escape only hands the band's keys back to the prompt, so q closes the game.
const KEYS = ' spc:fire p:pause h:hide q:quit '
/** The terminal width from which the fullscreen layout docks a pane beside the chat. */
const DOCK_COLUMNS = 110

function save(surface: ClientSurface<Local>, s: Local) {
  surface.post({ type: 'save', game: s.game, paused: s.paused })
}

function pauseWith(surface: ClientSurface<Local>, s: Local, note: string): Local {
  const next = { ...s, paused: true, note, sinceSave: 0 }
  save(surface, next)
  return next
}

/** A click hands the board the keys, so it also does what space would: play. */
function onClick(surface: ClientSurface<Local>) {
  const s = surface.state
  if (!s) return
  if (s.intro >= 0) surface.post({ type: 'intro-done' })
  if (s.game.over && s.intro < 0 && !s.hidden) {
    surface.setState({ ...s, hasKeys: true, game: newGame(s.game.hi, s.game.seed, fitHeight(s.room, CHROME)) })
    return
  }
  surface.setState({ ...s, hasKeys: true, intro: -1, hidden: false, paused: false, note: '' })
}

function onKey(surface: ClientSurface<Local>, key: string) {
  let s = surface.state
  if (!s) return
  if (!s.hasKeys) s = { ...s, hasKeys: true }
  const isGo = key === ' ' || key === 'space' || key === 'return'

  if (key === 'q') {
    surface.post({ type: 'close', game: s.game, paused: true })
    return
  }
  if (s.intro >= 0) {
    // Any key ends the start screen; space goes straight into the game.
    surface.post({ type: 'intro-done' })
    surface.setState({ ...s, intro: -1, ...(isGo ? { paused: false, note: '' } : {}) })
    return
  }
  if (key === 'h') {
    surface.setState(s.hidden ? { ...s, hidden: false } : { ...pauseWith(surface, s, s.paused ? s.note : 'Paused'), hidden: true })
    return
  }
  if (s.hidden) return
  if (key === 'p') {
    const next = s.paused ? { ...s, paused: false, note: '' } : pauseWith(surface, s, 'Paused')
    surface.setState(next)
    return
  }
  if (s.paused) {
    surface.setState(isGo ? { ...s, paused: false, note: '' } : s)
    return
  }
  if (s.game.over) {
    if (key === 'r' || isGo) {
      const game = newGame(s.game.hi, s.game.seed, fitHeight(s.room, CHROME))
      surface.setState({ ...s, game })
    }
    return
  }

  let game = s.game
  if (key === 'left' || key === 'a') game = move(game, -1)
  else if (key === 'right' || key === 'd') game = move(game, 1)
  else if (isGo || key === 'up' || key === 'w' || key === 'k') game = fire(game)
  if (game !== s.game || s !== surface.state) surface.setState({ ...s, game })
}

function onTick(surface: ClientSurface<Local>) {
  const s = surface.state
  if (s && s.intro >= 0 && !s.hidden) {
    surface.setState({ ...s, intro: s.intro + 1 })
    return
  }
  if (!s || s.paused || s.game.over) return
  const game = step(resize(s.game, fitHeight(s.room, CHROME)))
  const sinceSave = s.sinceSave + 1
  const next = { ...s, game, sinceSave }
  if (sinceSave >= SAVE_EVERY || game.over || game.level !== s.game.level) {
    next.sinceSave = 0
    save(surface, next)
  }
  surface.setState(next)
}

function bannerFor(s: Local): string[] | undefined {
  if (s.game.over) return ['GAME OVER', `score ${s.game.score}`, s.hasKeys ? 'r to play again' : 'click to play again']
  if (s.paused) {
    const lines = ['PAUSED']
    if (s.note && s.note !== 'Paused') lines.push(s.note)
    lines.push(s.hasKeys ? 'space / p to play' : 'click to play')
    return lines
  }
  if (s.game.cleared > 0) return [`WAVE ${s.game.level}`]
  return undefined
}

function pad(n: number, width: number) {
  return String(n).padStart(width, '0')
}

const Invaders: ClientModule<GameProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let s = surface.state

  if (s === undefined) {
    const restored = restore(props.save)
    s = {
      game: restored ?? newGame(savedHi(props.save)),
      paused: true,
      note: restored ? `Welcome back: wave ${restored.level}` : 'Ready?',
      seenPause: props.pause.seq,
      seenReset: props.resetSeq,
      wasFocused: props.isFocused,
      sinceSave: 0,
      room: props.bodyRows,
      hidden: false,
      intro: props.intro.pending ? 0 : -1,
      seenIntro: props.intro.seq,
      hasKeys: props.placement !== 'band' && props.isFocused,
    }
    s = { ...s, game: resize(s.game, fitHeight(props.bodyRows, CHROME)) }
    surface.setState(s)
    surface.every(TICK_MS, () => onTick(surface))
    surface.onKey(e => onKey(surface, e.key))
    surface.onPointer(e => {
      if (e.type === 'down') onClick(surface)
    })
  } else {
    let next = s
    if (props.resetSeq > next.seenReset) {
      next = { ...next, seenReset: props.resetSeq, game: newGame(next.game.hi), paused: true, note: 'New game' }
    }
    if (props.intro.seq > next.seenIntro) {
      if (!next.paused) next = pauseWith(surface, next, 'Paused')
      next = { ...next, seenIntro: props.intro.seq, intro: 0, hidden: false }
    }
    if (props.pause.seq > next.seenPause) {
      next = { ...next, seenPause: props.pause.seq }
      // A prompt sent from the band means the keys went back to the prompt.
      if (props.placement === 'band' && props.pause.reason === 'Back at the prompt') next = { ...next, hasKeys: false }
      if (!next.paused) next = pauseWith(surface, next, props.pause.reason)
    }
    if (next.wasFocused && !props.isFocused && !next.paused) {
      next = pauseWith(surface, next, 'Back at the prompt')
    }
    if (next.wasFocused !== props.isFocused) next = { ...next, wasFocused: props.isFocused, hasKeys: props.isFocused }
    if (next.room !== props.bodyRows) next = { ...next, room: props.bodyRows }
    // A game not yet started takes the pane's height straight away.
    const fitted = resize(next.game, fitHeight(next.room, CHROME))
    if (fitted.tick === 0 && fitted !== next.game) next = { ...next, game: fitted }
    // Mid-wave the board keeps its height, so a pane shrunk under it pauses play.
    if (next.room > 0 && next.room < next.game.h && !next.paused) {
      next = pauseWith(surface, next, 'Pane too short')
    }
    if (next !== s) {
      surface.setState(next)
      s = next
    }
  }

  if (surface.columns > 0 && surface.columns < W + 2) {
    return <Text dimColor>Widen the pane to {W + 2} columns to play.</Text>
  }

  const g = s.game
  const rows = s.intro >= 0 ? drawIntro(s.intro, g.h, s.hasKeys ? 'PRESS SPACE TO PLAY' : 'CLICK TO PLAY') : draw(g, bannerFor(s))
  const hearts = '♥'.repeat(Math.max(0, g.lives))
  const stats = ` ${pad(g.score, 5)}  HI ${pad(g.hi, 5)}  W${g.level} `
  const status = props.working ? ' ● ' : ' ○ '
  const fill = '─'.repeat(Math.max(0, W - stats.length - hearts.length - status.length))
  const keysFill = '─'.repeat(Math.max(0, W - KEYS.length))

  if (s.hidden) {
    return (
      <Text>
        <Text {...INK.gold}>{'/o\\'}</Text>
        <Text dimColor>
          {' '}
          Invaders hidden: wave {g.level}, score {g.score}. {s.hasKeys ? 'h shows it, q quits.' : 'Click to play.'}
        </Text>
      </Text>
    )
  }

  // Too short for the whole frame: the bottom border goes first, then the top.
  const room = s.room > 0 ? s.room : g.h + CHROME
  if (room < g.h) {
    const fix =
      props.placement === 'band'
        ? 'Make the terminal taller, or /invaders dock to play in a pane beside the chat.'
        : props.placement === 'inline' && props.terminalColumns < DOCK_COLUMNS
          ? `Widen the terminal to ${DOCK_COLUMNS}+ columns (now ${props.terminalColumns}) so it docks beside the chat, full height.`
          : 'Make the terminal taller, or drag the pane taller.'
    const where = props.placement === 'band' ? 'the band above the prompt' : 'this pane'
    return (
      <Box flexDirection="column">
        <Text bold>Invaders needs {g.h} rows; {where} shows {room}.</Text>
        <Text dimColor>{fix}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column">
      {room >= g.h + 1 && (
        <Text>
          <Text dimColor>┌</Text>
          <Text {...INK.gold}>{stats}</Text>
          <Text {...INK.pink}>{hearts}</Text>
          <Text dimColor>{fill}</Text>
          <Text color={props.working ? ANSI.yellowBright : ANSI.greenBright}>{status}</Text>
          <Text dimColor>┐</Text>
        </Text>
      )}
      {rows.map(runs => (
        <Text>
          <Text dimColor>│</Text>
          {runs.map(run => (
            <Text color={run.color} bold={run.bold} dimColor={run.dim}>
              {run.text}
            </Text>
          ))}
          <Text dimColor>│</Text>
        </Text>
      ))}
      {room >= g.h + 2 && (
        <Text dimColor>
          └{KEYS}
          {keysFill}┘
        </Text>
      )}
    </Box>
  )
}

export default Invaders
