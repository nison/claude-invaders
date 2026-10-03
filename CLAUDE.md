# Invaders for Claude Code

Notes for working on this repository with Claude Code.

The Invaders mod for Claude Code (`invaders/`) and its marketplace (`.claude-plugin/`).
See README.md for install and commands.

## Working on the mod

- Load the plugin-authoring skill first; it names this session's mods folder.
  Copy `invaders/` there for hot reload, and copy edits back to `invaders/` here,
  which is the source of truth.
- Check every change: `claude plugin validate invaders`, `claude plugin test invaders`,
  and `npx -y -p typescript@5 tsc -p invaders` once the mod has loaded.
- `hooks/engine.ts` is pure game logic (tested directly); `hooks/game.tsx` is the
  game's client module; `hooks/register.tsx` holds the command, the band and pane
  placements, the offer band and the daily offer timer.

## Things learned the hard way (Claude Code 2.1.288)

- **Colors:** a plugin's Text color must match `/^[#a-zA-Z0-9_().,% -]{1,40}$/`, so
  `ansi:green` is refused, and a bare name (`green`) is read as a theme key and
  drawn uncolored. To follow the terminal's theme use `ansi256(0)`–`ansi256(15)`,
  no color, or `bold`. Apple Terminal is held to 256 colors, so hex is approximated.
- **Pane background** is the theme key `composerSidebarBackground`; a plugin can't
  change it. So the game defaults to the AbovePrompt band, which is drawn on the
  terminal's own background (`/invaders dock` uses the pane). The band has no
  `isFocused` prop and can't be opened focused: it pauses on `prompt.submit`, and
  `q` closes it because Escape only returns the keys. Custom themes live in
  `~/.claude/themes/<slug>.json` (`{ name, base, overrides }`) and are selected as
  `custom:<slug>`.
- **Pane height:** a Client's `surface.rows` is its own content's height. The
  visible height is `e.props.scroll.bodyRows` from the Pane `ui.render`, passed in
  as a prop. Panes dock full-height only at 110+ columns in the fullscreen layout.
- **Directory validation (claude.ai/directory/manage):** the checker blocks a file
  that fetches `Client` on a line of its own (`const { Box, Client } = $.ui.resolve(e)`),
  reporting "Client element whose path is not a fixed string" at that line. Take the
  table whole (`const ui = $.ui.resolve(e)`) and draw `<ui.Client module="./game.tsx">`.
  Local imports name their file (`./engine.ts`), every file stays under 5 MiB, and the
  plugin folder needs its own README, license and `.claude-plugin/icon.png`.
- **Tests:** a hook that calls an `$` op with nothing beneath it fails silently, so
  tests stub `command.register`, `turn.start`, `turn.complete` and the AbovePrompt
  `ui.render` with `on(...)`. `$.ui.panes` can't be stubbed, so `isOpen` catches.
  The test's own `$` has no `store` or `state`.
