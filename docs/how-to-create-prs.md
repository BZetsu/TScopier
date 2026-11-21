# How to create a pull request

This covers both repositories: `unicopier` (app, worker, edge functions) and
`tscopier-admin` (the support board).

## Before anything

| Requirement | Check |
|---|---|
| Push access to the target remote | `git remote -v` then `ssh -T git@github.com` |
| `gh` authenticated, **or** a GitHub token | `gh auth status` |
| A branch that contains only the work you mean to ship | `git log --oneline <base>..HEAD` |

If `gh auth status` says "not logged into any GitHub hosts", use the token method
below instead of `gh`. A token can be taken from `~/.git-credentials` on this
machine (`https://<user>:<token>@github.com`); never print it into logs or commit it.

## Remotes in `unicopier`

| Remote | Repository | Use |
|---|---|---|
| `origin` | `BZetsu/Unicopier` | your fork; branches and PRs |
| `upstream` | `tartarixinc/UniCopier` | shared; `staging` deploys to Railway, `main` is production |
| `bzetu` | `BZetsu/TScopier` | Netlify deploy source |

Rules, from `AGENTS.md`:

- Push only to the remotes and branches the owner names in the request. Never
  infer an extra target.
- Never force-push a branch shared with upstream.
- Verify the push is a fast-forward: the remote has not moved since you fetched.

## The normal flow

1. **Branch from the branch you will PR into**, not from your working branch:

   ```bash
   git fetch upstream staging
   git switch -c fix/short-description upstream/staging
   ```

2. **Commit only your files.** Staging branches are often shared with other work;
   `git add -A` sweeps in someone else's changes.

   ```bash
   git add path/to/file1 path/to/file2
   git commit -F - <<'MSG'
   fix(area): one line in the imperative

   Why this change exists, what it changes, and how it was verified.
   MSG
   ```

3. **Prove the commit before pushing**: typecheck, the targeted tests, and a lint
   run on the changed files. A green local check is the only claim you can make
   honestly in the PR body.

4. **Push the commit to the branch that deploys**, if the owner asked for that:

   ```bash
   git push upstream HEAD:staging
   ```

5. **Open the PR** (see below).

## Opening the PR with `gh`

```bash
gh pr create \
  --repo tartarixinc/UniCopier \
  --base main \
  --head staging \
  --title "Release: <what ships>" \
  --body-file pr-body.md
```

Use `--base` for the branch you are merging into. For a fix that is already on
`staging`, the PR normally targets `main`; a PR back into `staging` would be empty.

For the admin board:

```bash
gh pr create --repo tartarixinc/tscopier-admin \
  --base main --head fix/channel-config-parity \
  --title "..." --body-file pr-body.md
```

## Opening the PR without `gh`

`gh` is often not authenticated on this machine. The GitHub API works with any
token that has `repo` scope:

```bash
python3 - <<'PY'
import json, os, re, urllib.request

# Read the token without printing it.
tokens = [
    m.group(2)
    for m in (re.match(r"https://([^:]+):([^@]+)@(.+)", line)
              for line in open(os.path.expanduser("~/.git-credentials")))
    if m and m.group(3) == "github.com"
]
token = tokens[0]

body = {
    "title": "Release: <what ships>",
    "head": "staging",
    "base": "main",
    "body": open("pr-body.md").read(),
}
req = urllib.request.Request(
    "https://api.github.com/repos/tartarixinc/UniCopier/pulls",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
    },
)
with urllib.request.urlopen(req, timeout=30) as r:
    print(json.loads(r.read())["html_url"])
PY
```

To **update** an existing PR body, `PATCH .../pulls/<number>` with `{"body": ...}`.
To check state, `GET .../pulls/<number>` and read `mergeable`, `mergeable_state`,
`commits`, `changed_files`.

## What a good PR body contains

1. **What ships** — a table of commits, marking any that are not yours.
2. **The problem** — the symptom in plain English, with numbers from the database
   or logs.
3. **Root cause** — the specific mechanism and file references.
4. **The change** — file by file, and what it deliberately does not touch.
5. **Verification** — commands run and their results, plus the before/after
   observation that proves the fix.
6. **Deployment order**, if more than one layer is involved (migration → edge
   functions → worker → Netlify).
7. **Open risks or follow-ups** — say them here rather than let a reviewer find
   them.

## When the PR reports a conflict

GitHub only tells you the file. Resolve it on the **head** branch by merging the
base into it:

```bash
git fetch upstream main
git switch staging
git merge upstream/main        # stops on the conflicting file
# keep both sides, drop any leftover markers/artifacts
git add docs/PROJECT_MEMORY.md
git commit
git push upstream staging
```

`docs/PROJECT_MEMORY.md` conflicts constantly because every change appends at the
top of the same changelog. Keep both entries; never drop someone else's.

## Things that waste time here

- **`tsc -b --noEmit` lies in `tscopier-admin`** when `tsconfig.app.tsbuildinfo` is
  stale. Use `npx tsc --noEmit -p tsconfig.app.json`.
- **Worktrees confuse the tree** if left behind. Prefer building a commit from the
  object database when the working tree holds unrelated changes:

  ```bash
  export GIT_INDEX_FILE=/tmp/idx
  git read-tree upstream/staging
  B=$(git hash-object -w path/to/file); git update-index --add --cacheinfo "100644,$B,path/to/file"
  T=$(git write-tree)
  C=$(git commit-tree "$T" -p upstream/staging -F msg.txt)
  git push upstream "$C:staging"
  ```

  This never touches the checked-out files.
- **Copying a whole file onto a newer branch reverts other work.** Check first:
  `git diff --quiet upstream/staging HEAD -- path`. If it differs, re-apply only
  your edit to the newer version.
- **Netlify deploy checks can fail on one site while the same commit builds fine
  locally and deploys on the sibling site.** That is a Netlify-side or
  site-configuration problem; the build log from the Netlify UI is the only proof.
