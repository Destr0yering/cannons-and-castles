const TERRITORY_SIZE = 5;

const ROUND_DEFS = Object.freeze({
  1: { name: 'INITIAL BUILD', shortName: 'BUILD', phase: 'build' },
  2: { name: 'ATTACK I', shortName: 'ATTACK', phase: 'attack' },
  3: { name: 'REBUILD I', shortName: 'REBUILD', phase: 'rebuild' },
  4: { name: 'ATTACK II', shortName: 'ATTACK', phase: 'attack' },
  5: { name: 'REBUILD II', shortName: 'REBUILD', phase: 'rebuild' },
  6: { name: 'FINAL ATTACK', shortName: 'FINAL', phase: 'attack' },
});

const STRUCTURES = Object.freeze({
  wood: { hp: 100, label: 'Wood Wall', damagePercent: 1, scoreMultiplier: 1 },
  brick: { hp: 100, label: 'Brick Wall', damagePercent: 0.9, scoreMultiplier: 1 },
  steel: { hp: 100, label: 'Steel Wall', damagePercent: 0.6, scoreMultiplier: 1 },
  cannon: { hp: 100, label: 'Cannon', damagePercent: 1, scoreMultiplier: 2 },
  house: { hp: 100, label: 'Castle House', damagePercent: 0.5, scoreMultiplier: 3 },
});

const SCORING = Object.freeze({
  houseDestroyed: 200,
  survivingHouse: 250,
});

const BUILD_COSTS = Object.freeze({
  wood: { wood: 1 },
  brick: { brick: 1 },
  steel: { steel: 1 },
  cannon: { steel: 3 },
});

function resourceLoadout(round) {
  if (round === 1) return { wood: 10, brick: 5, steel: 3 };
  if (round === 3 || round === 5) return { wood: 5, brick: 3, steel: 2 };
  return { wood: 0, brick: 0, steel: 0 };
}

function makeStructure(type) {
  const definition = STRUCTURES[type];
  if (!definition) return null;
  return { type, hp: definition.hp, maxHp: definition.hp };
}

function shuffled(values, random = Math.random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function chooseVacant(candidates, occupied, random) {
  const available = shuffled(candidates, random).filter(({ x, y }) => !occupied.has(`${x}:${y}`));
  return available[0] || null;
}

function createStartingGrid(random = Math.random) {
  const grid = Array.from({ length: TERRITORY_SIZE }, () =>
    Array.from({ length: TERRITORY_SIZE }, () => null),
  );
  const occupied = new Set();
  const houseZones = [
    [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
    [{ x: 3, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 2 }],
    [{ x: 1, y: 3 }, { x: 1, y: 2 }, { x: 2, y: 3 }],
    [{ x: 3, y: 3 }, { x: 3, y: 2 }, { x: 2, y: 3 }],
  ];
  const cannonZones = [
    cellsInRect(0, 0, 2, 2),
    cellsInRect(2, 0, 4, 2),
    cellsInRect(0, 2, 2, 4),
    cellsInRect(2, 2, 4, 4),
  ];

  for (const zone of houseZones) {
    const position = chooseVacant(zone, occupied, random) || chooseVacant(cellsInRect(1, 1, 3, 3), occupied, random);
    occupied.add(`${position.x}:${position.y}`);
    grid[position.y][position.x] = makeStructure('house');
  }
  for (const zone of cannonZones) {
    const position = chooseVacant(zone, occupied, random) || chooseVacant(cellsInRect(0, 0, 4, 4), occupied, random);
    occupied.add(`${position.x}:${position.y}`);
    grid[position.y][position.x] = makeStructure('cannon');
  }
  return grid;
}

function cellsInRect(minX, minY, maxX, maxY) {
  const cells = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) cells.push({ x, y });
  }
  return cells;
}

function territoryPositions(playerCount) {
  if (playerCount === 2) return [{ col: 0, row: 0 }, { col: 1, row: 0 }];
  return [
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: 1, row: 1 },
  ];
}

function matchLayout(playerCount) {
  const columns = 2;
  const rows = playerCount === 2 ? 1 : 2;
  return {
    columns,
    rows,
    territorySize: TERRITORY_SIZE,
    worldWidth: columns * TERRITORY_SIZE,
    worldHeight: rows * TERRITORY_SIZE,
  };
}

function createPlayer(id, username, color, territory, random = Math.random) {
  return {
    id,
    username,
    color,
    territory,
    connected: true,
    grid: createStartingGrid(random),
    resources: resourceLoadout(1),
    rawDamage: 0,
    damageScore: 0,
    destructionBonus: 0,
    survivalBonus: 0,
    finalScore: 0,
    extraCannonBuilt: false,
  };
}

function createMatch(id, entrants, random = Math.random) {
  if (![2, 4].includes(entrants.length)) throw new Error('Matches require two or four players.');
  const colors = ['#ffcf4a', '#55d6be', '#ff6b7a', '#9d8cff'];
  const positions = territoryPositions(entrants.length);
  const match = {
    id,
    desiredPlayers: entrants.length,
    layout: matchLayout(entrants.length),
    players: entrants.map((entrant, index) =>
      createPlayer(entrant.id, entrant.username, colors[index], positions[index], random),
    ),
    round: 1,
    phase: ROUND_DEFS[1].phase,
    status: 'playing',
    resolving: false,
    ready: new Set(),
    actions: new Map(),
    resolutionId: 0,
    createdAt: Date.now(),
  };
  prepareRound(match, true);
  return match;
}

function prepareRound(match, initial = false) {
  const definition = ROUND_DEFS[match.round];
  match.phase = definition.phase;
  match.ready.clear();
  match.actions.clear();
  match.resolving = false;
  if (!initial && (match.round === 3 || match.round === 5)) {
    for (const player of match.players) player.resources = resourceLoadout(match.round);
  }
  if (definition.phase === 'attack') {
    for (const player of match.players) player.resources = resourceLoadout(match.round);
  }
}

function inBounds(x, y) {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < TERRITORY_SIZE && y < TERRITORY_SIZE;
}

function normalizeAngle(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const wrapped = ((Math.round(numeric / 10) * 10) % 360 + 360) % 360;
  return wrapped;
}

function cannonCells(player) {
  const cannons = [];
  for (let y = 0; y < TERRITORY_SIZE; y += 1) {
    for (let x = 0; x < TERRITORY_SIZE; x += 1) {
      if (player.grid[y][x]?.type === 'cannon' && player.grid[y][x].hp > 0) cannons.push({ x, y });
    }
  }
  return cannons;
}

function defaultAttackAngle(player, match) {
  const neighbor = match.players.find((candidate) => areNeighbors(player, candidate));
  if (!neighbor) return 0;
  const dx = neighbor.territory.col - player.territory.col;
  const dy = neighbor.territory.row - player.territory.row;
  return normalizeAngle(Math.atan2(dy, dx) * 180 / Math.PI);
}

function normalizeAction(match, playerId, rawAction = {}) {
  const player = match.players.find((candidate) => candidate.id === playerId);
  if (!player) return null;

  if (match.phase === 'attack') {
    const submitted = new Map();
    for (const shot of Array.isArray(rawAction.shots) ? rawAction.shots : []) {
      const x = Number(shot.x);
      const y = Number(shot.y);
      if (!inBounds(x, y)) continue;
      submitted.set(`${x}:${y}`, normalizeAngle(shot.angle));
    }
    return {
      shots: cannonCells(player).map(({ x, y }) => ({
        x,
        y,
        angle: submitted.get(`${x}:${y}`) ?? defaultAttackAngle(player, match),
      })),
    };
  }

  const allowedTypes = match.phase === 'build' ? new Set(['wood', 'brick', 'steel', 'cannon']) : new Set(['wood', 'brick', 'steel']);
  const placements = Array.isArray(rawAction.placements) ? rawAction.placements : [];
  return {
    placements: placements.slice(0, 25).flatMap((placement) => {
      const x = Number(placement.x);
      const y = Number(placement.y);
      const type = String(placement.type || 'wood');
      if (!inBounds(x, y) || !allowedTypes.has(type)) return [];
      return [{ x, y, type }];
    }),
  };
}

function canAfford(resources, cost) {
  return Object.entries(cost).every(([key, amount]) => resources[key] >= amount);
}

function pay(resources, cost) {
  for (const [key, amount] of Object.entries(cost)) resources[key] -= amount;
}

function applyPlacements(match, player, placements) {
  const events = [];
  const occupiedThisTurn = new Set();
  for (const placement of placements) {
    const key = `${placement.x}:${placement.y}`;
    if (occupiedThisTurn.has(key) || player.grid[placement.y][placement.x]) continue;
    occupiedThisTurn.add(key);

    if (placement.type === 'cannon') {
      if (match.phase !== 'build' || player.extraCannonBuilt) continue;
      if (!canAfford(player.resources, BUILD_COSTS.cannon)) continue;
      pay(player.resources, BUILD_COSTS.cannon);
      player.grid[placement.y][placement.x] = makeStructure('cannon');
      player.extraCannonBuilt = true;
      events.push({ playerId: player.id, x: placement.x, y: placement.y, type: 'cannon', kind: 'built' });
      continue;
    }

    const cost = BUILD_COSTS[placement.type];
    if (!canAfford(player.resources, cost)) continue;
    pay(player.resources, cost);
    player.grid[placement.y][placement.x] = makeStructure(placement.type);
    events.push({
      playerId: player.id,
      x: placement.x,
      y: placement.y,
      type: placement.type,
      kind: match.phase === 'rebuild' ? 'replaced' : 'built',
    });
  }
  return events;
}

function areNeighbors(first, second) {
  if (!first || !second || first.id === second.id) return false;
  return Math.abs(first.territory.col - second.territory.col) + Math.abs(first.territory.row - second.territory.row) === 1;
}

function cloneGrids(match) {
  return new Map(match.players.map((player) => [
    player.id,
    player.grid.map((row) => row.map((cell) => cell ? { ...cell } : null)),
  ]));
}

function worldOrigin(player, shot) {
  return {
    x: player.territory.col * TERRITORY_SIZE + shot.x + 0.5,
    y: player.territory.row * TERRITORY_SIZE + shot.y + 0.5,
  };
}

function rayBoxDistance(origin, direction, minX, minY, maxX, maxY) {
  let near = -Infinity;
  let far = Infinity;
  for (const [originValue, directionValue, minimum, maximum] of [
    [origin.x, direction.x, minX, maxX],
    [origin.y, direction.y, minY, maxY],
  ]) {
    if (Math.abs(directionValue) < 1e-9) {
      if (originValue < minimum || originValue > maximum) return null;
      continue;
    }
    const first = (minimum - originValue) / directionValue;
    const second = (maximum - originValue) / directionValue;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return null;
  }
  if (far <= 0.001) return null;
  return Math.max(near, 0.001);
}

function raycastEnemyObjects(match, attacker, shot, grids = cloneGrids(match)) {
  const origin = worldOrigin(attacker, shot);
  const radians = normalizeAngle(shot.angle) * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const intersections = [];

  for (const defender of match.players) {
    if (!areNeighbors(attacker, defender)) continue;
    const grid = grids.get(defender.id);
    for (let y = 0; y < TERRITORY_SIZE; y += 1) {
      for (let x = 0; x < TERRITORY_SIZE; x += 1) {
        const cell = grid[y][x];
        if (!cell) continue;
        const worldX = defender.territory.col * TERRITORY_SIZE + x;
        const worldY = defender.territory.row * TERRITORY_SIZE + y;
        const distance = rayBoxDistance(origin, direction, worldX, worldY, worldX + 1, worldY + 1);
        if (distance === null) continue;
        intersections.push({
          distance,
          playerId: defender.id,
          x,
          y,
          worldX,
          worldY,
          structure: cell.type,
        });
      }
    }
  }

  return intersections.sort((a, b) => a.distance - b.distance || a.playerId.localeCompare(b.playerId) || a.y - b.y || a.x - b.x);
}

function worldRayEnd(match, origin, angle) {
  const radians = normalizeAngle(angle) * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const candidates = [];
  if (direction.x > 0) candidates.push((match.layout.worldWidth - origin.x) / direction.x);
  if (direction.x < 0) candidates.push((0 - origin.x) / direction.x);
  if (direction.y > 0) candidates.push((match.layout.worldHeight - origin.y) / direction.y);
  if (direction.y < 0) candidates.push((0 - origin.y) / direction.y);
  const distance = Math.min(...candidates.filter((value) => value > 0));
  return { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
}

function planAttacks(match) {
  const snapshots = cloneGrids(match);
  const plans = [];
  for (const attacker of match.players) {
    const action = match.actions.get(attacker.id) || normalizeAction(match, attacker.id, { shots: [] });
    const attackerGrid = snapshots.get(attacker.id);
    for (const shot of action.shots) {
      if (attackerGrid[shot.y][shot.x]?.type !== 'cannon') continue;
      const origin = worldOrigin(attacker, shot);
      const objects = raycastEnemyObjects(match, attacker, shot, snapshots);
      const targets = [];
      if (objects[0]) {
        targets.push({ ...objects[0], power: 1, penetrated: false });
        if (objects[0].structure === 'wood' && objects[1]) {
          targets.push({ ...objects[1], power: 0.5, penetrated: true });
        }
      }
      plans.push({ attackerId: attacker.id, shot, origin, targets, end: worldRayEnd(match, origin, shot.angle) });
    }
  }
  return plans;
}

function applyAttacks(match) {
  const impacts = [];
  for (const plan of planAttacks(match)) {
    const attacker = match.players.find((player) => player.id === plan.attackerId);
    if (!plan.targets.length) {
      impacts.push({
        attackerId: attacker.id,
        cannonX: plan.shot.x,
        cannonY: plan.shot.y,
        angle: plan.shot.angle,
        origin: plan.origin,
        end: plan.end,
        miss: true,
        damage: 0,
        points: 0,
      });
      continue;
    }

    for (const target of plan.targets) {
      const defender = match.players.find((player) => player.id === target.playerId);
      const cell = defender.grid[target.y][target.x];
      const definition = STRUCTURES[target.structure];
      const before = cell?.type === target.structure ? cell.hp : 0;
      const attempted = Math.round(definition.hp * definition.damagePercent * target.power);
      const damage = Math.min(before, attempted);
      if (cell && damage > 0) cell.hp = Math.max(0, cell.hp - attempted);
      const destroyed = Boolean(cell && before > 0 && cell.hp === 0);
      let points = damage * definition.scoreMultiplier;
      let destroyedHouseBonus = 0;
      if (destroyed && target.structure === 'house') {
        destroyedHouseBonus = SCORING.houseDestroyed;
        points += destroyedHouseBonus;
        attacker.destructionBonus += destroyedHouseBonus;
      }
      attacker.rawDamage += damage;
      attacker.damageScore += points;
      if (destroyed) defender.grid[target.y][target.x] = null;

      impacts.push({
        attackerId: attacker.id,
        targetPlayerId: defender.id,
        cannonX: plan.shot.x,
        cannonY: plan.shot.y,
        angle: plan.shot.angle,
        origin: plan.origin,
        end: { x: target.worldX + 0.5, y: target.worldY + 0.5 },
        x: target.x,
        y: target.y,
        worldX: target.worldX,
        worldY: target.worldY,
        structure: target.structure,
        power: target.power,
        penetrated: target.penetrated,
        miss: false,
        damage,
        points,
        destroyed,
        destroyedHouseBonus,
      });
    }
  }
  return impacts;
}

function survivingHouses(player) {
  return player.grid.flat().filter((cell) => cell?.type === 'house' && cell.hp > 0).length;
}

function resolveRound(match) {
  if (match.resolving || match.status !== 'playing' || match.ready.size !== match.players.length) return null;
  match.resolving = true;
  match.resolutionId += 1;
  const resolvedRound = match.round;
  const resolvedPhase = match.phase;
  const builds = [];
  let impacts = [];

  if (resolvedPhase === 'attack') {
    impacts = applyAttacks(match);
  } else {
    for (const player of match.players) {
      const action = match.actions.get(player.id) || { placements: [] };
      builds.push(...applyPlacements(match, player, action.placements));
    }
  }

  const resolution = {
    id: match.resolutionId,
    round: resolvedRound,
    phase: resolvedPhase,
    impacts,
    repairs: builds,
    builds,
    scores: match.players.map((player) => ({
      id: player.id,
      username: player.username,
      rawDamage: player.rawDamage,
      damageScore: player.damageScore,
    })),
    gameOver: resolvedRound === 6,
    nextRound: resolvedRound === 6 ? null : resolvedRound + 1,
  };

  if (resolvedRound === 6) {
    for (const player of match.players) {
      player.survivalBonus = survivingHouses(player) * SCORING.survivingHouse;
      player.finalScore = player.damageScore + player.survivalBonus;
    }
    match.status = 'ending';
    return resolution;
  }

  match.round += 1;
  prepareRound(match);
  match.resolving = true;
  return resolution;
}

function publicMatch(match, viewerId) {
  const definition = ROUND_DEFS[match.round] || ROUND_DEFS[6];
  return {
    id: match.id,
    viewerId,
    desiredPlayers: match.desiredPlayers,
    layout: match.layout,
    round: match.round,
    roundName: definition.name,
    phase: match.phase,
    status: match.status,
    resolving: match.resolving,
    readyCount: match.ready.size,
    totalPlayers: match.players.length,
    rules: {
      aimStep: 10,
      shotsPerCannon: 1,
      woodPenetration: 0.5,
      scoring: SCORING,
    },
    timeline: Object.entries(ROUND_DEFS).map(([round, value]) => ({
      round: Number(round),
      name: value.shortName,
      phase: value.phase,
    })),
    players: match.players.map((player) => ({
      id: player.id,
      username: player.username,
      color: player.color,
      territory: player.territory,
      connected: player.connected,
      grid: player.grid,
      resources: player.resources,
      rawDamage: player.rawDamage,
      damageScore: player.damageScore,
      destructionBonus: player.destructionBonus,
      survivalBonus: player.survivalBonus,
      finalScore: player.finalScore,
      cannonCount: cannonCells(player).length,
      housesSurviving: survivingHouses(player),
      extraCannonBuilt: player.extraCannonBuilt,
      ready: match.ready.has(player.id),
    })),
  };
}

function finalResults(match) {
  return [...match.players]
    .sort((a, b) => b.finalScore - a.finalScore || b.damageScore - a.damageScore || b.rawDamage - a.rawDamage)
    .map((player, index) => ({
      rank: index + 1,
      id: player.id,
      username: player.username,
      rawDamage: player.rawDamage,
      damageScore: player.damageScore,
      destructionBonus: player.destructionBonus,
      housesSurviving: survivingHouses(player),
      survivalBonus: player.survivalBonus,
      finalScore: player.finalScore,
      winner: index === 0,
    }));
}

function serializeMatch(match) {
  return JSON.stringify({
    ...match,
    ready: [...match.ready],
    actions: [...match.actions.entries()],
  });
}

function deserializeMatch(value) {
  if (!value) return null;
  const match = typeof value === 'string' ? JSON.parse(value) : value;
  return {
    ...match,
    ready: new Set(Array.isArray(match.ready) ? match.ready : []),
    actions: new Map(Array.isArray(match.actions) ? match.actions : []),
  };
}

module.exports = {
  BUILD_COSTS,
  ROUND_DEFS,
  SCORING,
  STRUCTURES,
  TERRITORY_SIZE,
  areNeighbors,
  cannonCells,
  createMatch,
  deserializeMatch,
  finalResults,
  normalizeAction,
  publicMatch,
  raycastEnemyObjects,
  resourceLoadout,
  resolveRound,
  serializeMatch,
};
