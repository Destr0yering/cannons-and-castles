import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import engine from '../server/game-engine.js';

const {
  createMatch,
  finalResults,
  normalizeAction,
  raycastEnemyObjects,
  resolveRound,
} = engine;

const entrants = (count) => Array.from({ length: count }, (_, index) => ({
  id: `player-${index + 1}`,
  username: `Player ${index + 1}`,
}));

const emptyGrid = () => Array.from({ length: 5 }, () => Array(5).fill(null));
const structure = (type, hp = 100) => ({ type, hp, maxHp: 100 });

function lockAll(match, actions = new Map()) {
  for (const player of match.players) {
    const fallback = match.phase === 'attack'
      ? normalizeAction(match, player.id, { shots: [] })
      : { placements: [] };
    match.actions.set(player.id, actions.get(player.id) ?? fallback);
    match.ready.add(player.id);
  }
}

function resolveAndRelease(match, actions) {
  lockAll(match, actions);
  const resolution = resolveRound(match);
  if (resolution && !resolution.gameOver) match.resolving = false;
  return resolution;
}

function combatFixture(frontType, frontHp = 100, rearType = null, rearHp = 100) {
  const match = createMatch(`fixture-${frontType}`, entrants(2), () => 0.4);
  match.round = 2;
  match.phase = 'attack';
  match.players[0].grid = emptyGrid();
  match.players[1].grid = emptyGrid();
  match.players[0].grid[2][4] = structure('cannon');
  match.players[1].grid[2][0] = structure(frontType, frontHp);
  if (rearType) match.players[1].grid[2][1] = structure(rearType, rearHp);
  return match;
}

describe('authoritative engine contracts', () => {
  test('ENGINE: two and four player matches enforce the exact six-round sequence and all-ready barrier', () => {
    const expectedPhases = ['build', 'attack', 'rebuild', 'attack', 'rebuild', 'attack'];

    for (const playerCount of [2, 4]) {
      const match = createMatch(`six-round-${playerCount}`, entrants(playerCount), () => 0.4);
      match.ready.add(match.players[0].id);
      expect(resolveRound(match)).toBeNull();
      expect(match).toMatchObject({ round: 1, phase: 'build', resolving: false });
      match.ready.clear();

      const phases = [];
      for (let round = 1; round <= 6; round += 1) {
        const resolution = resolveAndRelease(match);
        expect(resolution).toMatchObject({ round, phase: expectedPhases[round - 1] });
        phases.push(resolution.phase);
      }

      expect(phases).toStrictEqual(expectedPhases);
      expect(match.status).toBe('ending');
      expect(finalResults(match)).toHaveLength(playerCount);
      expect(finalResults(match).filter((result) => result.winner)).toHaveLength(1);
    }
  });

  test('ENGINE: resources, replacement-only building, and optional cannon costs are authoritative', () => {
    const match = createMatch('inventory', entrants(2), () => 0.4);
    const alternate = createMatch('alternate-spawn', entrants(2), () => 0.9);
    const player = match.players[0];
    expect(player.resources).toStrictEqual({ wood: 10, brick: 5, steel: 3 });
    expect(alternate.players[0].grid).not.toStrictEqual(player.grid);
    for (const candidate of [...match.players, ...alternate.players]) {
      expect(candidate.grid.flat().filter((cell) => cell?.type === 'house')).toHaveLength(4);
      expect(candidate.grid.flat().filter((cell) => cell?.type === 'cannon')).toHaveLength(4);
      const borderHouses = candidate.grid.flatMap((row, y) => row.map((cell, x) =>
        cell?.type === 'house' && (x === 0 || x === 4 || y === 0 || y === 4),
      )).filter(Boolean);
      expect(borderHouses).toHaveLength(0);
    }

    const ground = [];
    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        if (!player.grid[y][x]) ground.push({ x, y });
      }
    }
    const [cannonCell, secondCannonCell, steelCell, woodCell, brickCell] = ground;
    const actions = new Map([[player.id, {
      placements: [
        { ...cannonCell, type: 'cannon' },
        { ...secondCannonCell, type: 'cannon' },
        { ...steelCell, type: 'steel' },
        { ...woodCell, type: 'wood' },
        { ...brickCell, type: 'brick' },
      ],
    }]]);
    const build = resolveAndRelease(match, actions);
    expect(build.builds.filter((event) => event.playerId === player.id && event.type === 'cannon')).toHaveLength(1);
    expect(build.builds.filter((event) => event.playerId === player.id).map((event) => event.type).sort())
      .toStrictEqual(['brick', 'cannon', 'wood']);
    expect(player.extraCannonBuilt).toBe(true);

    // Rebuild phases replace empty cells; they do not heal an occupied damaged wall.
    match.round = 3;
    match.phase = 'rebuild';
    match.ready.clear();
    match.actions.clear();
    match.resolving = false;
    player.resources = { wood: 5, brick: 3, steel: 2 };
    player.grid[woodCell.y][woodCell.x].hp = 10;
    const replacement = ground.find(({ x, y }) => !player.grid[y][x]);
    const rebuild = resolveAndRelease(match, new Map([[player.id, {
      placements: [
        { ...woodCell, type: 'wood' },
        { ...replacement, type: 'brick' },
        { ...replacement, type: 'steel' },
      ],
    }]]));
    expect(player.grid[woodCell.y][woodCell.x].hp).toBe(10);
    expect(player.grid[replacement.y][replacement.x].type).toBe('brick');
    expect(rebuild.builds.filter((event) => event.playerId === player.id)).toHaveLength(1);
  });

  test('ENGINE: direct fire penetration, material resistance, cumulative damage, and scoring are exact', () => {
    const wood = combatFixture('wood', 100, 'house', 100);
    const ownWall = { x: 4, y: 2 };
    wood.players[0].grid[ownWall.y][ownWall.x] = structure('cannon');
    wood.players[0].grid[2][3] = structure('steel');
    const ray = raycastEnemyObjects(wood, wood.players[0], { ...ownWall, angle: 0 });
    expect(ray[0]).toMatchObject({ playerId: wood.players[1].id, structure: 'wood' });

    const woodResolution = resolveAndRelease(wood, new Map([[wood.players[0].id, {
      shots: [{ ...ownWall, angle: 0 }],
    }]]));
    expect(woodResolution.impacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ structure: 'wood', damage: 100, points: 100, destroyed: true }),
      expect.objectContaining({ structure: 'house', power: 0.5, damage: 25, points: 75 }),
    ]));
    expect(wood.players[0]).toMatchObject({ rawDamage: 125, damageScore: 175 });

    for (const [type, firstDamage] of [['brick', 90], ['steel', 60]]) {
      const match = combatFixture(type);
      const shooter = match.players[0];
      const first = resolveAndRelease(match, new Map([[shooter.id, {
        shots: [{ x: 4, y: 2, angle: 0 }],
      }]]));
      expect(first.impacts[0]).toMatchObject({ structure: type, damage: firstDamage, destroyed: false });

      match.round = 4;
      match.phase = 'attack';
      match.ready.clear();
      match.actions.clear();
      match.resolving = false;
      const second = resolveAndRelease(match, new Map([[shooter.id, {
        shots: [{ x: 4, y: 2, angle: 0 }],
      }]]));
      expect(second.impacts[0]).toMatchObject({
        structure: type,
        damage: 100 - firstDamage,
        points: 100 - firstDamage,
        destroyed: true,
      });
      expect(shooter).toMatchObject({ rawDamage: 100, damageScore: 100 });
    }
  });

  test('ENGINE: final scoring preserves zero-house players and adds surviving-castle bonuses', () => {
    const match = createMatch('final-score', entrants(2), () => 0.4);
    for (const player of match.players) player.grid = emptyGrid();
    match.players[0].damageScore = 777;
    match.players[0].rawDamage = 300;
    match.players[1].damageScore = 200;
    match.players[1].rawDamage = 200;
    match.players[1].grid[1][1] = structure('house');
    match.players[1].grid[3][3] = structure('house');
    match.round = 6;
    match.phase = 'attack';
    match.ready.clear();
    match.actions.clear();
    match.resolving = false;

    const resolution = resolveAndRelease(match);
    expect(resolution.gameOver).toBe(true);
    const results = finalResults(match);
    const noHouses = results.find((result) => result.id === match.players[0].id);
    const twoHouses = results.find((result) => result.id === match.players[1].id);
    expect(noHouses).toMatchObject({ housesSurviving: 0, survivalBonus: 0, finalScore: 777 });
    expect(twoHouses).toMatchObject({ housesSurviving: 2, survivalBonus: 500, finalScore: 700 });
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(match.players[0].id);
  });

  test('ARCHITECTURE: local and Devvit runtimes share one server-authoritative engine', () => {
    const root = path.resolve(import.meta.dirname, '..');
    const localServer = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    const devvitWrapper = fs.readFileSync(path.join(root, 'src/server/game-engine.ts'), 'utf8');
    const devvitRoute = fs.readFileSync(path.join(root, 'src/server/routes/game-api.ts'), 'utf8');
    expect(localServer).toContain("require('./server/game-engine')");
    expect(devvitWrapper).toContain("from '../../server/game-engine.js'");
    expect(devvitRoute).toContain("from '../game-engine'");
    expect(fs.existsSync(path.join(root, 'public/castle-controller.js'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'src/client/transport/devvit-socket.ts'))).toBe(true);
  });
});
