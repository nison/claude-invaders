// Pure game logic: every function takes a Game and returns a new one, so the
// whole board is plain JSON the hooks module can save and restore.

export const W = 33
/** Board heights the game fits itself into, tallest preferred. */
export const MAX_H = 16
export const MIN_H = 12
export const TICK_MS = 66

const POINTS = [30, 20, 20, 10]
const SPRITES = [
  ['/o\\', '\\o/'],
  ['{@}', '}@{'],
  ['{@}', '}@{'],
  ['<=>', '>=<'],
]
const PLAYER = '/A\\'
const UFO = '<=O=>'
const UFO_POINTS = [50, 100, 150, 300]
const SHIELD = ['▟███▙', '██ ██']
const EXTRA_LIFE_EVERY = 1500
const MAX_LIVES = 5
/** Shots in the air at once, rows a shot climbs per tick, and ticks between shots. */
const MAX_SHOTS = 3
const SHOT_SPEED = 2
const RELOAD_TICKS = 3
/**
 * A tap moves the ship TAP_STEP cells. A press in the same direction within
 * HOLD_TICKS is a held key: the terminal's key repeat, which starts after a
 * pause and then comes in bursts, so the ship also glides a cell a tick for
 * GLIDE_TICKS to smooth the gaps between repeats.
 */
const TAP_STEP = 2
const HOLD_TICKS = 9
const GLIDE_TICKS = 3

export type Pos = { x: number; y: number }
export type Invader = Pos & { row: number }
export type Boom = Pos & { t: number; text?: string }
export type Brick = Pos & { ch: string; hp: number }
export type Ufo = Pos & { dir: number }

export type Game = {
  v: 2
  h: number
  level: number
  score: number
  hi: number
  lives: number
  nextLife: number
  px: number
  invaders: Invader[]
  total: number
  shields: Brick[]
  ufo: Ufo | null
  dir: number
  anim: number
  shots: Pos[]
  reload: number
  vx: number
  glide: number
  lastMove: number
  bombs: Pos[]
  booms: Boom[]
  tick: number
  invuln: number
  cleared: number
  over: boolean
  seed: number
}

export type Ink = { color?: string; bold?: boolean }
export type Cell = Ink & { ch: string; dim?: boolean }
export type Run = Ink & { text: string; dim?: boolean }

/**
 * The game's colors come from the terminal's own theme, not Claude Code's:
 * plain and bold text (the theme's text and bold colors) and the 16 ANSI
 * colors, which every terminal theme defines for itself.
 *
 * Those 16 are written `ansi256(0)` to `ansi256(15)`: the terminal draws those
 * slots from its theme. A bare name (`green`) reads as a Claude Code theme key
 * and draws in no color, and the `ansi:` spelling is refused for a plugin.
 */
export const ANSI = {
  green: 'ansi256(2)',
  yellowBright: 'ansi256(11)',
  greenBright: 'ansi256(10)',
  magentaBright: 'ansi256(13)',
  cyanBright: 'ansi256(14)',
  whiteBright: 'ansi256(15)',
}

export const INK = {
  gold: { bold: true },
  plain: {},
  green: { color: ANSI.greenBright },
  shield: { color: ANSI.green },
  pink: { color: ANSI.magentaBright },
  white: { color: ANSI.whiteBright },
  ship: { color: ANSI.cyanBright },
} satisfies Record<string, Ink>

/** The board height that fits `rows` of pane, given the lines around it. */
export function fitHeight(rows: number, chrome: number): number {
  if (rows <= 0) return MAX_H
  return Math.max(MIN_H, Math.min(MAX_H, rows - chrome))
}

// Waves cycle through three layouts; short boards get three rows, not four.
function formation(level: number, h: number): Invader[] {
  const kinds = h >= 14 ? [0, 1, 2, 3] : [0, 1, 3]
  const pattern = (level - 1) % 3
  const cols = pattern === 1 ? 6 : 5
  const spacing = pattern === 1 ? 4 : 5
  const stagger = pattern === 2 ? 2 : 0
  const width = (cols - 1) * spacing + 3 + stagger
  const left = Math.floor((W - width) / 2)
  const top = 2 + Math.min(level - 1, Math.max(0, h - 4 - 2 * kinds.length))
  const out: Invader[] = []
  kinds.forEach((kind, r) => {
    for (let col = 0; col < cols; col++) {
      out.push({ x: left + col * spacing + (r % 2) * stagger, y: top + r * 2, row: kind })
    }
  })
  return out
}

function shields(h: number): Brick[] {
  const out: Brick[] = []
  for (let k = 1; k <= 4; k++) {
    const x = Math.round((W * k) / 5) - 2
    SHIELD.forEach((line, dy) => {
      for (let dx = 0; dx < line.length; dx++) {
        if (line[dx] !== ' ') out.push({ x: x + dx, y: h - 4 + dy, ch: line[dx]!, hp: 2 })
      }
    })
  }
  return out
}

function wave(g: Game): Game {
  const invaders = formation(g.level, g.h)
  return { ...g, invaders, total: invaders.length, shields: shields(g.h), ufo: null, dir: 1, shots: [], bombs: [] }
}

export function newGame(hi = 0, seed = 12345, h = MAX_H): Game {
  return wave({
    v: 2,
    h,
    level: 1,
    score: 0,
    hi,
    lives: 3,
    nextLife: EXTRA_LIFE_EVERY,
    px: Math.floor((W - 3) / 2),
    invaders: [],
    total: 0,
    shields: [],
    ufo: null,
    dir: 1,
    anim: 0,
    shots: [],
    reload: 0,
    vx: 0,
    glide: 0,
    lastMove: -99,
    bombs: [],
    booms: [],
    tick: 0,
    invuln: 0,
    cleared: 0,
    over: false,
    seed,
  })
}

export function isGame(value: unknown): value is Game {
  const g = value as Game | null
  return !!g && typeof g === 'object' && g.v === 2 && Array.isArray(g.invaders)
}

/** A saved game, brought up to date: saves from before rapid fire had one `shot`. */
export function restore(value: unknown): Game | null {
  if (!isGame(value)) return null
  type Saved = Omit<Game, 'shots' | 'reload' | 'vx' | 'glide' | 'lastMove'> &
    Partial<Pick<Game, 'shots' | 'reload' | 'vx' | 'glide' | 'lastMove'>> & { shot?: Pos | null }
  const old = value as Saved
  const { shot, ...rest } = old
  const shots = Array.isArray(old.shots) ? old.shots : shot ? [shot] : []
  return { reload: 0, vx: 0, glide: 0, lastMove: -99, ...rest, shots }
}

/** The high score in any earlier save, so a format change keeps it. */
export function savedHi(value: unknown): number {
  const hi = (value as { hi?: unknown } | null)?.hi
  return typeof hi === 'number' ? hi : 0
}

/** Fits the board to a new height before play or between waves; mid-wave it waits. */
export function resize(g: Game, h: number): Game {
  if (h === g.h || g.over) return g
  if (g.tick === 0) return newGame(g.hi, g.seed, h)
  if (g.cleared > 0) return { ...g, h }
  return g
}

function rand(g: Game): number {
  g.seed = (g.seed * 1103515245 + 12345) % 2147483648
  return g.seed / 2147483648
}

function clampX(x: number) {
  return Math.max(0, Math.min(W - 3, x))
}

/** One press of left (-1) or right (1). */
export function move(g: Game, dir: number): Game {
  if (g.over) return g
  const held = g.vx === dir && g.tick - g.lastMove <= HOLD_TICKS
  return {
    ...g,
    px: clampX(g.px + dir * (held ? 1 : TAP_STEP)),
    vx: dir,
    lastMove: g.tick,
    glide: held ? GLIDE_TICKS : 0,
  }
}

export function fire(g: Game): Game {
  if (g.over || g.cleared > 0 || g.reload > 0 || g.shots.length >= MAX_SHOTS) return g
  return { ...g, shots: [...g.shots, { x: g.px + 1, y: g.h - 2 }], reload: RELOAD_TICKS }
}

function stepEvery(g: Game): number {
  const base = Math.max(4, 13 - g.level)
  const share = g.invaders.length / Math.max(1, g.total)
  return Math.max(1, Math.round(base * (0.25 + 0.75 * share)))
}

function brickAt(bricks: Brick[], p: Pos): number {
  return bricks.findIndex(b => b.x === p.x && b.y === p.y)
}

/** Chips the brick at `i`, dropping it once it is spent. */
function chip(bricks: Brick[], i: number): Brick[] {
  return bricks.flatMap((b, n) => (n !== i ? [b] : b.hp > 1 ? [{ ...b, hp: b.hp - 1 }] : []))
}

function addScore(g: Game, points: number) {
  g.score += points
  if (g.score >= g.nextLife) {
    g.nextLife += EXTRA_LIFE_EVERY
    if (g.lives < MAX_LIVES) {
      g.lives += 1
      g.booms = [...g.booms, { x: g.px, y: g.h - 2, t: 20, text: '1UP' }]
    }
  }
}

// A shot stops at whatever it reaches: an invader, the bonus ship, or a shield.
// Returns whether it hit something.
function resolveShot(g: Game, shot: Pos): boolean {
  const hit = g.invaders.findIndex(i => i.y === shot.y && shot.x >= i.x && shot.x <= i.x + 2)
  if (hit >= 0) {
    const dead = g.invaders[hit]!
    g.invaders = g.invaders.filter((_, i) => i !== hit)
    addScore(g, (POINTS[dead.row] ?? 10) * g.level)
    g.booms = [...g.booms, { x: dead.x, y: dead.y, t: 4 }]
    return true
  }
  const ufo = g.ufo
  if (ufo && shot.y === ufo.y && shot.x >= ufo.x && shot.x < ufo.x + UFO.length) {
    const points = UFO_POINTS[Math.floor(rand(g) * UFO_POINTS.length)]! * g.level
    addScore(g, points)
    g.booms = [...g.booms, { x: ufo.x, y: ufo.y, t: 20, text: String(points) }]
    g.ufo = null
    return true
  }
  const brick = brickAt(g.shields, shot)
  if (brick >= 0) {
    g.shields = chip(g.shields, brick)
    return true
  }
  return false
}

/** Checks every shot where it stands, after something else moved into it. */
function resolveShots(g: Game) {
  g.shots = g.shots.filter(shot => !resolveShot(g, shot))
}

export function step(prev: Game): Game {
  if (prev.over) return prev
  const g: Game = { ...prev, tick: prev.tick + 1 }
  g.booms = g.booms.map(b => ({ ...b, t: b.t - 1 })).filter(b => b.t > 0)
  if (g.invuln > 0) g.invuln -= 1
  if (g.glide > 0) {
    g.glide -= 1
    g.px = clampX(g.px + g.vx)
  }

  if (g.cleared > 0) {
    g.cleared -= 1
    return g.cleared === 0 ? wave(g) : g
  }

  // Shots climb SHOT_SPEED rows a tick, a row at a time, so none skips a target.
  if (g.reload > 0) g.reload -= 1
  const flying: Pos[] = []
  for (const shot of g.shots) {
    let at: Pos | null = shot
    for (let n = 0; n < SHOT_SPEED && at; n++) {
      const next: Pos = { x: at.x, y: at.y - 1 }
      at = next.y < 0 || resolveShot(g, next) ? null : next
    }
    if (at) flying.push(at)
  }
  g.shots = flying

  // The bonus ship crosses the top row now and then, one cell every other tick.
  if (g.ufo) {
    if (g.tick % 2 === 0) {
      const x = g.ufo.x + g.ufo.dir
      g.ufo = x < -UFO.length || x > W ? null : { ...g.ufo, x }
      resolveShots(g)
    }
  } else if (g.invaders.length >= 6 && rand(g) < 0.004) {
    const dir = rand(g) < 0.5 ? 1 : -1
    g.ufo = { x: dir > 0 ? 1 - UFO.length : W - 1, y: 0, dir }
  }

  // The formation steps sideways, dropping a row at each edge.
  if (g.invaders.length > 0 && g.tick % stepEvery(g) === 0) {
    const atEdge = g.invaders.some(i => i.x + g.dir < 0 || i.x + 2 + g.dir >= W)
    g.invaders = atEdge
      ? g.invaders.map(i => ({ ...i, y: i.y + 1 }))
      : g.invaders.map(i => ({ ...i, x: i.x + g.dir }))
    if (atEdge) g.dir = -g.dir
    g.anim = 1 - g.anim
    // Invaders plough through any shield they reach.
    g.shields = g.shields.filter(b => !g.invaders.some(i => i.y === b.y && b.x >= i.x && b.x <= i.x + 2))
    resolveShots(g)
  }

  // Bombs fall every other tick, chipping any shield they land on.
  if (g.tick % 2 === 0) {
    const falling: Pos[] = []
    for (const b of g.bombs) {
      const next = { x: b.x, y: b.y + 1 }
      const brick = brickAt(g.shields, next)
      if (brick >= 0) g.shields = chip(g.shields, brick)
      else if (next.y < g.h) falling.push(next)
    }
    g.bombs = falling
  }
  // The bottom invader of a random column drops a new one.
  const chance = Math.min(0.12, 0.03 + 0.01 * g.level)
  const maxBombs = Math.min(4, 1 + Math.floor(g.level / 2))
  if (g.invaders.length > 0 && rand(g) < chance && g.bombs.length < maxBombs) {
    const shooter = g.invaders[Math.floor(rand(g) * g.invaders.length)]!
    const lowest = g.invaders
      .filter(i => i.x === shooter.x)
      .reduce((a, b) => (b.y > a.y ? b : a))
    g.bombs = [...g.bombs, { x: lowest.x + 1, y: lowest.y + 1 }]
  }

  // A bomb on the player's row costs a life.
  const struck = g.bombs.some(b => b.y === g.h - 1 && b.x >= g.px && b.x <= g.px + 2)
  if (struck && g.invuln === 0) {
    g.lives -= 1
    g.bombs = []
    g.invuln = 30
    g.booms = [...g.booms, { x: g.px, y: g.h - 1, t: 6 }]
    if (g.lives <= 0) g.over = true
  }

  if (g.invaders.some(i => i.y >= g.h - 1)) {
    g.over = true
    g.lives = 0
  }

  if (!g.over && g.invaders.length === 0) {
    g.level += 1
    g.cleared = 30
    g.shots = []
    g.bombs = []
    g.ufo = null
  }

  g.hi = Math.max(g.hi, g.score)
  return g
}

/** The board as rows of colored runs, in the terminal's colors (INK). */
export function draw(g: Game, banner?: string[]): Run[][] {
  const grid: Cell[][] = Array.from({ length: g.h }, () =>
    Array.from({ length: W }, (): Cell => ({ ch: ' ' })),
  )
  const put = (x: number, y: number, text: string, ink: Ink, dim?: boolean) => {
    for (let k = 0; k < text.length; k++) {
      const row = grid[y]
      if (row && x + k >= 0 && x + k < W) row[x + k] = { ch: text[k]!, ...ink, dim }
    }
  }

  for (const b of g.shields) put(b.x, b.y, b.hp > 1 ? b.ch : '░', INK.shield, b.hp < 2)
  for (const i of g.invaders) {
    const ink = i.row === 0 ? INK.gold : i.row === 3 ? INK.green : INK.plain
    put(i.x, i.y, SPRITES[i.row]![g.anim]!, ink)
  }
  if (g.ufo) put(g.ufo.x, g.ufo.y, UFO, INK.pink)
  for (const b of g.booms) put(b.x, b.y, b.text ?? '*+*', INK.gold)
  for (const b of g.bombs) put(b.x, b.y, '!', INK.white)
  for (const shot of g.shots) put(shot.x, shot.y, '|', INK.ship)
  const blink = g.invuln > 0 && g.tick % 4 < 2
  if (!g.over) put(g.px, g.h - 1, PLAYER, INK.ship, blink)

  if (banner && banner.length > 0) {
    // The banner sits on cleared rows, one more above and below its text, so
    // nothing on the board shows through, crowds it, or is cut in half beside it.
    const top = Math.floor((g.h - banner.length) / 2)
    for (let y = top - 1; y <= top + banner.length; y++) put(0, y, ' '.repeat(W), INK.plain)
    banner.forEach((line, n) => put(Math.floor((W - line.length) / 2), top + n, line, INK.plain))
  }

  return toRuns(grid)
}

function toRuns(grid: Cell[][]): Run[][] {
  return grid.map(row => {
    const runs: Run[] = []
    for (const cell of row) {
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.bold === cell.bold && last.dim === cell.dim) last.text += cell.ch
      else runs.push({ text: cell.ch, color: cell.color, bold: cell.bold, dim: cell.dim })
    }
    return runs
  })
}

// The title in 3x5 block letters, 31 cells across.
const LOGO = [
  '███ ██  █ █  █  ██  ███ ██   ██',
  ' █  █ █ █ █ █ █ █ █ █   █ █ █  ',
  ' █  █ █ █ █ ███ █ █ ██  ██   █ ',
  ' █  █ █ █ █ █ █ █ █ █   █ █   █',
  '███ █ █  █  █ █ ██  ███ █ █ ██ ',
]
/** Ticks between the logo's steps down, and the ticks at which each later part starts. */
const INTRO_STEP = 3
const INTRO_TABLE_AT = 24
const INTRO_LINE_TICKS = 12
const INTRO_PRESS_AT = INTRO_TABLE_AT + 4 * INTRO_LINE_TICKS + 6

/**
 * The start screen, `tick` ticks in: the logo marches down from the top as the
 * invaders do, the score table types itself out, then `prompt` blinks.
 */
export function drawIntro(tick: number, h: number, prompt = 'PRESS SPACE TO PLAY'): Run[][] {
  const grid: Cell[][] = Array.from({ length: h }, () => Array.from({ length: W }, (): Cell => ({ ch: ' ' })))
  const put = (x: number, y: number, text: string, ink: Ink, dim?: boolean) => {
    for (let k = 0; k < text.length; k++) {
      const row = grid[y]
      if (row && x + k >= 0 && x + k < W && text[k] !== ' ') row[x + k] = { ch: text[k]!, ...ink, dim }
    }
  }
  const top = h >= 14 ? 1 : 0

  // One row down per step, a cell left or right of center until it lands.
  const left = Math.max(0, LOGO.length + 1 - Math.floor(tick / INTRO_STEP))
  const sway = left === 0 ? 0 : left % 2 === 1 ? 1 : -1
  LOGO.forEach((line, n) => put(1 + sway, top + n - left, line, INK.gold))

  const anim = Math.floor(tick / 8) % 2
  const table: [string, Ink, string][] = [
    [UFO, INK.pink, '= ? MYSTERY'],
    [` ${SPRITES[0]![anim]!} `, INK.gold, '= 30 POINTS'],
    [` ${SPRITES[1]![anim]!} `, INK.plain, '= 20 POINTS'],
    [` ${SPRITES[3]![anim]!} `, INK.green, '= 10 POINTS'],
  ]
  table.forEach(([sprite, ink, text], n) => {
    // Two characters a tick, as an old machine types its score table.
    const shown = Math.max(0, (tick - INTRO_TABLE_AT - n * INTRO_LINE_TICKS) * 2)
    const y = top + LOGO.length + 1 + n
    put(8, y, sprite.slice(0, shown), ink)
    put(14, y, text.slice(0, Math.max(0, shown - 6)), INK.plain)
  })

  if (tick >= INTRO_PRESS_AT && Math.floor((tick - INTRO_PRESS_AT) / 8) % 2 === 0) {
    put(Math.floor((W - prompt.length) / 2), top + LOGO.length + 6, prompt, INK.white)
  }

  return toRuns(grid)
}
