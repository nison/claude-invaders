import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { IntroSignal, Mode, PauseSignal, Place } from '../types/index.d.ts'
import { MAX_H, W } from './engine.ts'

const PANE = 'invaders'
/** The terminal width from which the fullscreen layout docks a pane beside the chat. */
const DOCK_COLUMNS = 110
const TITLE = 'Invaders'
const MODES: readonly Mode[] = ['ask', 'auto', 'off']
const PLACES: readonly Place[] = ['band', 'dock']

const mode = atom({ plugin: 'invaders', key: 'mode' } as const, 'ask' as Mode)
// The band is drawn on the terminal's own background; a docked pane is painted
// by Claude Code's theme, which a plugin cannot change. So the band is the default.
const place = atom({ plugin: 'invaders', key: 'place' } as const, 'band' as Place)
const bandOpen = atom({ plugin: 'invaders', key: 'bandOpen' } as const, false)
const offer = atom({ plugin: 'invaders', key: 'offer' } as const, false)
const working = atom({ plugin: 'invaders', key: 'working' } as const, false)
const pause = atom({ plugin: 'invaders', key: 'pause' } as const, { seq: 0, reason: '' } as PauseSignal)
const resetSeq = atom({ plugin: 'invaders', key: 'resetSeq' } as const, 0)
const intro = atom({ plugin: 'invaders', key: 'intro' } as const, { seq: 0, pending: false } as IntroSignal)

/**
 * Unasked, the game shows up (offered in ask mode, opened in auto) at most
 * PER_DAY times a day. The first comes once a turn has run a random 20 to 90
 * seconds, drawn each day; the second only for a long one: a long prompt, or
 * Claude still working after LONG_TURN_MS.
 */
const PER_DAY = 2
const FIRST_MIN_MS = 20_000
const FIRST_MAX_MS = 90_000
const LONG_PROMPT_CHARS = 500
const LONG_PROMPT_DELAY_MS = 20_000
const LONG_TURN_MS = 3 * 60_000

type Daily = { day: string; count: number; firstDelayMs: number }

function dayOf(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

async function today($: EngineInterface): Promise<Daily> {
  const day = dayOf(await $.clock.now())
  const saved = (await $.store.get('daily')) as Daily | undefined
  if (saved?.day === day) return saved
  const firstDelayMs = FIRST_MIN_MS + Math.floor(Math.random() * (FIRST_MAX_MS - FIRST_MIN_MS))
  return { day, count: 0, firstDelayMs }
}

/** How far into a turn today's next showing comes, or null when today's are spent. */
function showDelay(daily: Daily, promptChars: number): number | null {
  if (daily.count === 0) return daily.firstDelayMs
  if (daily.count < PER_DAY) return promptChars >= LONG_PROMPT_CHARS ? LONG_PROMPT_DELAY_MS : LONG_TURN_MS
  return null
}

// The pending showing for the running turn, cancelled when the turn ends.
let pending: Timer | null = null

function cancelPending() {
  pending?.cancel()
  pending = null
}

async function showNow($: EngineInterface) {
  pending = null
  const current = await read($, mode)
  if (current === 'off' || !(await read($, working)) || (await isOpen($))) return
  const daily = await today($)
  if (daily.count >= PER_DAY) return
  await $.store.set('daily', { ...daily, count: daily.count + 1 })
  if (current === 'auto') await openGame($, false)
  else await update($, offer, () => true)
}

const HELP = [
  'Invaders: a tiny Space Invaders to play while Claude works. Playing never interrupts Claude.',
  '',
  '/invaders              open the game (click the board to play; progress is saved)',
  '/invaders ask          offer a game while Claude works, at most twice a day (default)',
  '/invaders auto         open the game by itself instead, at most twice a day',
  '/invaders off          only open it with /invaders',
  '/invaders band         play above the prompt, on the terminal\'s own background (default)',
  '/invaders dock         play in a pane beside the chat, full height, in Claude Code\'s pane color',
  '/invaders reset        start over from wave 1',
  '/invaders intro        play the start screen again',
  '/invaders close        close the game',
  '/invaders help         show this help',
  '',
  'Keys, once the board has been clicked:',
  '  ←/→ or a/d   move (tap for 2 cells, hold to glide)',
  '  space        fire, up to 3 shots',
  '  p            pause or resume',
  '  h            hide the board down to one line, and show it again',
  '  q            close the game',
  '  esc          hand the keys back to the prompt (the game stays open)',
  '',
  'The game pauses when Claude finishes or when you send a prompt.',
].join('\n')

// A surface that cannot list panes (the test kit's) reads as none open: at
// worst the game is offered while it is up.
async function isPaneOpen($: EngineInterface) {
  try {
    return (await $.ui.panes()).some(pane => pane.id === PANE)
  } catch {
    return false
  }
}

async function isOpen($: EngineInterface) {
  return (await read($, bandOpen)) || (await isPaneOpen($))
}

async function closeGame($: EngineInterface) {
  await update($, bandOpen, () => false)
  await update($, intro, i => ({ ...i, pending: false }))
  if (await isPaneOpen($)) await $.ui.close({ id: PANE })
}

async function playIntro($: EngineInterface) {
  await update($, intro, i => ({ seq: i.seq + 1, pending: true }))
}

async function openGame($: EngineInterface, focus: boolean) {
  await update($, offer, () => false)
  // The start screen plays the first time the game is ever opened.
  if (!(await $.store.get('introSeen'))) {
    await $.store.set('introSeen', true)
    await playIntro($)
  }
  if ((await read($, place)) === 'band') {
    await update($, bandOpen, () => true)
    return { isPlaced: true as const }
  }
  // The board plus its two border lines; Escape closes the pane (the game is saved as it goes).
  return $.ui.open({
    id: PANE,
    title: TITLE,
    rows: MAX_H + 2,
    columns: W + 4,
    closeOnEscape: true,
    ...(focus ? { focus: true } : {}),
  })
}

async function registerCommand($: EngineInterface) {
  await $.command.register({
    name: 'invaders',
    description: 'Play a tiny Space Invaders while Claude works',
    argumentHint: '[help | ask|auto|off | band|dock | reset | intro | close]',
    immediate: true,
  })
}

// A mod loaded mid-session may miss session.start, so the command is also
// registered on the first prompt or turn this module sees.
let isRegistered = false

async function ensureCommand($: EngineInterface) {
  if (isRegistered) return
  isRegistered = true
  await registerCommand($)
}

async function setMode($: EngineInterface, next: Mode) {
  await $.store.set('mode', next)
  await update($, mode, () => next)
}

export const register: Register = on => {
  // Whether the game was running at the last save, so a pause toasts only then.
  let isPlaying = false

  on('session.start', async ($, e, next) => {
    await ensureCommand($)
    const stored = await $.store.get('mode')
    if (MODES.includes(stored as Mode)) await update($, mode, () => stored as Mode)
    const where = await $.store.get('place')
    if (PLACES.includes(where as Place)) await update($, place, () => where as Place)

    return next(e)
  })

  on('command.run', { command: 'invaders' }, async ($, e) => {
    const [verb = '', arg = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === '' || verb === 'play' || verb === 'open') {
      const opened = await openGame($, true)
      if ((await read($, place)) === 'band') {
        return { text: 'Invaders is open above the prompt. Click the board to play. h hides it, q closes it. /invaders help lists the keys.' }
      }
      // Where the pane sits is said in the pane, which is told its placement; the
      // width a command sees is the chat's, narrower than the terminal once docked.
      return {
        text: opened.isPlaced
          ? 'Invaders is open. Press space to play, or click the board if keys do not reach it. h hides it, Esc closes it.'
          : 'Invaders is open but has no room yet; widen the terminal.',
      }
    }
    if (PLACES.includes(verb as Place)) {
      const wasOpen = await isOpen($)
      if (wasOpen) await closeGame($)
      await $.store.set('place', verb)
      await update($, place, () => verb as Place)
      if (wasOpen) await openGame($, true)
      return {
        text:
          verb === 'band'
            ? 'Invaders will play above the prompt, on the terminal\'s own background.'
            : 'Invaders will play in a pane beside the chat (above the prompt under 110 columns), in Claude Code\'s pane color.',
      }
    }
    // `/invaders ask` is short for `/invaders mode ask`.
    const choice = verb === 'mode' ? arg : MODES.includes(verb as Mode) ? verb : null
    if (choice !== null) {
      if (!MODES.includes(choice as Mode)) {
        return { text: `Invaders mode is "${await read($, mode)}". Use /invaders mode ask|auto|off.` }
      }
      await setMode($, choice as Mode)
      const what = { ask: 'offer a game while Claude works, at most twice a day', auto: 'open by itself while Claude works, at most twice a day', off: 'only open with /invaders' }
      return { text: `Invaders will ${what[choice as Mode]}.` }
    }
    if (verb === 'reset') {
      await $.store.delete('save')
      await update($, resetSeq, n => n + 1)
      return { text: 'Invaders reset to wave 1 (your high score is kept while the pane is open).' }
    }
    if (verb === 'intro') {
      await playIntro($)
      await openGame($, true)
      return { text: 'Invaders start screen. Click the board to play.' }
    }
    if (verb === 'help' || verb === '?') return { text: HELP }
    if (verb === 'close') {
      await closeGame($)
      return { text: 'Invaders closed. Your game is saved.' }
    }

    return { text: `Invaders does not know "${verb}".\n\n${HELP}` }
  })

  on('prompt.submit', async ($, e, next) => {
    await ensureCommand($)
    // The band is not told when the keys leave it, so a prompt sent is the sign.
    if (await read($, bandOpen)) await update($, pause, p => ({ seq: p.seq + 1, reason: 'Back at the prompt' }))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await ensureCommand($)
    await update($, working, () => true)
    cancelPending()
    if ((await read($, mode)) !== 'off' && !(await isOpen($))) {
      const delay = showDelay(await today($), e.text.length)
      if (delay !== null) pending = $.clock.after(delay, () => void showNow($))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    cancelPending()
    await update($, working, () => false)
    await update($, offer, () => false)
    if (await isOpen($)) {
      await update($, pause, p => ({ seq: p.seq + 1, reason: 'Claude finished. Back to work!' }))
      if (isPlaying) $.ui.toast('Claude finished: Invaders paused')
      isPlaying = false
    }

    return next(e)
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE && e.component !== 'AbovePrompt') return next(e)
    const data = e.data as { type?: string; game?: unknown; paused?: boolean } | null
    if ((data?.type === 'save' || data?.type === 'close') && data.game) {
      isPlaying = data.paused === false
      await $.store.set('save', data.game)
    }
    if (data?.type === 'intro-done') await update($, intro, i => ({ ...i, pending: false }))
    if (data?.type === 'close') await closeGame($)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Invaders plays in the terminal or the desktop app.</Text>
    }
    const { Box, Client } = $.ui.resolve(e)
    const props = {
      save: (await $.store.get('save')) ?? null,
      pause: await read($, pause),
      resetSeq: await read($, resetSeq),
      intro: await read($, intro),
      working: await read($, working),
      isFocused: e.props.isFocused,
      bodyRows: e.props.scroll.bodyRows,
      placement: e.props.placement,
      terminalColumns: e.viewport?.columns ?? DOCK_COLUMNS,
    }

    // Written as calls, not JSX, so the surface module's path reads as a plain string.
    return Box({ flexDirection: 'column', children: [Client({ key: 'game', module: './game.tsx', props })] })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((e.surface === 'terminal' || e.surface === 'desktop') && (await read($, bandOpen))) {
      const { Box, Client } = $.ui.resolve(e)
      const props = {
        save: (await $.store.get('save')) ?? null,
        pause: await read($, pause),
        resetSeq: await read($, resetSeq),
        intro: await read($, intro),
        working: await read($, working),
        // The band has no focus prop; the game pauses on a sent prompt instead.
        isFocused: true,
        bodyRows: e.props.maxRows,
        placement: 'band',
        terminalColumns: e.viewport?.columns ?? DOCK_COLUMNS,
      }

      // The board sits in the middle of the band, whatever its width.
      return Box({
        flexDirection: 'column',
        alignItems: 'center',
        width: e.props.bodyColumns,
        children: [Client({ key: 'game', module: './game.tsx', props })],
      })
    }
    if (!e.props.isWorking || !(await read($, offer))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box gap={1}>
        <Text bold>{'/o\\'}</Text>
        <Text dimColor>Claude is working. Play Invaders?</Text>
        <Button key="play" label="Play" hotkey="p" variant="primary" onPress={() => openGame($, true)} />
        <Button
          key="always"
          label="Always"
          hotkey="a"
          onPress={async () => {
            await setMode($, 'auto')
            await openGame($, true)
          }}
        />
        <Button
          key="never"
          label="Never"
          hotkey="n"
          onPress={async () => {
            await setMode($, 'off')
            await update($, offer, () => false)
            $.ui.toast('Invaders will not ask again. /invaders to play, /invaders mode ask to undo.')
          }}
        />
        <Button key="later" label="Not now" hotkey="x" role="dismiss" onPress={() => update($, offer, () => false)} />
      </Box>
    )
  })
}
