# Cannons and Castles — Deployment Runbook

## Production identity

- Devvit app: `cannons-and-castles`
- Production subreddit: `r/CannonsAndCastles`
- Production community URL: https://www.reddit.com/r/CannonsAndCastles
- Match sizes: two or four players

The former development subreddit is not part of this release. Do not use it in app metadata, documentation, judging instructions, screenshots, or submission fields.

## 1. Automated release gate

Run from the project directory:

```powershell
npm install
npm run type-check
npm run build
npm run test:devvit
npm test
npm run evaluate
```

Required result: every command exits successfully and `.logs/hackathon_eval.log` ends with `FINAL SCORE: 10/10`.

## 2. Production subreddit gate

- Confirm `r/CannonsAndCastles` is Public, not Private or Restricted.
- Keep the member count below 200 through the end of judging.
- Add a concise description, icon, banner, rules, and a moderator contact path.
- Install the current Devvit build.
- Create one clean Cannons and Castles battle post and pin it.
- Open the pinned post while logged out to confirm that judges can reach it.

## 3. Manual game gate

- Complete one two-player match with separate Reddit accounts.
- Complete one four-player match with separate Reddit accounts.
- Test one moderator, one regular user, and one developer account.
- Test desktop Edge and a mobile Reddit client or mobile web viewport.
- Confirm matchmaking, all-player turn locking, six-round completion, NPC effects, final scores, and leaderboard updates.
- Confirm the expanded game does not create an unusable nested scrolling experience.

## 4. Devvit review gate

- Confirm the root `README.md` accurately explains gameplay, configuration, deployment, and the full feature set.
- Confirm no off-platform community link appears inside the playable app.
- Confirm stored Reddit identity data has an approved retention/deletion strategy.
- Review the current Devvit Rules immediately before publishing.
- Run `npm run launch` only after every gate above passes. This uploads the release and submits it to Reddit review.

## 5. GitHub gate

- Confirm repository owner, repository name, visibility, author name, and license.
- Initialize the repository on `main`.
- Confirm `.gitignore` excludes credentials, dependencies, logs, local data, generated builds, and test artifacts.
- Run a final secret scan.
- Commit the exact tested release, push it, and verify the public repository view.
- Add the approved preview image and Devpost summary to the repository page if desired.

## 6. Devpost gate

- Use `DEVPOST_SUBMISSION.md` as the submission-copy source.
- Supply the Devvit app listing in the dedicated app field.
- Supply the final public pinned battle-post URL in the demo field.
- Upload the strongest battlefield screenshot and, if available, a short multiplayer resolution video.
- Verify every submission field while logged out.
- Submit before the hackathon deadline and save the confirmation page.

## Current release state

- Production subreddit configured: complete
- Canonical README links: complete
- Devpost draft: complete
- TypeScript check: passing
- Production build: passing
- Latest production-subreddit playtest upload: `v0.0.1.25`
- Public subreddit/logged-out verification: pending
- Mobile and role-based manual tests: pending
- Devvit publish/review submission: pending
- GitHub repository and remote: pending
- Final public demo-post URL: pending
- Devpost submission confirmation: pending
