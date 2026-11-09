# RepoDash

A desktop dashboard of locally cloned git repositories: status at a glance, branch switching and
everyday operations (fetch, pull, push, commit, stash). Visual style inspired by the Oblivion movie
UI (<https://gmunk.com/Oblivion-GFX>).

## Decisions

| Topic | Decision |
| --- | --- |
| Platform | Electron — Windows, macOS, Linux from one codebase; JavaScript/TypeScript only |
| UI | React + TypeScript, built by electron-vite |
| Git access | the system `git` binary via `child_process.execFile` (no libgit2, no wrapper library), so credential helpers, ssh-agent, hooks and `.gitconfig` behave exactly as in a terminal |
| Repository sources | added by the user only: either a **scan folder** (searched for repositories, depth-limited) or a **single repository** |
| Persistence | JSON file in the Electron `userData` directory |

## Architecture

```text
┌──────────── renderer (React/TS) ────────────┐
│ card grid · detail panel · op log · settings │
└───────────────▲──────────────┬───────────────┘
        events   │              │ window.repodash.* (preload, contextBridge)
┌───────────────┴──────────────▼───────────────┐
│ main process (Node)                           │
│  sources   – scan folders + single repos      │
│  status    – git status --porcelain=v2 -b     │
│  watcher   – .git/HEAD, index, refs changes   │
│  ops queue – fetch/pull/push/checkout/...     │
│              max ~6 parallel git processes    │
│  config    – JSON in userData                 │
└───────────────────────────────────────────────┘
```

- The renderer has no Node access (`contextIsolation`, no `nodeIntegration`); everything goes through
  a small preload API.
- `git status --porcelain=v2 --branch` gives branch, upstream, ahead/behind and file states in one call.
  Stash count, last commit and in-progress merge/rebase/detached HEAD come from cheap extra calls.
- git runs with `GIT_TERMINAL_PROMPT=0` (fail instead of hanging on a credential prompt),
  `GIT_OPTIONAL_LOCKS=0` (status never takes `index.lock` while the user runs git in a terminal) and
  `windowsHide` (no console flashes on Windows).
- The main process owns sources and settings (`src/main/state.ts`) and pushes a snapshot to the renderer
  on every change; the renderer only asks for git status per repository.
- A folder scan walks up to *depth* levels (default 3), descends into repositories (nested clones are
  found), skips dot-folders, `node_modules` and similar, and does not follow symlinks or junctions.
  A repository removed from a scanned folder is *hidden* and can be restored in Sources.
- Watcher (`src/main/watch.ts`): the git directory and `refs/` on every platform; the working tree
  recursively on Windows and macOS only (on Linux recursive watching costs an inotify watch per folder),
  so there working-tree edits show up when the window gets focus. Notifications are throttled per repository.
- Safe defaults: `pull --ff-only`, no force push, branch switch on a dirty repo asks (stash / carry / cancel).

## Card

```text
┌─╴API-GATEWAY ────────────────────╴◢ ┐   ← user colour accent
│ ⎇ develop            ▲2 ▼0          │
│ ● 3 modified  + 1 staged  ? 2       │
│ ─────────────────────────────────── │
│ 4f2a1c · fix retry on timeout · 2h  │
│ [FETCH] [PULL] [PUSH] [⋯]           │
└─────────────────────────────────────┘
```

Per card: colour, alias, group/tag, pin, order — persisted.

## Visual language (Oblivion)

- Palette: pale white/cyan line work on deep blue-grey; amber = behind/dirty, red = conflict/error.
  The user colour is an accent on the card edge, so the whole screen stays coherent.
- Type: thin, wide, small caps with wide letter spacing (Rajdhani); mono (Share Tech Mono) for hashes.
- Graphics: corner brackets, tick-mark rulers, segmented arcs for ahead/behind, radar sweep while
  fetching, short boot sequence on start, faint grid background.
- Restraint: glow and motion only when something changes.

## Phases

| # | Deliverable | Status |
| --- | --- | --- |
| 0 | Spike: Electron + React skeleton; add a repository by folder picker or command line, show its status on a card, refresh | done |
| 1 | Read-only dashboard: scan folders + single repos, cards, watcher refresh, drag reorder (by the card header, or keyboard: focus header, Space, arrows, Space), alias + colour, persistence, installer (electron-builder) | done |
| 2 | Operations: fetch / pull / push / checkout + create branch (local and remote) / stage + commit / stash; live op log | |
| 3 | HUD polish: animations, boot sequence, fetch radar, keyboard navigation | |
| 4 | Extras: bulk ops ("pull all clean"), diff viewer, tray icon with dirty badge, notifications | |

## Development

```text
npx uu-safe-install     # install dependencies (never plain npm install)
npm run dev             # app with hot reload
npm run build           # production build into out/
npm run typecheck       # TypeScript check
npm run dist            # installer for the current platform into dist/ (NSIS / dmg / AppImage)
```

Settings live in `repodash.json` in the Electron `userData` directory (`%APPDATA%\RepoDash` on Windows,
the same in dev and packaged builds thanks to `productName`). An unreadable file is copied to
`repodash.json.bad` before the app starts with empty settings.

In this Dropbox folder Windows sometimes briefly locks freshly written folders (virus scan / indexing):
`npm run dist` may fail with `EBUSY`/`EPERM` while renaming `dist\win-unpacked.tmp`, and Vite may print
`EBUSY` while optimizing dependencies. Both are transient — run the command again.

Command-line arguments that are directories inside a git repository are added on start, e.g.
`npm run dev -- C:\src\repo-a C:\src\repo-b`.

`node_modules/`, `out/` and `dist/` carry the `com.dropbox.ignored` stream so Dropbox does not sync them.
A process spawned by VS Code inherits `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node —
clear that variable if the app does not open.
