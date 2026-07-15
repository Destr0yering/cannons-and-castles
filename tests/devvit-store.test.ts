import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { createMatch, resolveRound } from '../src/server/game-engine';
import { battleChannel } from '../src/shared/realtime';
import {
  deleteLeaderboardUser,
  deleteSession,
  readLeaderboard,
  readSession,
  recordLeaderboard,
  settleDueResolution,
  updateSession,
} from '../src/server/store';

const test = createDevvitTest();

test('Realtime channel names use only Reddit-supported characters', () => {
  const channel = battleChannel('t3_1ux0u12');
  expect(channel).toBe('cannons_castles_t3_1ux0u12');
  expect(channel).toMatch(/^[A-Za-z0-9_]+$/);
});

test('Redis transactions retain simultaneous post-lobby joins', async () => {
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

test('leaderboard receipts are concurrent-safe and players are keyed by user id', async () => {
  const firstResult = [
    { id: 't2_alpha', username: 'alpha', rawDamage: 350, winner: true },
  ];

  await Promise.all(
    Array.from({ length: 4 }, () => recordLeaderboard('match-one', firstResult))
  );
  await recordLeaderboard('match-two', [
    { id: 't2_alpha', username: 'ALPHA', rawDamage: 50, winner: false },
  ]);
  const leaderboard = await readLeaderboard();

  expect(leaderboard).toHaveLength(1);
  expect(leaderboard[0]).toMatchObject({
    rank: 1,
    username: 'ALPHA',
    lifetimeDamage: 400,
    victories: 1,
    battles: 2,
  });
});

test('leaderboard entries can be deleted using verified identity', async () => {
  await recordLeaderboard('privacy-match', [
    { id: 't2_private', username: 'private-user', rawDamage: 125, winner: false },
  ]);
  await deleteLeaderboardUser('t2_private', 'private-user');
  expect(await readLeaderboard()).toStrictEqual([]);
});

test('a due phase resolution can be finalized by a later request', async () => {
  const postId = 't3_recovery_test';
  const match = createMatch('recoverable-match', [
    { id: 't2_alpha', username: 'alpha' },
    { id: 't2_bravo', username: 'bravo' },
  ]);
  match.round = 2;
  match.phase = 'attack';
  for (const player of match.players) {
    match.actions.set(player.id, { shots: [] });
    match.ready.add(player.id);
  }
  const resolution = resolveRound(match);
  expect(resolution).not.toBeNull();

  await updateSession(postId, (session) => {
    session.match = match;
    session.pendingResolution = {
      matchId: match.id,
      resolution: resolution!,
      resolveAt: 1_000,
    };
    session.lastResolution = session.pendingResolution;
  });

  expect((await settleDueResolution(postId, 999)).finalized).toBe(false);
  expect((await readSession(postId)).match?.resolving).toBe(true);

  expect((await settleDueResolution(postId, 1_000)).finalized).toBe(true);
  const recovered = await readSession(postId);
  expect(recovered.pendingResolution).toBeNull();
  expect(recovered.lastResolution?.resolution.id).toBe(resolution!.id);
  expect(recovered.match).toMatchObject({ round: 3, status: 'playing', resolving: false });
});

test('final results survive request interruption and post deletion removes the session', async () => {
  const postId = 't3_final_recovery_test';
  const match = createMatch('final-match', [
    { id: 't2_alpha', username: 'alpha' },
    { id: 't2_bravo', username: 'bravo' },
  ]);
  match.round = 6;
  match.phase = 'attack';
  for (const player of match.players) {
    match.actions.set(player.id, { shots: [] });
    match.ready.add(player.id);
  }
  const resolution = resolveRound(match);
  expect(resolution?.gameOver).toBe(true);

  await updateSession(postId, (session) => {
    session.match = match;
    session.pendingResolution = {
      matchId: match.id,
      resolution: resolution!,
      resolveAt: 10,
    };
    session.lastResolution = session.pendingResolution;
  });

  const settlement = await settleDueResolution(postId, 10);
  expect(settlement.completedBattle?.results).toHaveLength(2);
  const completed = await readSession(postId);
  expect(completed.match).toMatchObject({ status: 'ended', resolving: false });
  expect(completed.completedBattle).toMatchObject({
    matchId: 'final-match',
    leaderboardRecorded: false,
  });

  await deleteSession(postId);
  expect(await readSession(postId)).toMatchObject({
    desiredPlayers: null,
    entrants: [],
    match: null,
  });
});
