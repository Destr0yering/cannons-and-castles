# Cannons and Castles — Devpost Submission

## Submission link

- Official community and public demo: [`r/CannonsAndCastles`](https://www.reddit.com/r/CannonsAndCastles)
- Devvit app slug: `cannons-and-castles`
- Public demonstration video: https://youtu.be/bgM0H4uh7q4

## Tagline

Build the wall, sight the cannons, and outscore your neighbors in a six-round Reddit siege.

## Project Story

### Inspiration

Cannons and Castles was inspired by the immediacy of classic 16-bit strategy games: a small battlefield, rules that are easy to understand, and decisions that become more dramatic every round. We wanted to bring that feeling to Reddit without making a single-player game that merely happened to run inside a post.

The central idea became a shared siege where two or four redditors study the same battlefield, commit their orders simultaneously, and then watch the consequences unfold together. The hook is the anticipation between turns: everyone knows the board state, but nobody knows exactly where the next cannon shots will land.

### What it does

Every commander controls a 5×5 territory containing four castles and four cannons. In a two-player match, the territories appear side by side. In a four-player match, they form one 2×2 battlefield, so every player can see all four homelands at once.

The game always lasts exactly six rounds:

1. Initial build
2. First attack
3. Rebuild
4. Second attack
5. Final rebuild
6. Final barrage

Players receive limited wood, brick, and steel wall inventories. Cannons rotate through 360 degrees in 10-degree steps, and dotted guides show the first enemy structure along each firing line. Wood can be penetrated at reduced power, while brick and steel absorb different percentages of damage. Every surviving cannon fires once per attack round.

All players lock their orders secretly. The server waits until every commander is ready before resolving the phase for everyone. Nobody is eliminated early: even after losing every castle, a player can continue firing surviving cannons and earning damage points through Round 6. Final scores combine weighted siege damage with bonuses for castles that survive.

### How we built it

The production game is a Reddit Devvit Web application. Phaser renders the shared pixel-art battlefield, cannon trajectories, impacts, screen shake, fires, villagers, soldiers, and floating damage numbers. Devvit Realtime distributes match and resolution events, while Redis stores authoritative post-scoped sessions, matchmaking queues, locked turns, recovery state, and the persistent lifetime leaderboard.

The rules engine is server-authoritative. The client submits only build placements or cannon angles; the server validates resources, legal cells, surviving cannons, turn state, direct-fire collisions, penetration, damage, scoring, and six-round progression.

We also retained a local Node.js and Socket.io runtime as a deterministic QA harness. Both the local harness and Devvit server share the same game engine, allowing Playwright to run complete two-player and four-player matches across multiple browser contexts without weakening the production architecture.

### Challenges we faced

The hardest problem was making simultaneous multiplayer turns reliable. A match must wait for every player, resolve exactly once, survive reconnects, and never award leaderboard points twice. We built Redis transaction barriers, idempotent resolution records, recovery paths for missed Realtime messages, and leaderboard receipts that make final scoring safe to retry.

Direct-fire cannon geometry was another challenge. Shots must ignore friendly structures, hit only enemy objects, stop at brick or steel, and optionally continue through one destroyed wood wall at 50% power. Keeping those rules visually predictable required the server raycast and the client dotted aiming guide to follow the same geometry.

Mobile layout required substantial iteration because all territories need to remain readable without creating unnecessary inline scrolling. We created a compact shared-map view, large touch controls, and a dedicated 5×5 mobile build editor so players can place walls accurately without losing sight of the larger battle.

We also had to design for failure rather than only the happy path. Realtime notifications can be missed, browsers can reconnect during resolution, and simultaneous Redis operations can conflict. Treating Redis as the source of truth and making state reconciliation request-driven kept the match recoverable.

### What we learned

We learned that a multiplayer game feels native to Reddit when the community is part of the loop, not simply the place where the game is embedded. A public battle post, verified Reddit identities, shared anticipation, and a persistent community leaderboard give each match a social context.

We also learned the value of testing the actual rules instead of only testing screens. Our automated suite checks the damage model, wall inventories, cannon cost, penetration, scoring, simultaneous Redis joins, recovery, privacy deletion, mobile layouts, and complete six-round matches with two and four clients. The final evaluator passed all 13 engine and Devvit assertions, all seven Playwright scenarios, the production build, and the 55-second submission-video decode for a consolidated automated score of 10/10.

### What we are proud of

We are proud that Cannons and Castles combines a readable retro presentation with a genuinely server-authoritative multiplayer architecture. Tiny villagers run to fires and throw water, soldiers hammer newly rebuilt defenses, cannonballs arc across a battlefield shared by every player, and every dramatic resolution is backed by deterministic rules and recoverable state.

Most importantly, the game creates a clear reason to return: randomized homelands, different opponents, limited materials, evolving firing lanes, and a lifetime damage leaderboard make every six-round siege a new rivalry.

### What's next

After launch, we would like to add rotating battlefield modifiers, named castle banners, weekly siege challenges, seasonal leaderboard resets, and stronger community-driven events. The six-round structure will remain the foundation: quick to understand, tense to play, and short enough to immediately demand a rematch.

## What it does

Cannons and Castles is a two- or four-player simultaneous-turn strategy game built directly into Reddit. Every commander sees the complete shared battlefield while protecting a 5×5 homeland containing four castles and four cannons.

Players construct defenses, rotate each cannon in exact 10-degree steps, and lock their orders in secret. The server waits for every commander before resolving the round for everyone at once. Cannon shots must break through enemy walls before reaching castles, with wood penetration and different brick and steel resistance creating tactical firing lanes.

The match always lasts six rounds. Players cannot be eliminated early, so even a commander who loses every castle can continue attacking and competing for damage points. Final rankings combine weighted siege damage with surviving-castle bonuses, while a persistent leaderboard gives the community a reason to return for another battle.

## The hook

The hook is the shared anticipation between turns. Every player studies the same battlefield, commits without seeing the other commanders' choices, and then watches the entire siege resolve together. New opponents, randomized homelands, limited wall inventories, direct-fire angles, and the lifetime leaderboard make each six-round rivalry different.

## Built with

- Reddit Devvit Web interactive posts
- Phaser for the pixel-art battlefield and resolution effects
- Devvit Redis for authoritative match and leaderboard state
- Devvit Realtime for synchronized multiplayer updates
- TypeScript, Vite, HTML, and CSS
- Playwright and the Devvit test harness for automated multi-client QA

## SNES-era presentation

The game uses a vibrant 16-bit-inspired palette, pixel-perfect Phaser rendering, chunky retro interface panels, optional CRT scanlines, cannonball arcs, screen shake, floating damage numbers, autonomous villagers who douse fires, and soldiers who run to newly rebuilt defenses.

## How to play

1. Open the public Cannons and Castles community through the submission link above.
2. Open the pinned Cannons and Castles battle post.
3. Enter a two- or four-player queue.
4. Build walls during Rounds 1, 3, and 5 and lock the turn.
5. Aim every surviving cannon during Rounds 2, 4, and 6 and lock the turn.
6. Watch each simultaneous resolution and compare final scores after the sixth barrage.

## Testing and quality

The release suite verifies concurrent Redis joins, leaderboard idempotence, weighted damage and penetration, two-player side-by-side rendering, four-player territory visibility, NPC resolution effects, the all-player turn barrier, and a complete four-browser game through all six rounds. The final automated hackathon evaluation records a 10/10 result.

## What we are proud of

The same authoritative rules engine powers both the Reddit deployment and the local Socket.io test harness. This made it possible to test the hardest part of the project—four independent clients committing simultaneous turns across a complete match—without weakening the production architecture.

## What comes next

Future community seasons can add rotating battlefield modifiers, named castle banners, weekly siege challenges, and leaderboard resets while preserving the fast six-round match format.
