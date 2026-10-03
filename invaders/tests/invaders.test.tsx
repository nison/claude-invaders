import { describe, expect, mock, test } from 'claude-code/testing'

import { MAX_H, MIN_H, W, draw, drawIntro, fire, fitHeight, move, newGame, resize, restore, step } from '../hooks/engine'
import type { Game } from '../hooks/engine'

const PANE_PROPS = {
  title: 'Invaders',
  isFocused: true,
  bodyColumns: 60,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const PANE = {
  plugin: 'invaders',
  component: 'Pane' as const,
  requestId: 'invaders',
  props: PANE_PROPS,
  viewport: { columns: 160, rows: 40, isFullscreen: true },
}

function run(g: Game, ticks: number) {
  for (let i = 0; i < ticks; i++) g = step(g)
  return g
}

describe('engine', () => {
  test('a shot straight up hits the bottom invader and scores', async () => {
    let g = newGame()
    const target = g.invaders.filter(i => i.row === 3)[0]!
    g = { ...g, px: target.x, seed: 1, invaders: [target], shields: [] }
    g = fire(g)
    const before = g.score
    g = run(g, g.h)
    expect(g.score).toBeGreaterThan(before)
  })

  test('clearing a wave moves to the next level with a new formation and shields', async () => {
    let g = newGame()
    g = { ...g, invaders: [], shields: [] }
    g = step(g)
    expect(g.level).toBe(2)
    g = run(g, 40)
    expect(g.invaders.length).toBe(24)
    expect(g.shields.length).toBeGreaterThan(0)
  })

  test('a bomb on the player costs a life, three lose the game', async () => {
    let g = newGame()
    for (let n = 0; n < 3; n++) {
      g = { ...g, tick: 0, invuln: 0, bombs: [{ x: g.px + 1, y: g.h - 1 }] }
      g = step(g)
    }
    expect(g.lives).toBe(0)
    expect(g.over).toBe(true)
  })

  test('rapid fire: up to three shots, a short reload between them', async () => {
    let g: Game = { ...newGame(), invaders: [{ x: 0, y: 2, row: 0 }], shields: [] }
    g = fire(g)
    expect(fire(g).shots.length).toBe(1)
    for (let n = 0; n < 4; n++) g = fire(run(g, 3))
    expect(g.shots.length).toBe(3)
    const top = Math.min(...g.shots.map(s => s.y))
    expect(run(g, 1).shots.every(s => s.y < g.h - 2)).toBe(true)
    expect(top).toBeLessThan(g.h - 2 - 2 * 3)
  })

  test('an old save with a single shot still loads', async () => {
    const { shots, reload, ...rest } = newGame()
    const old = { ...rest, shot: { x: 5, y: 5 } }
    expect(restore(old)?.shots).toEqual([{ x: 5, y: 5 }])
  })

  test('a tap moves two cells; a held key glides between repeats', async () => {
    let g: Game = { ...newGame(), invaders: [{ x: 0, y: 2, row: 0 }], shields: [], seed: 1 }
    const start = g.px
    g = move(g, -1)
    expect(g.px).toBe(start - 2)
    g = run(g, 3)
    expect(g.px).toBe(start - 2)

    g = move(run(g, 5), -1)
    expect(g.px).toBe(start - 3)
    g = run(g, 3)
    expect(g.px).toBe(start - 6)

    // Turning around stops the glide at once.
    g = move(move(g, -1), 1)
    expect(run(g, 3).px).toBe(g.px)
  })

  test('the player stays on the board', async () => {
    const g = newGame()
    expect(g.px).toBeGreaterThanOrEqual(0)
    expect(g.px).toBeLessThanOrEqual(W - 3)
  })

  test('shields stop shots and bombs, crumbling after two hits', async () => {
    let g = newGame()
    const brick = g.shields.find(b => b.y === g.h - 3)!
    g = { ...g, invaders: [{ x: 0, y: 2, row: 0 }], px: brick.x - 1, seed: 1 }
    g = run(fire(g), 2)
    expect(g.shots.length).toBe(0)
    expect(g.shields.find(b => b.x === brick.x && b.y === brick.y)?.hp).toBe(1)

    g = { ...g, tick: 1, bombs: [{ x: brick.x, y: brick.y - 1 }] }
    g = step(g)
    expect(g.bombs.length).toBe(0)
    expect(g.shields.find(b => b.x === brick.x && b.y === brick.y)).toBeUndefined()
  })

  test('shooting the bonus ship scores a bonus', async () => {
    let g = newGame()
    g = { ...g, shields: [], tick: 1, ufo: { x: 10, y: 0, dir: 1 }, shots: [{ x: 12, y: 1 }] }
    const before = g.score
    g = step(g)
    expect(g.ufo).toBeNull()
    expect(g.score - before).toBeGreaterThanOrEqual(50)
  })

  test('every 1500 points earns an extra life', async () => {
    let g = newGame()
    const target = g.invaders.filter(i => i.row === 3)[0]!
    g = { ...g, score: 1495, invaders: [target], shields: [], shots: [{ x: target.x + 1, y: target.y + 1 }] }
    g = step(g)
    expect(g.lives).toBe(4)
  })

  test('a short pane gets a shorter board that still plays', async () => {
    expect(fitHeight(0, 2)).toBe(MAX_H)
    expect(fitHeight(40, 2)).toBe(MAX_H)
    expect(fitHeight(15, 2)).toBe(13)
    expect(fitHeight(8, 2)).toBe(MIN_H)
    const g = resize(newGame(), 13)
    expect(g.h).toBe(13)
    expect(Math.max(...g.invaders.map(i => i.y))).toBeLessThan(Math.min(...g.shields.map(b => b.y)))
    expect(run(g, 50).over).toBe(false)
  })
})

describe('pane', () => {
  test('starts paused, plays on space, pauses on p', async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.resize({ columns: 50, rows: 24 })
    expect(await ui.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeDefined()

    await ui.key({ key: ' ' })
    await ui.advance(500)
    expect(await ui.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeUndefined()

    await ui.key({ key: 'p' })
    expect(await ui.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeDefined()
    await ui.unmount()
  })

  test('leaving the pane for the prompt pauses the game', async ($, on) => {
    mock.store(on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.resize({ columns: 50, rows: 24 })
    await ui.key({ key: ' ' })
    await ui.advance(200)
    await ui.redraw({ ...PANE_PROPS, isFocused: false })
    expect(await ui.find({ type: 'Text', text: /Back at the prompt/, in: 'game' })).toBeDefined()
    await ui.unmount()
  })

  test('progress is saved and restored on reopen', async ($, on) => {
    mock.store(on)
    const first = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await first.resize({ columns: 50, rows: 24 })
    await first.key({ key: ' ' })
    await first.advance(2000)
    await first.key({ key: 'p' })
    await first.unmount()

    const second = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await second.resize({ columns: 50, rows: 24 })
    expect(await second.find({ type: 'Text', text: /Welcome back/, in: 'game' })).toBeDefined()
    await second.unmount()
  })
})

test('a short pane fits the board to its height', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 15 } } })
  await ui.resize({ columns: 50, rows: 15 })
  await ui.key({ key: ' ' })
  await ui.advance(300)
  expect(await ui.find({ type: 'Text', text: /needs/, in: 'game' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /q:quit/, in: 'game' })).toBeDefined()
  await ui.unmount()
})

test('a pane too short to play says how to make room', async ($, on) => {
  mock.store(on)
  const props = { ...PANE_PROPS, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 5 } }
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props, viewport: { columns: 80, rows: 24, isFullscreen: true } })
  await ui.resize({ columns: 78, rows: 5 })
  expect(await ui.find({ type: 'Text', text: /needs 12 rows; this pane shows 5/, in: 'game' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Widen the terminal to 110\+ columns \(now 80\)/, in: 'game' })).toBeDefined()
  await ui.unmount()
})

describe('command', () => {
  const RUN = { command: 'invaders', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }

  test('/invaders mode sets and reports the mode', async ($, on) => {
    mock.store(on)
    const set = await $.command.run({ ...RUN, args: 'mode auto' })
    expect(set.text).toContain('open by itself')
    const shown = await $.command.run({ ...RUN, args: 'mode' })
    expect(shown.text).toContain('auto')
    const short = await $.command.run({ ...RUN, args: 'ask' })
    expect(short.text).toContain('offer a game')
  })

  test('/invaders help lists the commands and the keys', async ($, on) => {
    mock.store(on)
    const help = await $.command.run({ ...RUN, args: 'help' })
    for (const part of ['/invaders dock', '/invaders intro', 'pause or resume', 'hide the board', 'never interrupts Claude']) {
      expect(help.text).toContain(part)
    }
    expect((await $.command.run({ ...RUN, args: 'nonsense' })).text).toContain('does not know "nonsense"')
  })
})

describe('daily offers', () => {
  const DAY = 24 * 60 * 60_000
  const NOON = Date.UTC(2026, 9, 2, 12)

  async function turn($: any, clock: { advance: (ms: number) => Promise<void> }, text: string, ms: number) {
    const { turnId } = await $.turn.start({ text, turnId: 't' })
    await clock.advance(ms)
    const band = await $.ui.mount({
      plugin: 'invaders',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
    })
    const offered = (await band.find({ type: 'Text', text: /Play Invaders/ })) !== undefined
    await band.unmount()
    await $.turn.complete({ answer: '', durationMs: ms, isAborted: false, turnId, reason: 'answer' })
    return offered
  }

  // The engine's own answers beneath the plugin.
  function engine(on: any) {
    mock.store(on)
    on('turn.start', async (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
    on('turn.complete', async () => ({ text: '' }))
    on('command.register', async () => ({ command: 'invaders' }))
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
  }

  test('one random offer a day, a second only for long work, never a third', async ($, on) => {
    engine(on)
    const clock = mock.clock(on, { now: NOON })
    expect(await turn($, clock, 'quick question', 15_000)).toBe(false)
    expect(await turn($, clock, 'do some work', 90_000)).toBe(true)
    expect(await turn($, clock, 'more work', 2 * 60_000)).toBe(false)
    expect(await turn($, clock, 'a big job', 3 * 60_000)).toBe(true)
    expect(await turn($, clock, 'x'.repeat(600), 10 * 60_000)).toBe(false)

    await clock.set(NOON + DAY)
    expect(await turn($, clock, 'x'.repeat(600), 90_000)).toBe(true)
    expect(await turn($, clock, 'x'.repeat(600), 25_000)).toBe(true)
  })

  test('off mode never offers', async ($, on) => {
    engine(on)
    const clock = mock.clock(on, { now: NOON })
    await $.command.run({ command: 'invaders', args: 'off', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as any)
    expect(await turn($, clock, 'x'.repeat(600), 10 * 60_000)).toBe(false)
  })
})

test('the board draws only in the terminal theme\'s 16 colors', async () => {
  const colors = new Set(draw({ ...newGame(), ufo: { x: 3, y: 0, dir: 1 } }).flat().map(run => run.color))
  for (const color of colors) {
    if (color !== undefined) expect(color).toMatch(/^ansi256\(([0-9]|1[0-5])\)$/)
  }
  expect(colors.has('ansi256(14)')).toBe(true)
})

test('a banner clears the board around its text', async () => {
  const g = newGame()
  const mid = Math.floor(g.h / 2)
  // An invader on every row the banner's panel covers, left to right.
  const invaders = [-2, -1, 0, 1].flatMap(dy => [0, 4, 8, 12, 16, 20, 24, 28].map(x => ({ ...g.invaders[0]!, x, y: mid + dy })))
  const line = 'Claude finished. Back to work!'
  const rows = draw({ ...g, invaders }, ['PAUSED', line]).map(runs => runs.map(run => run.text).join(''))
  expect(rows[mid - 2]!.trim()).toBe('')
  expect(rows[mid - 1]!.trim()).toBe('PAUSED')
  expect(rows[mid]!.trim()).toBe(line)
  expect(rows[mid + 1]!.trim()).toBe('')
})

describe('placement', () => {
  const RUN = { command: 'invaders', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 160 } }
  const BAND = {
    plugin: 'invaders',
    surface: 'terminal' as const,
    component: 'AbovePrompt' as const,
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 }, view: {} },
  }

  // The engine's own answers beneath the plugin.
  function engine(on: any) {
    mock.store(on)
    on('command.register', async () => ({ value: { command: 'invaders' } }))
    on('ui.open', async () => ({ value: { isPlaced: true } }))
    on('prompt.submit', async (_: unknown, e: { text: string }) => ({ text: e.text }))
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any) => {
      const { Box } = $.ui.resolve(e)
      return <Box />
    })
  }

  test('/invaders plays above the prompt by default, and q closes it', async ($, on) => {
    engine(on)
    const opened = await $.command.run({ ...RUN, args: '' })
    expect(opened.text).toContain('above the prompt')
    const band = await $.ui.mount(BAND)
    await band.resize({ columns: 100, rows: 20 })
    // The first open ever plays the start screen; a key that is not space ends it.
    await band.advance(5500)
    expect(await band.find({ type: 'Text', text: /10 POINTS/, in: 'game' })).toBeDefined()
    await band.key({ key: 'x' })
    expect(await band.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /q:quit/, in: 'game' })).toBeDefined()

    // h folds the board to a line and pauses it; h again brings it back.
    await band.key({ key: ' ' })
    await band.advance(200)
    await band.key({ key: 'h' })
    expect(await band.find({ type: 'Text', text: /Invaders hidden/, in: 'game' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /h:hide/, in: 'game' })).toBeUndefined()
    await band.key({ key: 'h' })
    expect(await band.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeDefined()

    await band.key({ key: 'q' })
    await band.advance(100)
    await band.unmount()
    const after = await $.ui.mount(BAND)
    expect(await after.find({ type: 'Text', text: /PAUSED/ })).toBeUndefined()
    await after.unmount()

    // A later open goes straight to the board; /invaders intro plays it again.
    await $.command.run({ ...RUN, args: '' })
    const again = await $.ui.mount(BAND)
    await again.resize({ columns: 100, rows: 20 })
    expect(await again.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeDefined()
    await $.command.run({ ...RUN, args: 'intro' })
    await again.redraw(BAND.props)
    await again.advance(5500)
    expect(await again.find({ type: 'Text', text: /10 POINTS/, in: 'game' })).toBeDefined()
    await again.unmount()
  })

  test('a click on the board starts the game, from the start screen or a pause', async ($, on) => {
    engine(on)
    await $.command.run({ ...RUN, args: '' })
    const band = await $.ui.mount(BAND)
    await band.resize({ columns: 100, rows: 20 })
    await band.advance(5500)
    expect(await band.find({ type: 'Text', text: /CLICK TO PLAY/, in: 'game' })).toBeDefined()
    await band.pointer({ type: 'down', x: 10, y: 5, button: 'left' })
    await band.advance(200)
    expect(await band.find({ type: 'Text', text: /POINTS|PAUSED/, in: 'game' })).toBeUndefined()

    // Paused with the keys, the banner names the keys; once a prompt is sent, the click.
    await band.key({ key: 'p' })
    expect(await band.find({ type: 'Text', text: /space \/ p to play/, in: 'game' })).toBeDefined()
    await band.key({ key: 'p' })
    await $.prompt.submit({ text: 'hello' } as any)
    await band.redraw(BAND.props)
    expect(await band.find({ type: 'Text', text: /click to play/, in: 'game' })).toBeDefined()
    await band.pointer({ type: 'down', x: 10, y: 5, button: 'left' })
    await band.advance(200)
    expect(await band.find({ type: 'Text', text: /PAUSED/, in: 'game' })).toBeUndefined()
    await band.unmount()
  })

  test('/invaders dock opens a pane instead, and leaves the band empty', async ($, on) => {
    engine(on)
    expect((await $.command.run({ ...RUN, args: 'dock' })).text).toContain('pane beside the chat')
    expect((await $.command.run({ ...RUN, args: '' })).text).toContain('Esc closes it')
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /PAUSED/ })).toBeUndefined()
    await band.unmount()
    expect((await $.command.run({ ...RUN, args: 'band' })).text).toContain('above the prompt')
  })

  test('a band too short to play points at the dock', async ($, on) => {
    engine(on)
    await $.command.run({ ...RUN, args: '' })
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 6, scroll: { offset: 0, bodyRows: 6 } } })
    await band.resize({ columns: 100, rows: 6 })
    expect(await band.find({ type: 'Text', text: /the band above the prompt shows 6/, in: 'game' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /\/invaders dock/, in: 'game' })).toBeDefined()
    await band.unmount()
  })
})

test('the start screen fits every board height and ends on the whole logo and table', async () => {
  for (const h of [MIN_H, 15, MAX_H]) {
    expect(drawIntro(0, h).map(runs => runs.map(run => run.text).join('')).join('').trim()).toBe('')
    const rows = drawIntro(200, h).map(runs => runs.map(run => run.text).join(''))
    expect(rows.length).toBe(h)
    expect(rows.every(row => row.length === W)).toBe(true)
    expect(rows.filter(row => row.includes('█')).length).toBe(5)
    expect(rows.some(row => row.includes('<=O=> = ? MYSTERY'))).toBe(true)
    expect(rows.some(row => row.includes('= 10 POINTS'))).toBe(true)
  }
})
