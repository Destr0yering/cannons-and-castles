# Cannons and Castles — Devpost Submission

## Submission link

- Official community and public demo: [`r/CannonsAndCastles`](https://www.reddit.com/r/CannonsAndCastles)
- Devvit app slug: `cannons-and-castles`

## Tagline

Build the wall, sight the cannons, and outscore your neighbors in a six-round Reddit siege.

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
