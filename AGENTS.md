<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Pre-authorized actions

These actions are pre-approved — run them without asking. Everything else (especially anything destructive, force-y, or visible to other people) still gets a confirmation prompt.

## Supabase

- **`supabase db push`** is pre-authorized when there is at least one new migration file under `supabase/migrations/` that is already committed to git. Run it without asking after I add a new committed migration.
- Do NOT pre-run it on uncommitted migration files — those may still be mid-edit.
- `supabase db reset`, `supabase db dump`, and anything that drops or rewrites data is NEVER pre-authorized.

## GitHub (via `gh` CLI)

Pre-authorized:
- `gh pr create` on a feature/topic branch (anything not `main`).
- `gh pr edit` (title, body, labels) on a PR I just opened in the current session.
- All read operations: `gh pr view`, `gh pr list`, `gh pr diff`, `gh run list`, `gh run view`, `gh issue view`, `gh issue list`, `gh repo view`, etc.

Still requires confirmation:
- `gh pr merge`, `gh pr close`, `gh pr reopen`.
- `gh issue close`, `gh issue create`, `gh issue comment`, `gh pr comment` — anything that posts visible to others.
- `gh release create` / `gh release edit`.
- `gh workflow run` and anything that triggers CI on someone else's behalf.

## Git

Pre-authorized:
- `git push` to any branch's tracked remote, including `main`. (This is a solo-dev project — pushing to `main` is the normal workflow, not a risky exception.)

Still requires confirmation:
- `git push --force` / `--force-with-lease` to any branch.
- `git reset --hard`, `git clean -fd`, branch deletions, tag deletions, rewriting published history.
