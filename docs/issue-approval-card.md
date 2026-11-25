# Posted issue: CodebuffAI/freebuff#1724 — https://github.com/CodebuffAI/freebuff/issues/1724

**Title:** `[Desktop] Approval card: a long request is unreadable — enlarge the request box and keep Allow/Deny in view`

---

### What happens

When an approval card carries a long request — a plan, a multi-step command, a list of files — the text sits in a small scrolling box inside the card. At the default UI type size it cannot be read in one glance, and the Allow/Deny buttons sit below the text, so they scroll out of view while you read. For a permission prompt that is the wrong trade-off: you end up approving something you could not fully see.

### Where the ceiling comes from

The Desktop window renders the workspace UI from the web app, and the shipped stylesheets cap this surface with two fixed heights and the small UI type size:

```css
.question-dock-body { max-height: 50dvh; overflow-y: auto }
.question-plan      { max-height: 240px; overflow-y: auto }
.question-dock-title{ font-size: var(--dk-font-size-ui) }
```

So it is not a content or wrapping problem — the request text is simply given very little room.

### What would fix it

1. **Collapsed by default:** the first ~4 lines of the request, with `Show full request` / `Collapse`.
2. **Expanded:** a scrollable monospace block at a readable size (14–15px, line-height ≥ 1.6), keyboard-scrollable, `tab-size: 2`, wrapping long commands and paths instead of clipping them.
3. **Header line** with the request kind — shell command, file change, plan, question — plus what it targets (tool name, path count, command length).
4. **Allow/Deny pinned outside the scrolling area**, always visible.
5. **Remember** the open/collapsed choice per conversation, and keep the existing drag-to-resize handle working.
6. **Copy** button for the raw request.

### Scope

Desktop-only and presentational. The renderer for this surface is not in this repository, so this is an issue rather than a PR.

Related, but different: #1074 (plan approval dialog timeout, closed) concerns the timer; #1450 (no user-controllable tool permissions, closed/stale) concerns the permission model; #1661 (terminal refused with no approval UI at all) concerns a missing dialog. This one is only about reading what the dialog already shows.

### Environment

Freebuff Desktop 0.0.205, Windows 11, local workspace.

---

## Notes on posting (not part of the issue body)

- Proposed labels: `type:feature`, `area:desktop`.
- The local stylesheet patch in this repository is one person's workaround for the same
  problem; it is linked only if that is useful, not as a proposed implementation.
