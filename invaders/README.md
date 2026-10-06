# Invaders

A tiny Space Invaders you play in Claude Code while Claude works. The game sits in
the band above the prompt, draws in your terminal's own colors, pauses when Claude
finishes, and saves your wave and score. Playing never interrupts Claude.

Needs Claude Code 2.1.287 or later, in the terminal or the Desktop app's Code tab.

## Install

Install Invaders from the Claude plugin directory, or straight from its repository by
running these two commands in Claude Code:

```
/plugin marketplace add nison/claude-invaders
/plugin install invaders@cli-mods
```

Then run `/reload-plugins`, or quit Claude Code and start it again, so the mod loads.

## Play

Type `/invaders` and click the board to play. `/invaders help` lists every command
and key. To update later, run `claude plugin update invaders@cli-mods` in your shell.

## Keys

Arrow keys or a/d move, space fires, p pauses, h hides the board down to one line,
q closes the game, and Esc hands the keyboard back to the prompt.

## What this mod does, and what it does not

**It sends nothing anywhere.** The mod makes no network requests, calls no model,
reads and writes no files, and starts no processes. It never submits a prompt and
never runs a slash command by itself.

**What it adds.** One command, `/invaders`, which you run. It opens, closes and
configures the game, and it works while Claude is busy.

**What it draws.** The game in the band above the prompt (or in a pane, after
`/invaders dock`), and a one-line "Play Invaders?" offer in the band while Claude
works. The offer appears at most twice a day and can be turned off with
`/invaders off`.

**What it stores.** Five values in Claude Code's own plugin store on your machine:
your saved game, the offer mode, where the game is drawn, how many offers were made
today, and whether the start screen has been shown.

**Which events it handles, and why:**

- `session.start` and `prompt.submit`: registers the `/invaders` command. On
  `prompt.submit` it also pauses an open game. The prompt is passed on unchanged and
  its text is not read.
- `turn.start`: notes that Claude is working and sets a timer for the offer. It
  reads only the length of the prompt, to tell a long task from a short one.
- `turn.complete`: pauses the game and removes the offer.
- `command.run`: answers the `/invaders` command only.
- `ui.render` and `ui.message`: draws the game and the offer, and receives the
  saved game from the board.

**About the test file.** The tests folder holds the mod's automated tests. They use
Claude Code's test kit to mount the game, run `/invaders`, and send a made-up prompt
so the pause can be checked. That code runs only under `claude plugin test`; it is
never loaded in a session.

## License

MIT. See the LICENSE file.
