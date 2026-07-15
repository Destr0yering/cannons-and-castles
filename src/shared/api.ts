import type { JsonValue } from '@devvit/web/shared';

export type LeaderboardEntry = {
  rank: number;
  username: string;
  lifetimeDamage: number;
  victories: number;
  battles: number;
};

export type InitResponse = {
  ok: boolean;
  error?: string;
  postId?: string;
  username?: string;
  desiredPlayers?: number | null;
  queued?: number;
  queuedFor?: number | null;
  matchId?: string;
  state?: JsonValue | null;
  lastResolution?: JsonValue | null;
  finalResults?: JsonValue | null;
  leaderboard?: LeaderboardEntry[];
};

export type ActionResponse = {
  ok: boolean;
  error?: string;
  desiredPlayers?: number;
  queued?: number;
  readyCount?: number;
  totalPlayers?: number;
  matchId?: string;
  leaderboard?: LeaderboardEntry[];
};

export type StateResponse = {
  ok: boolean;
  error?: string;
  state?: JsonValue;
  lastResolution?: JsonValue | null;
  finalResults?: JsonValue | null;
  leaderboard?: LeaderboardEntry[];
};

export type RealtimeMessage =
  | { type: 'queueStatus'; desiredPlayers: number; queued: number }
  | { type: 'matchFound'; matchId: string; players: string[] }
  | { type: 'stateChanged' }
  | { type: 'phaseResolution'; resolution: JsonValue }
  | {
      type: 'gameOver';
      results: JsonValue;
      leaderboard: LeaderboardEntry[];
    };
