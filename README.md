# Puzzle Submitter

Submit puzzle answers to Advent of Code, Everybody Codes, Codyssi, i18n-puzzles and
Coding Quest without leaving VS Code.

## Install

From the Marketplace: search **Puzzle Submitter** in VS Code's Extensions view, or install
directly from [marketplace.visualstudio.com/items?itemName=baptistecottier.puzzle-submitter](https://marketplace.visualstudio.com/items?itemName=baptistecottier.puzzle-submitter).

To hack on the source instead, see Setup below.

## Setup

1. `npm install`
2. Press `F5` (or Run → Start Debugging) to launch an Extension Development Host with the
   extension loaded.
3. Open one of your puzzle-site workspaces (`advents-of-code`, `everybodycodes`, ...) in
   that dev host window, open a day/quest solution file, and run **Puzzle Submitter: Submit
   Answer** from the command palette.
4. First run in a workspace: you'll be asked which site it maps to (saved to that
   workspace's `.vscode/settings.json` as `puzzleSubmitter.site`). Then, for aoc/everybodycodes,
   you'll be asked for a session token (see below) — stored in VS Code's encrypted
   `SecretStorage`, never in a file.

## Sidebar panel

Click the Puzzle Submitter icon in the Activity Bar (left edge) for a form instead of
the command palette: detected site/puzzle/part, input status with Fetch/Set buttons and
a preview of the *active puzzle's* cached input (never the rest of the site's file — see
below), capped at 2000 characters with an "Open full input in a tab" link for anything
longer, an answer field with "Run solver()"/"Run configured command" buttons to fill it,
Submit, and a list of what's already been solved in this workspace. The status bar item
now opens this panel instead of jumping straight into Submit Answer. It only covers the
common path — if a file can't be auto-detected, it falls back to the same "pick
manually" prompt as the commands below.

## Commands

- **Puzzle Submitter: Submit Answer** — detects the puzzle from the active file (or asks).
  When it's auto-detected, you get a quick chance to confirm or change the guessed part
  (the extension only knows what it's seen you submit itself, so it can guess wrong).
  Then it gets an answer — typed, from a configured command, or (on a `.py` file, any
  site) by running the file's own `preprocessing()`/`solver()` directly — and submits it.
- **Puzzle Submitter: Fetch Input** — aoc/everybodycodes only. Downloads (and for
  Everybody Codes, decrypts) every currently-unlocked part of the puzzle input in one go,
  and never re-downloads a part already cached locally.
- **Puzzle Submitter: Set Input (from Clipboard)** — any site. Saves whatever's on the
  clipboard as this puzzle's local input, merged into the same cache "Fetch Input" uses.
  The only way to get local input for codyssi/i18n-puzzles/coding quest (no fetch API),
  and a manual override/correction for any site.
- **Puzzle Submitter: Set Token for Current Site** / **Clear Token for Current Site**
- **Puzzle Submitter: Set Site for Workspace**

A status bar item on the left shows the detected puzzle for the active file and opens
the sidebar panel when clicked.

## Settings

| Setting | Scope | Purpose |
|---|---|---|
| `puzzleSubmitter.site` | workspace | Which site this workspace submits to. |
| `puzzleSubmitter.runCommand` | workspace | Optional shell command that prints an answer to stdout, offered as an alternative to typing it. Placeholders: `${year}`, `${day}`, `${part}`, `${file}`. The **last non-empty line of stdout** is used, then shown to you to confirm/edit before it's submitted. |
| `puzzleSubmitter.contact` | global | Your email or GitHub URL, sent in the `User-Agent` of Advent of Code requests. AoC's documented automation etiquette asks scripts to identify themselves this way, so the site owner can reach you if something misbehaves. |
| `puzzleSubmitter.pythonPath` | workspace | Interpreter used by "Run solver() from this file". Left unset, this workspace's `.venv/bin/python` is used if present, else `python3` on PATH. |

`puzzleSubmitter.runCommand` is generic — it isn't wired up to this project's own
`aocp`/`ec.py`/etc. scripts, since those print decorated multi-line/scoreboard output
rather than a bare answer. Point it at a script that prints just the answer, e.g.
`python3 ${file}`.

### Local input format & running solver() directly

Every site caches its local input the same way: **one JSON file per site**,
`.puzzle-submitter/<site>.json` (`.puzzle-submitter/aoc.json`,
`.puzzle-submitter/everybodycodes.json`, ...), shaped as
`{"<group>": {"<index>": {"1": "part 1 text", "2": "part 2 text", ...}}}` — every year/
event and every puzzle for that site in one file, filled in via "Fetch Input"
(aoc/everybodycodes) or "Set Input" (any site, from the clipboard). Reading or writing
one puzzle's input only ever touches that one `store[group][index]` entry — the sidebar
panel's input preview, "Run solver()", etc. all resolve to just the active puzzle,
never the whole file.

"Submit Answer" can call your solution file's `preprocessing(data)`/`solver(data)`
directly instead of running a separate command, for **any site**, on a `.py` file:

- Reads the cached JSON above — for aoc/everybodycodes, fetching it automatically
  first (prompting for a token if needed) when it's missing; for the other three,
  run "Set Input" first.
- Runs it through `preprocessing()` if the file defines one.
- Calls `solver(data)`, or `solver(*data)` when `preprocessing()` returned a tuple/list
  (matching `aocp.py`'s own unpacking rule) — **except Everybody Codes**, whose real
  `solver()` (see `ec.py`) expects every part at once as one dict argument
  (`{1: ..., 2: ..., 3: ...}`), not per-part text; the runner passes that shape there.
- If `solver()` returns a tuple/list, each element is treated as one part's answer
  (`parts[0]` for part 1, `parts[1]` for part 2, ...); a single return value is used as-is.

#### aocp.py reads/writes the same consolidated file

`pythonfw/aocp.py` (in `advents-of-code`, not this repo) was updated alongside this so
both tools share `.puzzle-submitter/aoc.json` — `save_input_to_file` writes
`store[str(year)][str(day)]`, and `_read_local_input` reads it, keyed by plain
`str(int)` (e.g. `"5"`, not `"05"`) on both sides so they actually interoperate, not
just look similar. Falls back to the legacy per-day `day_DD.input` file (either the
JSON or the original plain-text shape) when a puzzle isn't in the consolidated store
yet, so nothing already downloaded over the life of this project is lost.

## Where session tokens come from

- **Advent of Code**: log in, DevTools → Application/Storage → Cookies →
  `adventofcode.com` → copy the `session` cookie's value.
- **Everybody Codes**: same idea, copy the `everybody-codes` cookie's value.
- **Codyssi / i18n-puzzles / Coding Quest**: no token needed — see below.

## Known limitations

- **Advent of Code's response text is matched by well-known, commonly-cited phrases**
  ("That's the right answer", "too recently", "already complete it", ...), the same ones
  long-standing community tools rely on — but I couldn't fetch a real response myself to
  verify current exact wording (no valid session), so treat `src/providers/aoc.ts`'s
  `parseAocResponse` as best-effort. An unrecognized response still surfaces its raw text
  in the "Puzzle Submitter" output channel instead of silently misreporting a status.
- **Codyssi, i18n-puzzles, Coding Quest have no known submission API.** I looked (web
  search + inspecting the public pages) and found none, and this project's own scripts for
  these three never call the network either — they only validate locally. Submit Answer
  still detects the puzzle and copies your answer to the clipboard + opens the puzzle
  page, but doesn't submit it for you. If you ever capture the real request these sites
  make when you submit manually (browser DevTools → Network tab, the same way the
  Everybody Codes endpoint below was found), point Claude at it and the matching
  provider can be upgraded to real submission.
- **Everybody Codes' submit response shape was partly unconfirmed — now partly fixed
  from real use.** The endpoint (`POST /event/{event}/quest/{quest}/part/{part}/answer`)
  is real — ported from this project's `everybodycodes/scripts/get_cases.py`. Confirmed
  so far: **HTTP 409 = already solved**. Still a best guess: the shape of a *correct* vs.
  *incorrect* 2xx response (currently read from a `correct`/`success`/`isCorrect` JSON
  field). If a correct/incorrect result gets misreported, check the "Puzzle Submitter"
  output channel for the raw response and adjust `parseSubmitBody` in
  `src/providers/everybodycodes.ts` (and its test in `test/everybodycodes.test.ts`).
- **Everybody Codes story quests** (`stories/story_NN/...`) are detected, but the numeric
  story id is assumed to double as the API's `event` id — unverified, since this
  project's existing tooling only exercises yearly events. Yearly events
  (`events/year_YYYY/...`) are solid (see above).
- **Codyssi's puzzle-page link** is the general challenges page, not a specific day —
  I couldn't confirm the per-day URL pattern.
- **Coding Quest's puzzle-page link** is the homepage — the site's problem pages
  (`codingquest.io/problem/{n}`) use a flat number unrelated to the year/day used
  locally, so it can't be derived from a file path alone.
