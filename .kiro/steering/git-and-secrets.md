# Git and secrets policy

Standing rules for this repository. These apply to every session and override any default behaviour.

## Branch

- All work and all commits go to the **`aaradhya`** branch.
- Never commit to `main`. If the current branch is not `aaradhya`, stop and say so rather than switching or committing.
- Never merge into `main`, never rebase onto `main`, and never open a pull request unless explicitly asked in that session.

## Never push

- **Never run `git push`**, with or without flags, unless the user asks for it in that specific session.
- Never run `git push -u`, and never set an upstream. `aaradhya` currently has no upstream, and that is deliberate: a bare `git push` fails rather than sending anything to the remote.
- Never set `push.default`, `push.autoSetupRemote`, or `remote.pushDefault`.
- Never run `git fetch`, `git pull`, or anything that contacts the remote, unless asked. Branches are created from the local HEAD.

## Never deploy

- Never deploy to Zoho Catalyst, never run a deploy script, and never run anything that publishes a build artifact.
- Never run `docker compose up` against a production target, and never apply a migration to a remote database without explicit confirmation in that session.
- Never create CI workflow files that trigger on push or that carry deploy steps. If CI is requested, it runs tests and linters only.

## Committing

- Commit only when asked. Do not commit as a side effect of finishing a task.
- Stage specific files by name. Never `git add -A` or `git add .`, because the working tree is routinely dirtied by the graphify hooks.
- Never use `--amend` on a commit that already exists, and never use `--no-verify`.
- Never use destructive git commands: `push --force`, `reset --hard`, `clean -fd`, `branch -D`.
- Never modify `git config`.

## Secrets: what must never be committed

Never stage or commit a file containing a real value for any of these:

- Database connection strings with an embedded password, including any `postgresql://` or `postgresql+asyncpg://` URL carrying credentials
- `JWT_SECRET`
- `GEMINI_API_KEY`, `GROQ_API_KEY`, `SARVAM_API_KEY`, `BHASHINI_API_KEY`, `OLLAMA_CLOUD_API_KEY`, `GOOGLE_TTS_API_KEY`, `OPENAI_API_KEY`, `MODEL_SERVICE_API_KEY`
- Any private key, certificate, or token file

Before any `git add`, check the staged content for these patterns and refuse if a real value is present:

```
npg_[A-Za-z0-9]{8,}      Neon database password
AIza[A-Za-z0-9_-]{20,}   Google API key
sk-[A-Za-z0-9]{20,}      OpenAI key
gsk_[A-Za-z0-9]{20,}     Groq key
ghp_[A-Za-z0-9]{20,}     GitHub token
```

`.env.example` files are tracked on purpose and must contain **placeholders only**, never live values.

## Secrets: current known exposure

The live Neon database password is already committed in four tracked files and is therefore in git history:

| File | Note |
|---|---|
| `.env.example:16` | worst case, this file is deliberately public |
| `docker-compose.yml:34` | shell default for `DATABASE_URL` |
| `backend/scratch/check_users.py:6` | hardcoded constant |
| `backend/scratch/test_cloud_db.py:5` | hardcoded constant |

`.gitignore` correctly excludes `.env`, `.env.*`, `**/.env` and `**/.env.*` with `!**/.env.example` negations, and only the three `.env.example` files are tracked. The leak bypassed `.gitignore` entirely by going through a tracked template and two tracked scratch scripts.

Adding entries to `.gitignore` cannot fix this, because the value is already in history. The credential must be **rotated in the Neon console**. Until it is rotated, treat that database as compromised. Do not report this as fixed on the basis of a `.gitignore` change.

When cleaning this up, the four files must be edited to remove the value, and the credential rotated. History rewriting is a separate decision for the user to make.

## Local environment facts

- `backend/.env` exists and is correctly ignored. It still contains `JWT_SECRET=change-me-in-production` with `APP_ENV=development`, so the production fail-fast guard in `main.py:41-46` never fires.
- Two local git hooks are installed, `post-commit` and `post-checkout`. Both only rebuild the graphify knowledge graph. Neither pushes nor deploys, so they are safe under this policy. They do write into the tracked `graphify-out/` directory, which is why the working tree goes dirty after every commit and branch switch.
- `graphify-out/` holds 504 tracked content-hashed cache files, about 57 percent of the repository file count. It should be gitignored and removed from the index, but that is the user decision and is not done automatically.
- There is no `.github` directory, so no CI and no push-triggered automation exists today.
