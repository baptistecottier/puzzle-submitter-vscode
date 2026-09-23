# Puzzle Submitter

Submit puzzle answers to Advent of Code, Everybody Codes, Codyssi, i18n-puzzles and
Coding Quest without leaving VS Code.

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

## Commands

- **Puzzle Submitter: Submit Answer** — detects the puzzle from the active file (or asks),
  gets an answer (typed, or from a configured command), and submits it.
- **Puzzle Submitter: Fetch Input** — aoc/everybodycodes only. Downloads (and for
  Everybody Codes, decrypts) the puzzle input, and never re-downloads if already cached
  locally.
- **Puzzle Submitter: Set Token for Current Site** / **Clear Token for Current Site**
- **Puzzle Submitter: Set Site for Workspace**

A status bar item on the left shows the detected puzzle for the active file and runs
Submit Answer when clicked.

## Settings

| Setting | Scope | Purpose |
|---|---|---|
| `puzzleSubmitter.site` | workspace | Which site this workspace submits to. |
| `puzzleSubmitter.runCommand` | workspace | Optional shell command that prints an answer to stdout, offered as an alternative to typing it. Placeholders: `${year}`, `${day}`, `${part}`, `${file}`. The **last non-empty line of stdout** is used, then shown to you to confirm/edit before it's submitted. |
| `puzzleSubmitter.contact` | global | Your email or GitHub URL, sent in the `User-Agent` of Advent of Code requests. AoC's documented automation etiquette asks scripts to identify themselves this way, so the site owner can reach you if something misbehaves. |

`puzzleSubmitter.runCommand` is generic — it isn't wired up to this project's own
`aocp`/`ec.py`/etc. scripts, since those print decorated multi-line/scoreboard output
rather than a bare answer. Point it at a script that prints just the answer, e.g.
`python3 ${file}`.

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
