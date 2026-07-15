# Cannons and Castles — Shared-Territory Build Plan

## Match contract

Cannons and Castles supports exactly two or four players and always lasts six simultaneous-turn rounds:

1. Initial Build
2. Attack I
3. Rebuild I
4. Attack II
5. Rebuild II
6. Final Attack

The shared game engine owns randomized starting structures, inventories, aiming validation, collision, penetration, damage, scoring, and phase progression. In production, Devvit Web endpoints store the authoritative match in Redis and publish updates through Reddit Realtime. The local Socket.io harness runs the same engine for automated multi-browser QA. A phase resolves only after every commander locks an order.

## Devvit delivery contract

- Each Reddit custom post is one two- or four-player matchmaking lobby.
- Reddit user IDs identify players; verified Reddit usernames appear on banners and the leaderboard.
- Redis locks prevent simultaneous join/lock requests from losing state.
- Active post sessions expire after 30 days; leaderboard totals persist across game posts in the subreddit installation.
- Devvit Realtime broadcasts queue, resolution, next-round, and game-over signals; clients refetch their viewer-specific state from `/api/state`.
- The inline post entrypoint is a lightweight SNES splash. Expanded mode loads the complete shared Phaser battlefield.

## Shared battlefield

- Each commander owns one 5×5 territory: 25 cells total.
- A two-player match renders two territories side by side with no unused map area.
- A four-player match renders a shared 2×2 battlefield. Every player has exactly two side-adjacent enemies.
- Every territory begins with four castle houses and four cannons, distributed across its internal regions.
- Castle houses are never spawned in a territory's border cells.
- Every browser sees the entire shared battlefield, while build input remains restricted to its own 5×5 territory.

## Construction

- Initial Build inventory: 10 wood, 5 brick, and 3 steel walls.
- A player may consume all 3 initial steel pieces to construct one additional cannon.
- Each Rebuild inventory: 5 wood, 3 brick, and 2 steel walls.
- Damaged walls cannot be repaired. Players may replace a destroyed wall or build in any other empty cell.

## Direct-fire combat

- Every surviving cannon fires exactly once per Attack round.
- Cannons pivot through 360° in exact 10° increments.
- A dotted guideline runs from each cannon to the first enemy object on its ray.
- Friendly structures are ignored by collision; only side-adjacent enemy structures can be hit.
- Wood takes 100% damage and lets one half-power hit continue to the next enemy object.
- Brick takes 90% damage and stops the shot.
- Steel takes 60% damage and stops the shot.
- A full direct hit destroys a cannon and deals 50% damage to a castle house.
- A half-power hit after wood deals 50% to a cannon or 25% to a castle house.
- Shot paths are snapshotted before simultaneous resolution, so a breach cannot expose a house to a separate cannon until a later Attack round.

## Scoring

- Wall HP removed: 1 point per HP.
- Cannon HP removed: 2 points per HP.
- Castle HP removed: 3 points per HP.
- Destroyed castle: +200 points.
- Surviving castle after Round 6: +250 points each.
- Losing all castles never eliminates a player; they continue firing surviving cannons through the final resolution and receive no survival bonus.

## QA gates

- Verify random starting layouts always contain four castles, four cannons, and no border castle.
- Verify a two-player map is exactly 10×5 and a four-player map is exactly 10×10.
- Verify every four-player territory has exactly two targetable neighbors.
- Verify 10° aiming, friendly-structure immunity, wood penetration, brick/steel absorption, and weighted scores.
- Verify later attacks use the actual number of surviving cannons.
- Verify the four-player lock barrier, all six rounds, NPC resolution animations, final castle bonuses, and leaderboard persistence.
