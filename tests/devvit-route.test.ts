import { Context, runWithContext } from '@devvit/server';
import { Header } from '@devvit/shared-types/Header.js';
import { createDevvitTest } from '@devvit/test/server/vitest';
import { expect } from 'vitest';
import { createMatch, resolveRound } from '../src/server/game-engine';
import { gameApi } from '../src/server/routes/game-api';
import { readLeaderboard, readSession, updateSession } from '../src/server/store';
import { battleChannel } from '../src/shared/realtime';

const test = createDevvitTest();

type TestIdentity = {
  id: string;
  username: string;
};

function requestAs(
  headers: Record<string, string | string[] | undefined>,
  postId: string,
  identity: TestIdentity,
  route: string,
  body?: unknown
): Promise<Response> {
  const requestContext = Context({
    ...headers,
    [Header.Post]: postId,
    [Header.User]: identity.id,
    [Header.AppUser]: identity.id,
    [Header.Username]: identity.username,
  });
  const init: RequestInit = body === undefined
    ? { method: 'GET' }
    : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
  return runWithContext(requestContext, () => gameApi.request(`http://devvit.test${route}`, init));
}

function sentMessages(
  mocks: {
    realtime: {
      getSentMessagesForChannel: (channel: string) => Array<{
        data?: { msg?: Record<string, unknown> };
      }>;
    };
  },
  postId: string
) {
  return mocks.realtime
    .getSentMessagesForChannel(battleChannel(postId))
    .map((event) => event.data?.msg);
}

test('DEVVIT ROUTE: four concurrent identities match, wait at the lock barrier, and emit one resolution', async ({
  headers,
  mocks,
}) => {
  const postId = 't3_route_barrier';
  const players = ['alpha', 'bravo', 'charlie', 'delta'].map((username) => ({
    id: `t2_${username}`,
    username,
  }));

  const joins = await Promise.all(
    players.map((player) => requestAs(headers, postId, player, '/join', { desiredPlayers: 4 }))
  );
  expect(joins.every((response) => response.status === 200)).toBe(true);
  const matched = await readSession(postId);
  expect(matched.entrants).toStrictEqual([]);
  expect(matched.match?.players.map((player) => player.id).sort()).toStrictEqual(
    players.map((player) => player.id).sort()
  );

  const partialLocks = await Promise.all(
    players.slice(0, 3).map((player) => requestAs(headers, postId, player, '/lock', {
      action: { placements: [] },
    }))
  );
  expect(partialLocks.every((response) => response.status === 200)).toBe(true);
  const waiting = await readSession(postId);
  expect(waiting.match).toMatchObject({ round: 1, phase: 'build', resolving: false });
  expect(waiting.match?.ready.size).toBe(3);
  expect(waiting.pendingResolution).toBeNull();

  const finalLock = await requestAs(headers, postId, players[3], '/lock', {
    action: { placements: [] },
  });
  expect(finalLock.status).toBe(200);
  const advanced = await readSession(postId);
  expect(advanced.match).toMatchObject({ round: 2, phase: 'attack', resolving: false });
  expect(advanced.match?.ready.size).toBe(0);
  expect(advanced.pendingResolution).toBeNull();
  expect(advanced.lastResolution?.resolution).toMatchObject({ round: 1, nextRound: 2 });

  const messages = sentMessages(mocks, postId);
  expect(messages.filter((message) => message?.type === 'matchFound')).toHaveLength(1);
  expect(messages.filter((message) => message?.type === 'phaseResolution')).toHaveLength(1);
  expect(messages.find((message) => message?.type === 'phaseResolution')?.resolution).toMatchObject({
    round: 1,
    nextRound: 2,
  });
  expect(messages.some((message) => message?.type === 'stateChanged')).toBe(true);

  const firstAttackLock = await requestAs(headers, postId, players[0], '/lock', {
    action: { shots: [] },
  });
  expect(firstAttackLock.status).toBe(200);
  const duplicate = await requestAs(headers, postId, players[0], '/lock', {
    action: { shots: [] },
  });
  expect(duplicate.status).toBe(409);
  expect(await duplicate.json()).toMatchObject({ ok: false, error: 'Those orders are already locked.' });
  expect((await readSession(postId)).match?.ready.size).toBe(1);
});

test('DEVVIT ROUTE: interrupted final resolution recovers once, records once, and supports privacy deletion', async ({
  headers,
  mocks,
}) => {
  const postId = 't3_route_final_recovery';
  const players = [
    { id: 't2_alpha', username: 'alpha' },
    { id: 't2_bravo', username: 'bravo' },
  ];
  const match = createMatch('route-final-match', players);
  match.round = 6;
  match.phase = 'attack';
  for (const player of match.players) {
    match.actions.set(player.id, { shots: [] });
    match.ready.add(player.id);
  }
  const resolution = resolveRound(match);
  expect(resolution?.gameOver).toBe(true);

  await updateSession(postId, (session) => {
    const storedResolution = {
      matchId: match.id,
      resolution: resolution!,
      resolveAt: 0,
    };
    session.match = match;
    session.pendingResolution = storedResolution;
    session.lastResolution = storedResolution;
  });

  const recoveredResponse = await requestAs(headers, postId, players[0], '/state');
  expect(recoveredResponse.status).toBe(200);
  const recovered = await recoveredResponse.json();
  expect(recovered).toMatchObject({ ok: true });
  expect(recovered.finalResults).toHaveLength(2);
  expect(recovered.leaderboard).toHaveLength(2);
  expect((await readSession(postId)).completedBattle).toMatchObject({
    matchId: match.id,
    leaderboardRecorded: true,
  });

  const secondResponse = await requestAs(headers, postId, players[0], '/state');
  expect(secondResponse.status).toBe(200);
  const leaderboard = await readLeaderboard();
  expect(leaderboard).toHaveLength(2);
  expect(leaderboard.every((entry) => entry.battles === 1)).toBe(true);
  const messages = sentMessages(mocks, postId);
  expect(messages.filter((message) => message?.type === 'gameOver')).toHaveLength(1);

  const deletion = await requestAs(
    headers,
    postId,
    players[0],
    '/privacy/delete-leaderboard-entry',
    {}
  );
  expect(deletion.status).toBe(200);
  expect(await deletion.json()).toMatchObject({ ok: true, leaderboard: [{ username: 'bravo' }] });
  expect(await readLeaderboard()).toHaveLength(1);
});
