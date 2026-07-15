import { redis } from '@devvit/web/server';
import type { LeaderboardEntry } from '../shared/api';
import {
  deserializeMatch,
  serializeMatch,
  type EngineMatch,
  type Entrant,
  type FinalResult,
} from './game-engine';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 10_000;
const LOCK_ATTEMPTS = 60;
const LEADERBOARD_KEY = 'cannons-castles:leaderboard:v1';

export type BattleSession = {
  desiredPlayers: number | null;
  entrants: Entrant[];
  match: EngineMatch | null;
};

export type RequestStatus = 400 | 401 | 404 | 409 | 500;

type LeaderboardStats = Omit<LeaderboardEntry, 'rank'>;

type LeaderboardData = {
  entries: Record<string, LeaderboardStats>;
  completedMatches: Record<string, number>;
};

export class RequestError extends Error {
  readonly status: RequestStatus;

  constructor(message: string, status: RequestStatus = 400) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
  }
}

function emptySession(): BattleSession {
  return { desiredPlayers: null, entrants: [], match: null };
}

function sessionKey(postId: string): string {
  return `cannons-castles:post:${postId}:session:v1`;
}

function lockKey(key: string): string {
  return `${key}:lock`;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(key: string): Promise<string> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const acquired = await redis.set(lockKey(key), token, {
      nx: true,
      expiration: new Date(Date.now() + LOCK_TTL_MS),
    });
    if (acquired) return token;
    await pause(10 + Math.floor(Math.random() * 16));
  }
  throw new RequestError('The war room is busy. Try that order again.', 409);
}

async function releaseLock(key: string, token: string): Promise<void> {
  // The token guard prevents an expired lock holder from deleting a newer lock.
  if ((await redis.get(lockKey(key))) === token) {
    await redis.del(lockKey(key));
  }
}

function encodeSession(session: BattleSession): string {
  return JSON.stringify({
    desiredPlayers: session.desiredPlayers,
    entrants: session.entrants,
    match: session.match ? JSON.parse(serializeMatch(session.match)) : null,
  });
}

function decodeSession(value: string | undefined): BattleSession {
  if (!value) return emptySession();
  const parsed = JSON.parse(value);
  return {
    desiredPlayers: parsed.desiredPlayers ?? null,
    entrants: Array.isArray(parsed.entrants) ? parsed.entrants : [],
    match: parsed.match ? deserializeMatch(parsed.match) : null,
  };
}

function decodeLeaderboard(value: string | undefined): LeaderboardData {
  if (!value) return { entries: {}, completedMatches: {} };
  const parsed = JSON.parse(value);
  return {
    entries: parsed.entries ?? {},
    completedMatches: parsed.completedMatches ?? {},
  };
}

export async function readSession(postId: string): Promise<BattleSession> {
  return decodeSession(await redis.get(sessionKey(postId)));
}

export async function updateSession<Result>(
  postId: string,
  mutate: (session: BattleSession) => Result
): Promise<Result> {
  const key = sessionKey(postId);
  const token = await acquireLock(key);
  try {
    const session = decodeSession(await redis.get(key));
    const result = mutate(session);
    await redis.set(key, encodeSession(session), {
      expiration: new Date(Date.now() + SESSION_TTL_MS),
    });
    return result;
  } finally {
    await releaseLock(key, token);
  }
}

export async function readLeaderboard(): Promise<LeaderboardEntry[]> {
  const data = decodeLeaderboard(await redis.get(LEADERBOARD_KEY));
  return Object.values(data.entries)
    .sort(
      (first, second) =>
        second.lifetimeDamage - first.lifetimeDamage ||
        second.victories - first.victories ||
        first.username.localeCompare(second.username)
    )
    .slice(0, 20)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

export async function recordLeaderboard(
  matchId: string,
  results: FinalResult[]
): Promise<LeaderboardEntry[]> {
  const token = await acquireLock(LEADERBOARD_KEY);
  try {
    const data = decodeLeaderboard(await redis.get(LEADERBOARD_KEY));
    if (data.completedMatches[matchId]) {
      return readLeaderboard();
    }

    for (const result of results) {
      const current = data.entries[result.username] ?? {
        username: result.username,
        lifetimeDamage: 0,
        victories: 0,
        battles: 0,
      };
      current.lifetimeDamage += result.rawDamage;
      current.victories += result.winner ? 1 : 0;
      current.battles += 1;
      data.entries[result.username] = current;
    }
    data.completedMatches[matchId] = Date.now();

    await redis.set(LEADERBOARD_KEY, JSON.stringify(data));
    return readLeaderboard();
  } finally {
    await releaseLock(LEADERBOARD_KEY, token);
  }
}
