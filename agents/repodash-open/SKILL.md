---
name: repodash-open
description: Open RepoDash, the user's git dashboard app, on the detail panel of a repository — typically the one just changed, so the user can review the diff there. Use when the user asks to open, show or review a repository or its changes "in RepoDash", or asked earlier to have finished work shown in RepoDash. Do not open it unasked.
---

# Open a repository in RepoDash

RepoDash takes `--open <dir>`: any folder inside a git repository. A running RepoDash comes to the front and
shows that repository's panel (the new process exits at once); otherwise RepoDash starts and shows it. A
repository the dashboard does not list yet is added first. `--tab=changes` (default), `history`, `branches` or
`console` picks the tab: `changes` for uncommitted work, `history` when the work was committed.

## Which repository

The repository where you changed files in this task. If you changed several, open the one the user cares about
most (or ask) and name the others in your reply — the panel shows one repository at a time.

## Command

Start it detached, so the command returns even when RepoDash was not running. Clear `ELECTRON_RUN_AS_NODE`:
a shell started by VS Code or Cursor inherits it, and it turns RepoDash into a plain Node process that
silently does nothing.

**Windows** (PowerShell):

```powershell
$exe = "$env:LOCALAPPDATA\Programs\RepoDash\RepoDash.exe"
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe -ArgumentList "--open `"C:\path\to\repo`" --tab=changes"
```

From Git Bash: `env -u ELECTRON_RUN_AS_NODE cmd //c start "" "$LOCALAPPDATA\\Programs\\RepoDash\\RepoDash.exe" --open "C:\\path\\to\\repo"`.

**macOS:** `open -n -a RepoDash --args --open /path/to/repo` (`-n` starts a new process, which hands the request
to a running RepoDash; without it macOS only activates the app and drops the arguments).

**Linux** (AppImage; ask the user where it is if `~/Applications/RepoDash*.AppImage` does not exist):
`env -u ELECTRON_RUN_AS_NODE setsid -f ~/Applications/RepoDash-*.AppImage --open /path/to/repo >/dev/null 2>&1`

## If it does not work

- The executable is missing: RepoDash is not installed there; tell the user instead of searching the disk.
- Nothing shows up: check that `ELECTRON_RUN_AS_NODE` was really cleared for the started process.
- A folder outside any git repository is refused with a notification from RepoDash ("Not a git repository").

## Scratch clones

A repository opened this way, or one in the system's temp folder, leaves the dashboard by itself once its folder
is deleted, so a scratch clone you push and delete needs no cleanup in RepoDash.
