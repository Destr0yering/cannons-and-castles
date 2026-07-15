import { randomUUID } from 'node:crypto';
import { context, realtime, reddit } from '@devvit/web/server';
import { Hono } from 'hono';
import type {
  ActionResponse,
  InitResponse,
  RealtimeMessage,
  StateResponse,
} from '../../shared/api';
import {
  createMatch,
  finalResults,
  normalizeAction,
  publicMatch,
  resolveRound,
  type PhaseResolution,
} from '../game-engine';
import {
  readLeaderboard,
  readSession,
  recordLeaderboard,
  RequestError,
  updateSession,
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
  return `cannons-castles:${postId}`;
}

async function publish(postId: string, message: RealtimeMessage): Promise<void> {
  await realtime.send(channel(postId), message);
}

function errorResponse(error: unknown): { status: RequestStatus; message: string } {
  if (error instanceof RequestError) return { status: error.status, message: error.message };
  console.error('Cannons and Castles API error:', error);
  return { status: 500, message: 'The war room lost that order. Please try again.' };
}

gameApi.get('/init', async (c) => {
  try {
    const identity = await getIdentity();
    const [session, leaderboard] = await Promise.all([
      readSession(identity.postId),
      readLeaderboard(),
    ]);
    const activeMatch = session.match?.status !== 'ended' ? session.match : null;
    const isPlayer = Boolean(
      activeMatch?.players.some((player) => player.id === identity.userId)
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
      matchId: isPlayer && activeMatch ? activeMatch.id : undefined,
      state: isPlayer && activeMatch ? publicMatch(activeMatch, identity.userId) : null,
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
    const session = await readSession(identity.postId);
    if (!session.match || !session.match.players.some((player) => player.id === identity.userId)) {
      throw new RequestError('You are not assigned to the active battle.', 404);
    }
    return c.json<StateResponse>({
      ok: true,
      state: publicMatch(session.match, identity.userId),
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
      await publish(identity.postId, {
        type: 'matchFound',
        matchId: result.matchId,
        players: result.players,
      });
      await publish(identity.postId, { type: 'stateChanged' });
    } else {
      await publish(identity.postId, {
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
    await publish(identity.postId, { type: 'queueStatus', ...result });
    return c.json<ActionResponse>({ ok: true, ...result });
  } catch (error) {
    const failure = errorResponse(error);
    return c.json<ActionResponse>({ ok: false, error: failure.message }, failure.status);
  }
});

gameApi.post('/lock', async (c) => {
  try {
    const identity = await getIdentity();
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
      return {
        matchId: match.id,
        readyCount,
        totalPlayers,
        resolution,
      };
    });

    if (!turn.resolution) {
      await publish(identity.postId, { type: 'stateChanged' });
      return c.json<ActionResponse>({
        ok: true,
        readyCount: turn.readyCount,
        totalPlayers: turn.totalPlayers,
      });
    }

    await publish(identity.postId, {
      type: 'phaseResolution',
      resolution: turn.resolution,
    });
    await new Promise((resolve) => setTimeout(resolve, RESOLUTION_MS));

    if (turn.resolution.gameOver) {
      const results = await updateSession(identity.postId, (session) => {
        const match = session.match;
        if (!match || match.id !== turn.matchId) {
          throw new RequestError('The completed battle could not be found.', 404);
        }
        match.status = 'ended';
        match.resolving = false;
        return finalResults(match);
      });
      const leaderboard = await recordLeaderboard(turn.matchId, results);
      await publish(identity.postId, { type: 'gameOver', results, leaderboard });
    } else {
      await updateSession(identity.postId, (session) => {
        const match = session.match;
        if (!match || match.id !== turn.matchId) {
          throw new RequestError('The active battle could not be found.', 404);
        }
        match.resolving = false;
      });
      await publish(identity.postId, { type: 'stateChanged' });
    }

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
