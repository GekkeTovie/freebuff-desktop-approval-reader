# Freebuff Desktop — readable approval requests

A local, reversible presentation patch for **Freebuff Desktop 0.0.205 on Windows**. It makes
the approval card readable when the request is long: the request text gets a taller scroll
area, a larger monospace face and pinned action buttons.

Nothing here changes behaviour. You still approve or deny exactly what you did before; the
patch only changes how the request is displayed to you.

Upstream issue: [CodebuffAI/freebuff#1724 — Desktop: approval card, a long request is unreadable](https://github.com/CodebuffAI/freebuff/issues/1724).

```
before                          after
┌────────────────────────┐      ┌────────────────────────┐
│ The plan is ready …    │      │ The plan is ready …    │
│ ┌────────────────────┐ │      │ ┌────────────────────┐ │
│ │ 240px scroll box   │ │      │ │ up to 64dvh / 820  │ │
│ │ 11px UI font       │ │      │ │ 14.5px monospace   │ │
│ └────────────────────┘ │      │ └────────────────────┘ │
│ [Accept] [Decline]     │      │ [Accept] [Decline] ←   │
└────────────────────────┘      │  pinned while scrolling│
                                └────────────────────────┘
```

## Why a patch is needed at all

Freebuff Desktop's chat workspace is not shipped as a bundle on disk. The installed app is an
Electron shell plus a Bun orchestrator; the window loads a small local splash/login page and
then the workspace UI from the web app. There is therefore no renderer source file to edit.

What *is* on disk is `resources/app.asar`, whose `electron/main.cjs` is plain, readable
CommonJS. The patch inserts one small block there that calls
`webContents.insertCSS()` on every window with `approval-reader.css`.

The stylesheet targets the approval card's semantic class names, which the app renders as
`.question-dock` / `.question-dock-body` / `.question-plan` / `.plan-actions`. The shipped
CSS caps that text box at `max-height: 240px` (`50dvh` for the card body) and sets it in the
small UI type size.

## Requirements

- Windows, Freebuff Desktop **0.0.205** (`%LOCALAPPDATA%\Programs\@codebufffreebuff-desktop`).
- Node.js (any recent version) on `PATH`, or the `bun` that ships inside the app folder.

`apply.ps1` is pinned to the SHA-256 of the 0.0.205 `app.asar`. A different build is refused
so an update can never be patched with a block that no longer fits its surroundings; the
script tells you what it found.

## Apply

Quit Freebuff completely first — including the tray icon.

```powershell
cd freebuff-desktop-approval-reader
.\apply.ps1
```

Useful flags:

```powershell
.\apply.ps1 -DryRun     # build and verify the patched archive, change nothing
.\apply.ps1 -Force      # write it even if Freebuff is still running
.\apply.ps1 -AnyVersion # skip the version pin (only after checking a new build yourself)
```

Then start Freebuff again. The next approval card is rendered with the larger text and the
taller, scrollable request area; Allow/Deny stay visible underneath it.

## Revert

```powershell
.\revert.ps1
```

That restores `resources\app.asar.orig-0.0.205`, which `apply.ps1` wrote next to the original
before touching anything. Quit Freebuff first, then start it again.

## After an app update

The updater replaces `app.asar`, so the patch disappears — which is the safe default. Re-run
`apply.ps1` only after confirming the pinned SHA-256 for the new build (or inspecting the new
`electron/main.cjs` and passing `-AnyVersion`).

## What was verified

- `tools/selfcheck.mjs`: repacking an untouched `app.asar` reproduces the archive's header
  prefix and every one of its 360 files byte for byte.
- `tools/patch.mjs --dry-run`: after patching, the archive parses, entry count is unchanged,
  every other entry is byte-identical, and the patched `electron/main.cjs` passes
  `node --check`. Applied archive: 29,922,138 → 29,924,270 bytes (+2,132).
- `apply.ps1` and `revert.ps1` were run end to end against a copy of the archive: backup
  created, patch applied and reported present, re-run reported "already patched", revert
  restored the archive to a byte-identical original (same SHA-256).

Not verified from this repository: how the card looks in a running app. That needs a restart
of Freebuff and a real approval request; take a screenshot before and after.

## Files

| File | Purpose |
| --- | --- |
| `approval-reader.css` | The stylesheet that gets injected. Edit this, re-run `apply.ps1`. |
| `tools/asar.mjs` | Dependency-free reader/writer for the asar format. |
| `tools/patch.mjs` | Inserts the block into `electron/main.cjs`, repacks, verifies, optionally replaces. |
| `tools/selfcheck.mjs` | Proves the packer round-trips an archive byte for byte. |
| `apply.ps1` / `revert.ps1` | Install and undo, with backup and version pin. |
| `docs/issue-approval-card.md` | Text of upstream issue [#1724](https://github.com/CodebuffAI/freebuff/issues/1724), which this patch accompanies. |

## Limits

- Presentation only. It cannot add a "show full request" toggle (that needs the app's own
  code); it enlarges the existing expand/minimize control's contents instead.
- The class names are the app's own and may change in a future build. If the card stops
  changing after an update, the selectors need refreshing — `apply.ps1` refuses other
  versions for that reason.
- No Freebuff code, bundle or binary is included or redistributed here; see `NOTICE`.
