import { redis } from '@devvit/web/server';
import type { LeaderboardEntry } from '../shared/api';
import {
  deserializeMatch,
  finalResults,
  serializeMatch,
  type EngineMatch,
  type Entrant,
  type FinalResult,
  type PhaseResolution,
} from './game-engine';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOCK_TTL_MS = 10_000;
const LOCK_ATTEMPTS = 180;
const LEADERBOARD_KEY = 'cannons-castles:leaderboard:v2';
const LEGACY_LEADERBOARD_KEY = 'cannons-castles:leaderboard:v1';
const LEADERBOARD_RECEIPT_PREFIX = 'cannons-castles:leaderboard-receipt:v2:';
const LEADERBOARD_RECEIPT_TTL_MS = 35 * 24 * 60 * 60 * 1000;
const LEADERBOARD_MAX_ENTRIES = 500;

export type StoredResolution = {
  matchId: string;
  resolution: PhaseResolution;
  resolveAt: number;
};

export type CompletedBattle = {
  matchId: string;
  completedAt: number;
  results: FinalResult[];
  leaderboardRecorded: boolean;
};

export type BattleSession = {
  desiredPlayers: number | null;
  entrants: Entrant[];
  match: EngineMatch | null;
  pendingResolution: StoredResolution | null;
  lastResolution: StoredResolution | null;
  completedBattle: CompletedBattle | null;
};

export type RequestStatus = 400 | 401 | 404 | 409 | 500;

type LeaderboardStats = Omit<LeaderboardEntry, 'rank'> & {
  userId: string;
  updatedAt: number;
};

type LeaderboardData = {
  version: 2;
  entries: Record<string, LeaderboardStats>;
};

type RedisTransaction = {
  multi: () => Promise<void>;
  set: (
    key: string,
    value: string,
    options?: Parameters<typeof redis.set>[2]
  ) => Promise<unknown>;
  exec: () => Promise<unknown[] | null>;
  discard: () => Promise<void>;
  del: (...keys: string[]) => Promise<unknown>;
};

export type SettlementResult = {
  finalized: boolean;
  completedBattle: CompletedBattle | null;
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
  return {
    desiredPlayers: null,
    entrants: [],
    match: null,
    pendingResolution: null,
    lastResolution: null,
    completedBattle: null,
  };
}

function sessionKey(postId: string): string {
  return `cannons-castles:post:${postId}:session:v1`;
}

function leaderboardReceiptKey(matchId: string): string {
  return `${LEADERBOARD_RECEIPT_PREFIX}${matchId}`;
}

function lockKey(key: string): string {
  return `${key}:lock`;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function watch(...keys: string[]): Promise<RedisTransaction> {
  return (await redis.watch(...keys)) as unknown as RedisTransaction;
}

async function acquireLock(key: string): Promise<string> {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    const acquired = await redis.set(lockKey(key), token, {
      nx: true,
      expiration: new Date(Date.now() + LOCK_TTL_MS),
    });
    if (acquired) return token;
    await pause(8 + Math.floor(Math.random() * 11));
  }
  throw new RequestError('The war room is busy. Try that order again.', 409);
}

async function releaseLock(key: string, token: string): Promise<void> {
  const keyToRelease = lockKey(key);
  const transaction = await watch(keyToRelease);
  if ((await redis.get(keyToRelease)) !== token) {
    await transaction.discard();
    return;
  }
  await transaction.multi();
  await transaction.del(keyToRelease);
  await transaction.exec();
}

async function safelyReleaseLock(key: string, token: string): Promise<void> {
  try {
    await releaseLock(key, token);
  } catch (error) {
    // The short lease expires automatically; cleanup must not mask a committed write.
    console.error(`Failed to release Redis lease ${key}:`, error);
  }
}

function encodeSession(session: BattleSession): string {
  return JSON.stringify({
    desiredPlayers: session.desiredPlayers,
    entrants: session.entrants,
    match: session.match ? JSON.parse(serializeMatch(session.match)) : null,
    pendingResolution: session.pendingResolution,
    lastResolution: session.lastResolution,
    completedBattle: session.completedBattle,
  });
}

function decodeSession(value: string | undefined): BattleSession {
  if (!value) return emptySession();
  const parsed = JSON.parse(value);
  return {
    desiredPlayers: parsed.desiredPlayers ?? null,
    entrants: Array.isArray(parsed.entrants) ? parsed.entrants : [],
    match: parsed.match ? deserializeMatch(parsed.match) : null,
    pendingResolution: parsed.pendingResolution ?? null,
    lastResolution: parsed.lastResolution ?? null,
    completedBattle: parsed.completedBattle ?? null,
  };
}

function emptyLeaderboard(): LeaderboardData {
  return { version: 2, entries: {} };
}

function decodeLeaderboard(
  currentValue: string | undefined,
  legacyValue?: string | undefined
): LeaderboardData {
  if (currentValue) {
    const parsed = JSON.parse(currentValue);
    return {
      version: 2,
      entries: parsed.entries ?? {},
    };
  }
  if (!legacyValue) return emptyLeaderboard();

  const legacy = JSON.parse(legacyValue);
  const migrated = emptyLeaderboard();
  for (const entry of Object.values(legacy.entries ?? {}) as Array<
    Omit<LeaderboardEntry, 'rank'>
  >) {
    const userId = `legacy:${entry.username.toLocaleLowerCase()}`;
    migrated.entries[userId] = {
      userId,
      username: entry.username,
      lifetimeDamage: entry.lifetimeDamage,
      victories: entry.victories,
      battles: entry.battles,
      updatedAt: 0,
    };
  }
  return migrated;
}

function rankedEntries(data: LeaderboardData): LeaderboardStats[] {
  return Object.values(data.entries).sort(
    (first, second) =>
      second.lifetimeDamage - first.lifetimeDamage ||
      second.victories - first.victories ||
      first.username.localeCompare(second.username)
  );
}

function capLeaderboard(data: LeaderboardData): void {
  for (const entry of rankedEntries(data).slice(LEADERBOARD_MAX_ENTRIES)) {
    delete data.entries[entry.userId];
  }
}

async function readLeaderboardData(): Promise<LeaderboardData> {
  const current = await redis.get(LEADERBOARD_KEY);
  if (current) return decodeLeaderboard(current);
  return decodeLeaderboard(undefined, await redis.get(LEGACY_LEADERBOARD_KEY));
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
    await safelyReleaseLock(key, token);
  }
}

export async function settleDueResolution(
  postId: string,
  now = Date.now()
): Promise<SettlementResult> {
  return updateSession(postId, (session) => {
    const pending = session.pendingResolution;
    if (!pending || pending.resolveAt > now) {
      return { finalized: false, completedBattle: session.completedBattle };
    }

    const match = session.match;
    if (!match || match.id !== pending.matchId) {
      session.pendingResolution = null;
      return { finalized: true, completedBattle: session.completedBattle };
    }

    match.resolving = false;
    if (pending.resolution.gameOver) {
      match.status = 'ended';
      session.completedBattle ??= {
        matchId: match.id,
        completedAt: now,
        results: finalResults(match),
        leaderboardRecorded: false,
      };
    }
    session.pendingResolution = null;
    return { finalized: true, completedBattle: session.completedBattle };
  });
}

export async function markLeaderboardRecorded(
  postId: string,
  matchId: string
): Promise<void> {
  await updateSession(postId, (session) => {
    if (session.completedBattle?.matchId === matchId) {
      session.completedBattle.leaderboardRecorded = true;
    }
  });
}

export async function deleteSession(postId: string): Promise<void> {
  await redis.del(sessionKey(postId));
}

export async function readLeaderboard(): Promise<LeaderboardEntry[]> {
  return rankedEntries(await readLeaderboardData())
    .slice(0, 20)
    .map(({ userId: _userId, updatedAt: _updatedAt, ...entry }, index) => ({
      rank: index + 1,
      ...entry,
    }));
}

export async function recordLeaderboard(
  matchId: string,
  results: FinalResult[]
): Promise<LeaderboardEntry[]> {
  const receiptKey = leaderboardReceiptKey(matchId);
  const token = await acquireLock(LEADERBOARD_KEY);
  try {
    if (await redis.get(receiptKey)) return readLeaderboard();
    const currentValue = await redis.get(LEADERBOARD_KEY);
    const legacyValue = currentValue
      ? undefined
      : await redis.get(LEGACY_LEADERBOARD_KEY);
    const data = decodeLeaderboard(currentValue, legacyValue);
    const updatedAt = Date.now();
    for (const result of results) {
      const userId = result.id || `legacy:${result.username.toLocaleLowerCase()}`;
      const current = data.entries[userId] ?? {
        userId,
        username: result.username,
        lifetimeDamage: 0,
        victories: 0,
        battles: 0,
        updatedAt,
      };
      current.username = result.username;
      current.lifetimeDamage += result.rawDamage;
      current.victories += result.winner ? 1 : 0;
      current.battles += 1;
      current.updatedAt = updatedAt;
      data.entries[userId] = current;
    }
    capLeaderboard(data);

    const transaction = await watch(LEADERBOARD_KEY, receiptKey);
    await transaction.multi();
    await transaction.set(LEADERBOARD_KEY, JSON.stringify(data));
    await transaction.set(receiptKey, '1', {
      expiration: new Date(Date.now() + LEADERBOARD_RECEIPT_TTL_MS),
    });
    const committed = await transaction.exec();
    if (!committed || committed.length < 2) {
      throw new RequestError('The leaderboard write conflicted. It will be retried.', 409);
    }
    return readLeaderboard();
  } finally {
    await safelyReleaseLock(LEADERBOARD_KEY, token);
  }
}

export async function deleteLeaderboardUser(
  userId: string,
  username: string
): Promise<void> {
  const token = await acquireLock(LEADERBOARD_KEY);
  try {
    const currentValue = await redis.get(LEADERBOARD_KEY);
    const legacyValue = currentValue
      ? undefined
      : await redis.get(LEGACY_LEADERBOARD_KEY);
    const data = decodeLeaderboard(currentValue, legacyValue);
    delete data.entries[userId];
    delete data.entries[`legacy:${username.toLocaleLowerCase()}`];
    await redis.set(LEADERBOARD_KEY, JSON.stringify(data));
  } finally {
    await safelyReleaseLock(LEADERBOARD_KEY, token);
  }
}
