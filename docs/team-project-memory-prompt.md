# Team Prompt: Project Memory / Change Log Rules

Give this to your teammates. They paste it into their AI coding tool's rules file:

- **Codex:** add to `AGENTS.md` (project root)
- **Cursor:** add to `.cursor/rules/project-memory.mdc` (or `.cursorrules`)

---

```
## Project Memory / Change Log (MANDATORY)

You MUST maintain YOUR OWN persistent project memory file at
`docs/PROJECT_MEMORY_<your-github-username>.md` (create it if it doesn't
exist). Example: for user `emmydapson`, the file is
`docs/PROJECT_MEMORY_emmydapson.md`.

WHY YOUR OWN FILE, NOT A SHARED ONE: every teammate has their own file.
Git only reports a merge conflict when two people edit the SAME lines of the
SAME file. Since you only ever append to YOUR file, your entries can never
conflict with anyone else's. NEVER touch another teammate's memory file and
never write entries into a shared changelog file.

### Session start
Before any non-trivial work, read `docs/PROJECT_MEMORY_<your-github-username>.md`
and load the latest entries as context. It is your source of truth for "what
was already tried, decided, and why". Also skim the other teammates' memory
files (they exist in `docs/`) so you know what they are working on — read-only,
never edit them.

### After every material change
Any code change, migration, deploy, config change, or debugging session that
reaches a conclusion MUST append a NEW entry at the TOP of the `## Changelog`
section of YOUR file. Never edit or delete old entries — the file is an
append-only history.

### Required entry structure
### YYYY-MM-DD — Short descriptive title

- **Context:** the problem, who/what triggered it, what was observed. Facts
  only. If you are not sure about something, say so instead of guessing.
- **Root cause:** what actually caused the problem, after verifying with
  evidence (logs, reproduction, tests). Not a hypothesis dressed as a fact.
- **Solution:** exactly what was implemented and why it addresses the root
  cause.
- **Affected files:** full paths of every file changed.
- **Verification:** what you actually ran (tests, lint, typecheck, build,
  deploys) and the results. NEVER write a verification you did not run.
- **Blockers:** anything still broken, unfinished, or blocking progress.
- **Follow-up:** open items, next steps, things to verify later.

### Hard rules
- NEVER write secrets into the memory file: passwords, API keys, tokens,
  credentials, private URLs. Keep them in environment/secrets managers.
- Do not fabricate. If you did not verify it, mark it as unverified.
- If you cannot explain what changed and why, you are not done — keep working
  until you can.
- Keep entries dense and factual. No filler, no analogies, no jargon that is
  not explained.
- Only edit YOUR OWN memory file. Reading others' files is fine; writing to
  them is forbidden.

### Format example (user: emmydapson)
### 2026-08-05 — User trade list now shows execution-type tags

- **Context:** User needed the trade list to identify each row's execution
  type (single, range, layered).
- **Root cause:** No evidence-based classifier existed; broker settings were
  being treated as proof of execution.
- **Solution:** Added a classifier that uses successful order comments and
  execution actions before falling back to linked-row counts.
- **Affected files:** `src/lib/tradeExecutionType.ts`,
  `src/components/user/UserTradesTab.tsx`.
- **Verification:** ESLint and TypeScript typecheck passed.
- **Blockers:** None.
- **Follow-up:** Verify the XAUUSD range basket in staging.
```

---

## Placement notes per tool

| Tool | Where to put it | Notes |
|---|---|---|
| Codex | `AGENTS.md` (root of each repo) | Loads automatically every session |
| Cursor | `.cursor/rules/*.mdc` or `.cursorrules` | Use `.mdc` with `Always` applicability; it loads automatically |
| Claude Code | `CLAUDE.md` (root) | Loads automatically every session |
| Windsurf | `.windsurfrules` (root) | Loads automatically |

## How the files lay out in the repo

```
docs/
  PROJECT_MEMORY.md              <- BZetsu's personal log (keep as-is)
  PROJECT_MEMORY_emmydapson.md   <- Emmanuel's log (he creates it)
  PROJECT_MEMORY_mosodi007.md    <- Martins's log (he creates it)
  PROJECT_MEMORY_sebchi-crtl.md  <- Sebastine's log (he creates it)
```

Each person appends only to their own file → zero merge conflicts, ever.
If someone new joins, they just create `docs/PROJECT_MEMORY_<their-username>.md`
using this same prompt.

## Existing CHANGELOG.md (Emma's)

Emma already maintains `CHANGELOG.md` (release-notes style, Keep a Changelog
format). That file stays untouched — it is a shared release-notes file for the
repo, updated deliberately. The per-person memory files are problem-context
logs and live completely separate from it.

## If they work on multiple repos

The pattern is per-repo AND per-person: each repo they work in gets its own
`docs/PROJECT_MEMORY_<their-username>.md`. The file lives inside the repo it
describes, so it is version-controlled, reviewed in PRs, and shared with the
whole team — with the append-only per-person rule keeping merges clean.
