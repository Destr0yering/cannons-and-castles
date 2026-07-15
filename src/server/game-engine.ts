import type { JsonValue } from '@devvit/web/shared';

// The CommonJS engine is deliberately shared with the local Socket.io QA harness.
// @ts-expect-error A handwritten declaration here keeps both runtimes on one rules implementation.
import commonEngine from '../../server/game-engine.js';

export type Entrant = {
  id: string;
  username: string;
};

export type EnginePlayer = Entrant & {
  rawDamage: number;
  [key: string]: unknown;
};

export type EngineMatch = {
  id: string;
  desiredPlayers: number;
  round: number;
  phase: string;
  status: string;
  resolving: boolean;
  ready: Set<string>;
  actions: Map<string, unknown>;
  resolutionId: number;
  players: EnginePlayer[];
  [key: string]: unknown;
};

export type PhaseResolution = {
  id: number;
  gameOver: boolean;
  [key: string]: JsonValue;
};

export type FinalResult = {
  id: string;
  username: string;
  rawDamage: number;
  winner: boolean;
  [key: string]: JsonValue;
};

type EngineModule = {
  createMatch: (id: string, entrants: Entrant[]) => EngineMatch;
  deserializeMatch: (value: string | object) => EngineMatch | null;
  finalResults: (match: EngineMatch) => FinalResult[];
  normalizeAction: (
    match: EngineMatch,
    playerId: string,
    action: unknown
  ) => unknown | null;
  publicMatch: (match: EngineMatch, viewerId: string) => JsonValue;
  resolveRound: (match: EngineMatch) => PhaseResolution | null;
  serializeMatch: (match: EngineMatch) => string;
};

const engine: EngineModule = commonEngine;

export const {
  createMatch,
  deserializeMatch,
  finalResults,
  normalizeAction,
  publicMatch,
  resolveRound,
  serializeMatch,
} = engine;
