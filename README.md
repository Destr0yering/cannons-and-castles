# Cannons and Castles

A two- or four-player, server-authoritative castle battler with a shared battlefield and a six-round simultaneous-turn loop. The production build runs as the Reddit Devvit app `cannons-and-castles`; the Socket.io runtime is retained as a deterministic local QA harness.

## Play Cannons and Castles

The official community is [`r/CannonsAndCastles`](https://www.reddit.com/r/CannonsAndCastles). New battle posts host complete two- or four-player matches directly on Reddit.

## Reddit Devvit development

Node.js 22.2 or newer is required.

```powershell
cd "C:\Users\thoma\Documents\Codex\2026-07-15\build-a-clone-of-the-game-3"
npm install
npm run dev
```

The development target is [`r/CannonsAndCastles`](https://www.reddit.com/r/CannonsAndCastles). `npm run dev` watches the source, uploads development versions, and streams Devvit server logs.

Production multiplayer uses Reddit identity, post-scoped matchmaking, Redis locking for the simultaneous-turn barrier and persistent state, and Devvit Realtime for client notifications. Redis remains authoritative: reconnecting clients resync state, interrupted resolutions are finalized idempotently, and completed results remain recoverable after a missed Realtime event. The lifetime leaderboard is shared by all game posts in the app's subreddit installation.

## Stored data and deletion

- Battle sessions expire after 30 days and are deleted immediately when their Reddit battle post is deleted.
- Leaderboard aggregates use the verified Reddit user ID as their canonical key while displaying the latest verified username.
- The leaderboard is capped at 500 commanders. Per-match idempotency receipts expire after 35 days, preventing unbounded match-history growth.
- A signed-in player can use **Remove my leaderboard data** in the war room; the underlying endpoint derives identity from Reddit context and accepts no user-supplied identity.

## Support and privacy requests

For gameplay support, bug reports, or privacy help, contact the moderators through [r/CannonsAndCastles Modmail](https://www.reddit.com/message/compose?to=r/CannonsAndCastles). Include the battle-post link, device/browser, match size, and round where the problem occurred, but do not include passwords, access tokens, or other sensitive information.

## Start locally

```powershell
cd "C:\Users\thoma\Documents\Codex\2026-07-15\build-a-clone-of-the-game-3"
npm start
```

Open the local address `127.0.0.1:3000` in two or four browser tabs. Enter a different commander name in each tab, select the same match size, and join matchmaking.

## The battlefield

- Every player owns one 5×5 territory containing four randomly distributed castle houses and four cannons.
- Two-player territories appear side by side. Four-player territories form a single 2×2 map, giving each commander two side-adjacent enemies.
- Every browser sees all territories at once.
- Castle houses never begin on a border cell.

## Build and rebuild

Round 1 grants exactly 10 wood, 5 brick, and 3 steel wall pieces. One optional extra cannon costs all 3 steel pieces.

Rounds 3 and 5 grant 5 wood, 3 brick, and 2 steel pieces. Existing damaged walls cannot be repaired. A player can replace a destroyed wall or add a new wall to any empty homeland cell.

## Aim and attack

Every surviving cannon fires once per Attack round. Use the left/right controls to rotate each cannon through 360° in 10° increments. The dotted guide shows the first enemy object its direct-fire ray will hit. Friendly structures do not block cannon fire.

- Wood: destroyed by a full shot; 50% power continues to one structure behind it.
- Brick: takes 90% damage and stops the shot.
- Steel: takes 60% damage and stops the shot.
- Cannon: destroyed by a direct full-power hit.
- Castle: takes 50% from a direct hit or 25% after wood penetration.

## Scoring

- Wall damage: 1 point per HP.
- Cannon damage: 2 points per HP.
- Castle damage: 3 points per HP.
- Destroyed castle: 200-point bonus.
- Surviving castle: 250-point final bonus each.

A commander with no castles remains active through Round 6 and can continue earning attack points with any surviving cannons.

## Automated QA

```powershell
npm run type-check
npm run build
npm run test:devvit
npm test
npm run evaluate
```

The suite validates concurrent Redis joins, canonical leaderboard identity, receipt idempotence, recoverable phase settlement, post-deletion cleanup, the damage model, a real two-player side-by-side match, and a full four-client game through all six rounds. The scored run writes `.logs/hackathon_eval.log`.

## Project map

- `devvit.json` — Reddit post entrypoints, server bundle, permissions, menu action, and install trigger.
- `src/server/routes/game-api.ts` — Devvit matchmaking, Redis turn barrier, Realtime resolution, and leaderboard endpoints.
- `tests/devvit-store.test.ts` — in-memory Devvit Redis concurrency, recovery, retention, and leaderboard coverage.
- `src/client/transport/devvit-socket.ts` — Socket-compatible Reddit REST/Realtime adapter for the Phaser controller.
- `server.js` — local Express/Socket.io matchmaking and phase barrier used by automated multi-client QA.
- `server/game-engine.js` — territory generation, raycasting, penetration, damage, and scoring.
- `public/castle-controller.js` — shared Phaser battlefield, aim guides, and resolution effects.
- `evaluation.spec.js` — rules and multi-client acceptance coverage.
- `PLAN.md` — authoritative gameplay and QA contract.

`npm run deploy` uploads a checked Devvit version. `npm run launch` uploads and submits the app for Reddit review; run it only when the submission copy and assets are final.
