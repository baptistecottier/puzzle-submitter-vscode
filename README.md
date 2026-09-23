# Puzzle Submitter

Submit puzzle answers to Advent of Code, Everybody Codes, Codyssi, i18n-puzzles and
Coding Quest without leaving VS Code.

<!-- TODO: screenshot of the sidebar panel (media/screenshot-panel.png), see the mockup
     shared in chat for a preview of the exact layout/theme this would show. -->

## Features

- **Detects the puzzle from the file you have open** across all five sites — no typing
  year/day/quest by hand unless detection fails.
- **A sidebar panel** (Activity Bar icon) with the whole flow on one screen: puzzle
  context, input status and preview, an answer field, Submit, and what you've already
  solved in this workspace — instead of a sequence of command-palette prompts.
- **Real submission** for Advent of Code and Everybody Codes (session-cookie auth,
  the same unofficial APIs long-standing community tools use). The other three sites
  have no known submission API, so answers are copied to the clipboard and the puzzle
  page opens instead.
- **Fetches and caches input locally** for the two sites with an API (decrypting
  Everybody Codes' input automatically); a manual "Set Input" from the clipboard covers
  the rest, or overrides any of them.
- **Runs your solution directly** — `preprocessing()`/`solver()` from the open `.py`
  file, no wrapper script needed, matching the calling convention each site's own
  reference tooling (`aocp.py`, `ec.py`, ...) actually uses.
- **Checks against a recorded answer before submitting**, everywhere you can submit
  (command, panel, tree): if what you're about to submit already matches an
  answer this extension has confirmed correct, it's not sent again — the site would just
  say "already solved" without telling you anything new. If it *contradicts* a confirmed
  answer, you're asked to confirm before spending a submission attempt on what's very
  likely a wrong answer.

## Install

From the Marketplace: search **Puzzle Submitter** in VS Code's Extensions view, or install
directly from [marketplace.visualstudio.com/items?itemName=baptistecottier.puzzle-submitter](https://marketplace.visualstudio.com/items?itemName=baptistecottier.puzzle-submitter).

## Quick start

1. Open the folder for one of your puzzle sites (one site per workspace).
2. Open a solution file and click the **Puzzle Submitter** icon in the Activity Bar
   (left edge) — or run **Puzzle Submitter: Submit Answer** from the command palette.
3. First time in a workspace, you'll be asked which site it maps to (saved to that
   workspace's `.vscode/settings.json`). For aoc/everybodycodes, you'll also be asked
   for a session token (see [Where session tokens come from](#where-session-tokens-come-from)) —
   stored in VS Code's encrypted `SecretStorage`, never written to a file.
4. Fetch or set the input, provide an answer, hit Submit.

## Sidebar panel

Click the Puzzle Submitter icon in the Activity Bar for a form instead of the command
palette:

- Detected site, puzzle and part (with a dropdown to override the part).
- Input status, with Fetch/Set buttons, and a preview of the *active puzzle's* cached
  input only — never the rest of the site's file (see [Local input format](#local-input-format)) —
  capped at 2000 characters with an "Open full input in a tab" link for anything longer.
- An answer field, with "Run solver()"/"Run configured command" buttons to fill it.
- Submit, with the result shown inline.
- What's already been solved in this workspace.

The status bar item (bottom left) opens this panel when clicked. The panel only covers
the common path — if a file can't be auto-detected, it falls back to the same "pick
manually" prompt the commands below use.

## Puzzle tree

The same Activity Bar container also has a **Puzzles** tree: every event/story/GridOS
group found in the workspace, expanding to quests, expanding to parts — built by
scanning the workspace for `.py` files the current site's provider recognizes (there's
no "list all my puzzles" API to build this from instead).

- **Sync with Site** (toolbar button at the top of the tree) — the one-click version of
  everything below, across *every* event in the workspace at once, not just one: fetches
  any missing input, fetches any missing reference answers, then benchmarks — skipping
  whatever's already cached, so re-running it later is cheap. This is what you want
  instead of clicking "Fetch Reference Answers" and "Run All Quests" separately for every
  year you've ever touched. Needs your session token if the site has any fetch API; sites
  with neither (codyssi, i18n-puzzles, coding quest) just get benchmarked, across
  everything, with no token prompt at all. Cancellable from the progress notification.
- **Run All Parts** (on a quest) / **Run All Quests** (on an event) — a **local,
  offline benchmark**: runs `solver()` for each part and compares it against the answer
  this workspace already has recorded as correct, with no network call. It's a
  regression check against puzzles you've already solved, not a way to submit — neither
  action ever contacts a puzzle site. ✅/❌ show a match/mismatch against the recorded
  answer; ➖ means it ran fine but nothing was recorded yet to compare against; ⚪ means
  no local input to run it against yet.
- **Submit** (on a part) — the one deliberate way to actually submit from the tree,
  always a single part: prefills the answer from the benchmark above (running the
  solver fresh if it hasn't been run yet), lets you confirm or edit it, then submits
  exactly like **Submit Answer** below.
- **Fetch Reference Answers from Site** (right-click an event) — the benchmark can only
  compare against an answer this extension has actually recorded, and re-submitting an
  already-solved puzzle just gets "already solved" back, never the answer text. This
  reads the confirmed answer straight off the site's own puzzle page instead (Advent of
  Code shows "Your puzzle answer was ..." for parts you've already solved, even ones
  solved outside this extension entirely) — useful for backfilling reference answers for
  puzzles you solved before you had this extension, or before the benchmark existed.
  AoC only for now; needs your session token, and does one page request per quest with a
  short pause between them. You don't need to run this manually going forward, either:
  any submit that comes back "already solved" now does this same lookup automatically,
  so the reference answer fills in on its own the next time you happen to resubmit
  something already solved.
- **GridOS** quests (`gridos/gridos_NN/quest_N/...`) show up for browsing only, with no
  Run/Submit actions — see [Known limitations](#known-limitations).

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

## Settings

| Setting | Scope | Purpose |
|---|---|---|
| `puzzleSubmitter.site` | workspace | Which puzzle site this workspace submits to: one of `aoc`, `everybodycodes`, `codyssi`, `i18n-puzzles`, `codingquest`. Left unset, you'll be asked (and it's saved for you) the first time you run a command or open the panel. |
| `puzzleSubmitter.runCommand` | workspace | Optional shell command that prints an answer to stdout, offered as an alternative to typing it. Placeholders: `${year}`, `${day}`, `${part}`, `${file}`. The **last non-empty line of stdout** is used, then shown to you to confirm/edit before it's submitted. Generic — not wired up to this project's own `aocp`/`ec.py`/etc. scripts, since those print decorated multi-line/scoreboard output rather than a bare answer; point it at a script that prints just the answer, e.g. `python3 ${file}`. |
| `puzzleSubmitter.contact` | global | Your email or GitHub URL, sent in the `User-Agent` of Advent of Code requests. AoC's documented automation etiquette asks scripts to identify themselves this way, so the site owner can reach you if something misbehaves. |
| `puzzleSubmitter.pythonPath` | workspace | Interpreter used by "Run solver() from this file". Left unset, this workspace's `.venv/bin/python` is used if present, else `python3` on PATH. |
| `puzzleSubmitter.solverTimeoutSeconds` | workspace | How long a single `preprocessing()`/`solver()` run is allowed before it's killed. Default `60`. Matters most for bulk runs (Run All Quests, Sync with Site), where one hung or infinite-looping solution shouldn't be able to stall the whole run. |

## Where session tokens come from

- **Advent of Code**: log in, DevTools → Application/Storage → Cookies →
  `adventofcode.com` → copy the `session` cookie's value.
- **Everybody Codes**: same idea, copy the `everybody-codes` cookie's value.
- **Codyssi / i18n-puzzles / Coding Quest**: no token needed — these have no known
  submission API, so there's nothing to authenticate.

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
  Everybody Codes endpoint was found), point Claude at it and the matching provider can
  be upgraded to real submission.
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
- **Everybody Codes GridOS** (`gridos/gridos_NN/quest_N/...`) has no known per-quest
  `solver()` or submission endpoint — GridOS is a shared rule engine (`gridOS.py`) driven
  by `.rules`/test-case files, not per-puzzle solution code. It's detected for browsing
  in the [Puzzle tree](#puzzle-tree) only, with no Run/Submit actions.
- **Codyssi's puzzle-page link** is the general challenges page, not a specific day —
  I couldn't confirm the per-day URL pattern.
- **Coding Quest's puzzle-page link** is the homepage — the site's problem pages
  (`codingquest.io/problem/{n}`) use a flat number unrelated to the year/day used
  locally, so it can't be derived from a file path alone.

## Development

1. `npm install`
2. Press `F5` (or Run → Start Debugging) to launch an Extension Development Host with the
   extension loaded.
3. Open one of your puzzle-site workspaces in that dev host window and use the extension
   as described above.
4. `npm test` runs the unit tests (response parsing, local input storage, the Python
   solver runner against real `python3` subprocesses); `npm run compile` type-checks and
   bundles.

### Local input format

Every site caches its local input the same way: **one JSON file per site**,
`.puzzle-submitter/<site>.json` (`.puzzle-submitter/aoc.json`,
`.puzzle-submitter/everybodycodes.json`, ...), shaped as
`{"<group>": {"<index>": {"1": "part 1 text", "2": "part 2 text", ...}}}` — every year/
event and every puzzle for that site in one file, filled in via "Fetch Input"
(aoc/everybodycodes) or "Set Input" (any site, from the clipboard). Reading or writing
one puzzle's input only ever touches that one `store[group][index]` entry — the sidebar
panel's input preview, "Run solver()", etc. all resolve to just the active puzzle,
never the whole file.

"Submit Answer" calls your solution file's `preprocessing(data)`/`solver(data)` directly
instead of running a separate command, for any site, on a `.py` file:

- Reads the cached JSON above — for aoc/everybodycodes, fetching it automatically
  first (prompting for a token if needed) when it's missing; for the other three,
  run "Set Input" first.
- Runs it through `preprocessing()` if the file defines one.
- Calls `solver(data)`, or `solver(*data)` when `preprocessing()` returned a tuple/list
  (matching `aocp.py`'s own unpacking rule) — **except Everybody Codes**, whose real
  `solver()` (see `ec.py`) expects every part at once as one dict argument
  (`{1: ..., 2: ..., 3: ...}`), not per-part text; the runner passes that shape there.
- If `solver()` returns a tuple/list/generator, each item is treated as one part's
  answer (`parts[0]` for part 1, `parts[1]` for part 2, ...); a single return value is
  used as-is.