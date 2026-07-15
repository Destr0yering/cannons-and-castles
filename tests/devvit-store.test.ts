import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import {
  readLeaderboard,
  readSession,
  recordLeaderboard,
  updateSession,
} from '../src/server/store';

const test = createDevvitTest();

test('Redis locking retains simultaneous post-lobby joins', async () => {
  const postId = 't3_transaction_test';
  await Promise.all(
    ['alpha', 'bravo', 'charlie', 'delta'].map((username) =>
      updateSession(postId, (session) => {
        session.desiredPlayers = 4;
        if (!session.entrants.some((entrant) => entrant.username === username)) {
          session.entrants.push({ id: `t2_${username}`, username });
        }
      })
    )
  );

  const session = await readSession(postId);
  expect(session.desiredPlayers).toBe(4);
  expect(session.entrants.map((entrant) => entrant.username).sort()).toStrictEqual([
    'alpha',
    'bravo',
    'charlie',
    'delta',
  ]);
});

test('leaderboard recording is persistent and idempotent per match', async () => {
  const results = [
    { username: 'alpha', rawDamage: 350, winner: true },
    { username: 'bravo', rawDamage: 225, winner: false },
  ];

  await recordLeaderboard('match-one', results);
  await recordLeaderboard('match-one', results);
  const leaderboard = await readLeaderboard();

  expect(leaderboard).toHaveLength(2);
  expect(leaderboard[0]).toMatchObject({
    rank: 1,
    username: 'alpha',
    lifetimeDamage: 350,
    victories: 1,
    battles: 1,
  });
});
