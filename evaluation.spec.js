const { test, expect } = require('@playwright/test');
const { createMatch, resolveRound } = require('./server/game-engine');

test.describe.configure({ mode: 'serial' });

async function createClients(browser, count, prefix) {
  const contexts = await Promise.all(Array.from({ length: count }, () => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  await Promise.all(pages.map(async (page, index) => {
    await page.goto('/');
    await page.locator('#username').fill(`${prefix}_${index + 1}`);
    await page.locator(`input[name="desiredPlayers"][value="${count}"]`).check();
    await page.locator('#join-queue').click();
  }));
  await Promise.all(pages.map((page) => expect(page.locator('#game-shell')).toBeVisible()));
  return { contexts, pages };
}

async function closeClients(contexts) {
  await Promise.all(contexts.map((context) => context.close()));
}

async function resetServer(request) {
  const response = await request.post('/api/test/reset');
  expect(response.ok()).toBeTruthy();
}

async function waitForRound(pages, round) {
  await Promise.all(pages.map((page) =>
    expect(page.locator('#game-shell')).toHaveAttribute('data-round', String(round)),
  ));
}

async function lockAll(pages) {
  await Promise.all(pages.map((page) => page.locator('#lock-turn').click()));
}

async function placeFirstOpen(page, tool) {
  await page.locator(`[data-tool="${tool}"]`).click();
  await page.locator('.board-cell[data-structure="ground"]:not(.pending)').first().click();
}

function blankGrid() {
  return Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => null));
}

function structure(type, hp = 100) {
  return { type, hp, maxHp: 100 };
}

function combatFixture(frontType, frontHp = 100, rearType = 'house', rearHp = 100) {
  const match = createMatch('damage-fixture', [
    { id: 'attacker', username: 'Attacker' },
    { id: 'defender', username: 'Defender' },
  ], () => 0.4);
  match.round = 2;
  match.phase = 'attack';
  match.players[0].grid = blankGrid();
  match.players[1].grid = blankGrid();
  match.players[0].grid[2][1] = structure('cannon');
  match.players[1].grid[2][0] = structure(frontType, frontHp);
  if (rearType) match.players[1].grid[2][1] = structure(rearType, rearHp);
  match.actions.set('attacker', { shots: [{ x: 1, y: 2, angle: 0 }] });
  match.actions.set('defender', { shots: [] });
  match.ready.add('attacker');
  match.ready.add('defender');
  return match;
}

test.beforeEach(async ({ request }) => {
  await resetServer(request);
});

test('authoritative damage model applies penetration, material resistance, and weighted scoring', async () => {
  const woodMatch = combatFixture('wood');
  const woodResolution = resolveRound(woodMatch);
  expect(woodResolution.impacts).toHaveLength(2);
  expect(woodResolution.impacts[0]).toMatchObject({ structure: 'wood', damage: 100, points: 100, destroyed: true });
  expect(woodResolution.impacts[1]).toMatchObject({ structure: 'house', power: 0.5, damage: 25, points: 75 });
  expect(woodMatch.players[1].grid[2][1].hp).toBe(75);
  expect(woodMatch.players[0].damageScore).toBe(175);

  const brickMatch = combatFixture('brick');
  const brickResolution = resolveRound(brickMatch);
  expect(brickResolution.impacts).toHaveLength(1);
  expect(brickResolution.impacts[0]).toMatchObject({ structure: 'brick', damage: 90, points: 90, destroyed: false });
  expect(brickMatch.players[1].grid[2][1].hp).toBe(100);

  const steelMatch = combatFixture('steel');
  const steelResolution = resolveRound(steelMatch);
  expect(steelResolution.impacts[0]).toMatchObject({ structure: 'steel', damage: 60, points: 60, destroyed: false });

  const houseMatch = combatFixture('house', 50, null);
  const houseResolution = resolveRound(houseMatch);
  expect(houseResolution.impacts[0]).toMatchObject({
    structure: 'house', damage: 50, destroyed: true, destroyedHouseBonus: 200, points: 350,
  });
});

test('two-player matches render exactly two side-by-side 5×5 territories', async ({ browser }) => {
  const { contexts, pages } = await createClients(browser, 2, 'Duelist');
  try {
    for (const page of pages) {
      const state = await page.evaluate(() => window.__gameDebug.getState());
      expect(state.totalPlayers).toBe(2);
      expect(state.layout).toEqual({ columns: 2, rows: 1, territorySize: 5, worldWidth: 10, worldHeight: 5 });
      expect(state.players).toHaveLength(2);
      expect(await page.locator('input[name="desiredPlayers"][value="3"]').count()).toBe(0);
      for (const player of state.players) {
        expect(player.grid).toHaveLength(5);
        expect(player.grid.every((row) => row.length === 5)).toBeTruthy();
        expect(player.grid.flat().filter((cell) => cell?.type === 'house')).toHaveLength(4);
        expect(player.grid.flat().filter((cell) => cell?.type === 'cannon')).toHaveLength(4);
        const borderHouses = player.grid.flatMap((row, y) => row.map((cell, x) =>
          cell?.type === 'house' && (x === 0 || x === 4 || y === 0 || y === 4),
        )).filter(Boolean);
        expect(borderHouses).toHaveLength(0);
      }
    }
  } finally {
    await closeClients(contexts);
  }
});

test('four clients see all territories and complete the six-round direct-fire battle', async ({ browser, request }) => {
  test.setTimeout(90_000);
  const { contexts, pages } = await createClients(browser, 4, 'Redditor');
  try {
    for (const page of pages) {
      const state = await page.evaluate(() => window.__gameDebug.getState());
      expect(state.layout).toEqual({ columns: 2, rows: 2, territorySize: 5, worldWidth: 10, worldHeight: 10 });
      expect(state.players).toHaveLength(4);
      const self = state.players.find((player) => player.id === state.viewerId);
      const neighbors = state.players.filter((player) =>
        player.id !== self.id && Math.abs(player.territory.col - self.territory.col) + Math.abs(player.territory.row - self.territory.row) === 1,
      );
      expect(neighbors).toHaveLength(2);
      expect(self.resources).toEqual({ wood: 10, brick: 5, steel: 3 });
      expect(self.cannonCount).toBe(4);
      expect(self.housesSurviving).toBe(4);
    }

    // Round 1: wall materials and the optional fifth cannon all use real inventory.
    await Promise.all(pages.map(async (page) => {
      await placeFirstOpen(page, 'wood');
      await placeFirstOpen(page, 'brick');
      await placeFirstOpen(page, 'cannon');
      await expect(page.locator('#order-count')).toHaveText('3 / 25');
    }));

    // Three locks cannot advance a four-player room.
    await Promise.all(pages.slice(0, 3).map((page) => page.locator('#lock-turn').click()));
    await expect(pages[0].locator('#game-shell')).toHaveAttribute('data-round', '1');
    await expect(pages[0].locator('#ready-counter')).toContainText('3 / 4');
    await pages[3].locator('#lock-turn').click();
    await waitForRound(pages, 2);

    // Every cannon has one 10-degree aim and the default solver finds an enemy object.
    await Promise.all(pages.map(async (page) => {
      await expect(page.locator('.cannon-aim-row')).toHaveCount(5);
      expect(await page.locator('.cannon-aim-row:not([data-hit="miss"])').count()).toBeGreaterThan(0);
      const aims = await page.evaluate(() => window.__gameDebug.getAims());
      expect(aims).toHaveLength(5);
      expect(aims.every((aim) => aim.angle % 10 === 0)).toBeTruthy();
      await page.locator('.cannon-aim-row').first().locator('[data-turn="10"]').click();
      const rotated = await page.evaluate(() => window.__gameDebug.getAims()[0].angle);
      expect(rotated % 10).toBe(0);
    }));
    await lockAll(pages);
    await waitForRound(pages, 3);
    await Promise.all(pages.map((page) =>
      expect(page.locator('#game-shell')).toHaveAttribute('data-villager-water-count', /[1-9]\d*/),
    ));
    expect((await pages[0].evaluate(() => window.__gameDebug.getState())).players.some((player) => player.damageScore > 0)).toBeTruthy();

    // Round 3: fixed rebuild inventory; only new walls can be placed.
    for (const page of pages) {
      const state = await page.evaluate(() => window.__gameDebug.getState());
      const self = state.players.find((player) => player.id === state.viewerId);
      expect(self.resources).toEqual({ wood: 5, brick: 3, steel: 2 });
    }
    await Promise.all(pages.map(async (page) => {
      await placeFirstOpen(page, 'wood');
      await placeFirstOpen(page, 'brick');
    }));
    await lockAll(pages);
    await waitForRound(pages, 4);
    await Promise.all(pages.map((page) =>
      expect(page.locator('#game-shell')).toHaveAttribute('data-soldier-hammer-count', /[1-9]\d*/),
    ));

    // Round 4: second direct-fire volley.
    await Promise.all(pages.map(async (page) => {
      const state = await page.evaluate(() => window.__gameDebug.getState());
      const self = state.players.find((player) => player.id === state.viewerId);
      await expect(page.locator('.cannon-aim-row')).toHaveCount(self.cannonCount);
    }));
    await lockAll(pages);
    await waitForRound(pages, 5);

    // Round 5: walls can be added to any currently open homeland cell.
    await Promise.all(pages.map((page) => placeFirstOpen(page, 'steel')));
    await lockAll(pages);
    await waitForRound(pages, 6);

    // Round 6: everyone remains active; scoring ends only after the final barrage.
    await lockAll(pages);
    await Promise.all(pages.map((page) => expect(page.locator('#end-screen')).toBeVisible()));
    await Promise.all(pages.map(async (page) => {
      await expect(page.locator('#end-screen')).toHaveAttribute('data-game-over', 'true');
      await expect(page.locator('.final-result')).toHaveCount(4);
      await expect(page.locator('.final-result.winner')).toHaveCount(1);
      const rows = await page.locator('.final-result').allTextContents();
      expect(rows.every((row) => row.includes('CASTLES'))).toBeTruthy();
    }));

    const leaderboardResponse = await request.get('/api/leaderboard');
    expect(leaderboardResponse.ok()).toBeTruthy();
    const { leaderboard } = await leaderboardResponse.json();
    expect(leaderboard).toHaveLength(4);
    expect(leaderboard.some((entry) => entry.lifetimeDamage > 0)).toBeTruthy();
  } finally {
    await closeClients(contexts);
  }
});
