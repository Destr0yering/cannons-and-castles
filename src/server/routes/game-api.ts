import { randomUUID } from 'node:crypto';
import { context, realtime, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type {
  ActionResponse,
  InitResponse,
  LeaderboardEntry,
  RealtimeMessage,
  StateResponse,
} from '../../shared/api';
import { battleChannel } from '../../shared/realtime';
import {
  createMatch,
  normalizeAction,
  publicMatch,
  resolveRound,
  type PhaseResolution,
} from '../game-engine';
import {
  deleteLeaderboardUser,
  markLeaderboardRecorded,
  readLeaderboard,
  readSession,
  recordLeaderboard,
  RequestError,
  settleDueResolution,
  updateSession,
  type BattleSession,
  type RequestStatus,
} from '../store';

const RESOLUTION_MS = 1450;

type Identity = {
  postId: string;
  userId: string;
  username: string;
};

type JoinBody = {
  desiredPlayers?: number;
};

type LockBody = {
  action?: unknown;
};

type JoinResult = {
  desiredPlayers: number;
  queued: number;
  matchId?: string;
  players?: string[];
};

type LockResult = {
  matchId: string;
  readyCount: number;
  totalPlayers: number;
  resolution: PhaseResolution | null;
};

type ReconciledSession = {
  session: BattleSession;
  leaderboard: LeaderboardEntry[];
};

export const gameApi = new Hono();

async function getIdentity(): Promise<Identity> {
  const postId = context.postId;
  const userId = context.userId;
  const username = context.username ?? (await reddit.getCurrentUsername());
  if (!postId) throw new RequestError('Open this game from its Reddit post.', 400);
  if (!userId || !username) throw new RequestError('Sign in to Reddit to command a territory.', 401);
  return { postId, userId, username };
}

function channel(postId: string): string {
  return battleChannel(postId);
}

async function safePublish(postId: string, message: RealtimeMessage): Promise<void> {
  try {
    await realtime.send(channel(postId), message);
  } catch (error) {
    // Redis is authoritative. A later state refresh recovers a missed notification.
    console.error(`Realtime ${message.type} notification failed:`, error);
  }
}

function errorResponse(error: unknown): { status: RequestStatus; message: string } {
  if (error instanceof RequestError) return { status: error.status, message: error.message };
  console.error('Cannons and Castles API error:', error);
  return { status: 500, message: 'The war room lost that order. Please try again.' };
}

async function reconcileAndNotify(postId: string): Promise<ReconciledSession> {
  const settlement = await settleDueResolution(postId);
  let session = await readSession(postId);
  let leaderboard: LeaderboardEntry[];

  if (session.completedBattle && !session.completedBattle.leaderboardRecorded) {
    try {
      leaderboard = await recordLeaderboard(
        session.completedBattle.matchId,
        session.completedBattle.results
      );
      await markLeaderboardRecorded(postId, session.completedBattle.matchId);
      session = await readSession(postId);
    } catch (error) {
      // The completed battle remains durable and the next request retries idempotently.
      console.error('Deferred leaderboard recording failed:', error);
      leaderboard = await readLeaderboard();
    }
  } else {
    leaderboard = await readLeaderboard();
  }

  if (settlement.finalized) {
    if (
      session.completedBattle &&
      session.match?.id === session.completedBattle.matchId
    ) {
      await safePublish(postId, {
        type: 'gameOver',
        results: session.completedBattle.results,
        leaderboard,
      });
    } else {
      await safePublish(postId, { type: 'stateChanged' });
    }
  }
  return { session, leaderboard };
}

function recoveryFields(session: BattleSession, isPlayer: boolean) {
  const completed = session.completedBattle;
  const completedResults =
    completed && completed.matchId === session.match?.id
      ? completed.results
      : null;
  return {
    lastResolution: isPlayer ? session.lastResolution?.resolution ?? null : null,
    finalResults: isPlayer ? completedResults : null,
  };
}

gameApi.get('/init', async (c) => {
  try {
    const identity = await getIdentity();
    const { session, leaderboard } = await reconcileAndNotify(identity.postId);
    const match = session.match;
    const isPlayer = Boolean(
      match?.players.some((player) => player.id === identity.userId)
    );
    const queuedFor = session.entrants.some((entrant) => entrant.id === identity.userId)
      ? session.desiredPlayers
      : null;
    return c.json<InitResponse>({
      ok: true,
      postId: identity.postId,
      username: identity.username,
      desiredPlayers: session.desiredPlayers,
      queued: session.entrants.length,
      queuedFor,
      matchId: isPlayer && match ? match.id : undefined,
      state: isPlayer && match ? publicMatch(match, identity.userId) : null,
      ...recoveryFields(session, isPlayer),
      leaderboard,
    });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<InitResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.get('/state', async (c) => {
  try {
    const identity = await getIdentity();
    const { session, leaderboard } = await reconcileAndNotify(identity.postId);
    if (!session.match || !session.match.players.some((player) => player.id === identity.userId)) {
      throw new RequestError('You are not assigned to the active battle.', 404);
    }
    return c.json<StateResponse>({
      ok: true,
      state: publicMatch(session.match, identity.userId),
      ...recoveryFields(session, true),
      leaderboard,
    });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<StateResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.get('/leaderboard', async (c) => {
  return c.json({ ok: true, leaderboard: await readLeaderboard() });
});

gameApi.post('/join', async (c) => {
  try {
    const identity = await getIdentity();
    await reconcileAndNotify(identity.postId);
    const body = await c.req.json<JoinBody>();
    const desiredPlayers = Number(body.desiredPlayers);
    if (desiredPlayers !== 2 && desiredPlayers !== 4) {
      throw new RequestError('Choose a two- or four-player battle.');
    }

    const result = await updateSession<JoinResult>(identity.postId, (session) => {
      if (session.match?.status === 'ended') {
        session.match = null;
        session.desiredPlayers = null;
        session.entrants = [];
        session.pendingResolution = null;
        session.lastResolution = null;
        session.completedBattle = null;
      }
      if (session.match) {
        const currentPlayer = session.match.players.find(
          (player) => player.id === identity.userId
        );
        if (!currentPlayer) throw new RequestError('This battle is already underway.', 409);
        return {
          desiredPlayers: session.match.desiredPlayers,
          queued: 0,
          matchId: session.match.id,
          players: session.match.players.map((player) => player.username),
        };
      }

      if (session.desiredPlayers && session.desiredPlayers !== desiredPlayers) {
        throw new RequestError(
          `This post is rallying ${session.desiredPlayers} commanders. Choose that army size.`,
          409
        );
      }
      session.desiredPlayers = desiredPlayers;
      if (!session.entrants.some((entrant) => entrant.id === identity.userId)) {
        session.entrants.push({ id: identity.userId, username: identity.username });
      }

      if (session.entrants.length === desiredPlayers) {
        session.match = createMatch(randomUUID(), session.entrants);
        session.entrants = [];
        return {
          desiredPlayers,
          queued: 0,
          matchId: session.match.id,
          players: session.match.players.map((player) => player.username),
        };
      }
      return { desiredPlayers, queued: session.entrants.length };
    });

    if (result.matchId && result.players) {
      await safePublish(identity.postId, {
        type: 'matchFound',
        matchId: result.matchId,
        players: result.players,
      });
      await safePublish(identity.postId, { type: 'stateChanged' });
    } else {
      await safePublish(identity.postId, {
        type: 'queueStatus',
        desiredPlayers: result.desiredPlayers,
        queued: result.queued,
      });
    }
    return c.json<ActionResponse>({ ok: true, ...result });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<ActionResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.post('/leave', async (c) => {
  try {
    const identity = await getIdentity();
    await reconcileAndNotify(identity.postId);
    const result = await updateSession(identity.postId, (session) => {
      if (session.match) throw new RequestError('The battle has already begun.', 409);
      session.entrants = session.entrants.filter(
        (entrant) => entrant.id !== identity.userId
      );
      if (!session.entrants.length) session.desiredPlayers = null;
      return {
        desiredPlayers: session.desiredPlayers ?? 4,
        queued: session.entrants.length,
      };
    });
    await safePublish(identity.postId, { type: 'queueStatus', ...result });
    return c.json<ActionResponse>({ ok: true, ...result });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<ActionResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.post('/lock', async (c) => {
  try {
    const identity = await getIdentity();
    await reconcileAndNotify(identity.postId);
    const body = await c.req.json<LockBody>();
    const turn = await updateSession<LockResult>(identity.postId, (session) => {
      const match = session.match;
      if (!match || !match.players.some((player) => player.id === identity.userId)) {
        throw new RequestError('No active battle found.', 404);
      }
      if (match.status !== 'playing' || match.resolving) {
        throw new RequestError('The battlefield is resolving.', 409);
      }
      if (match.ready.has(identity.userId)) {
        throw new RequestError('Those orders are already locked.', 409);
      }
      const action = normalizeAction(match, identity.userId, body.action ?? {});
      if (!action) throw new RequestError('Those orders are invalid.');
      match.actions.set(identity.userId, action);
      match.ready.add(identity.userId);
      const readyCount = match.ready.size;
      const totalPlayers = match.players.length;
      const resolution = readyCount === totalPlayers ? resolveRound(match) : null;
      if (resolution) {
        const storedResolution = {
          matchId: match.id,
          resolution,
          resolveAt: Date.now() + RESOLUTION_MS,
        };
        session.pendingResolution = storedResolution;
        session.lastResolution = storedResolution;
      }
      return {
        matchId: match.id,
        readyCount,
        totalPlayers,
        resolution,
      };
    });

    if (!turn.resolution) {
      await safePublish(identity.postId, { type: 'stateChanged' });
      return c.json<ActionResponse>({
        ok: true,
        readyCount: turn.readyCount,
        totalPlayers: turn.totalPlayers,
      });
    }

    await safePublish(identity.postId, {
      type: 'phaseResolution',
      resolution: turn.resolution,
    });
    await new Promise((resolve) => setTimeout(resolve, RESOLUTION_MS));
    await reconcileAndNotify(identity.postId);

    return c.json<ActionResponse>({
      ok: true,
      readyCount: turn.readyCount,
      totalPlayers: turn.totalPlayers,
    });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<ActionResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.post('/privacy/delete-leaderboard-entry', async (c) => {
  try {
    const identity = await getIdentity();
    await deleteLeaderboardUser(identity.userId, identity.username);
    return c.json<ActionResponse>({ ok: true, leaderboard: await readLeaderboard() });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<ActionResponse>({ ok: false, error: failure.message }, failure.status);
  }
});
