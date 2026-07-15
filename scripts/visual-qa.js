const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');

const root = path.resolve(__dirname, '..');
const tempDir = path.join(root, 'work', 'playwright-temp');
fs.mkdirSync(tempDir, { recursive: true });
process.env.TEMP = tempDir;
process.env.TMP = tempDir;
process.env.NODE_ENV = 'test';

const { chromium } = require('playwright');
const { io, server } = require('../server');

async function main() {
  if (!server.listening) await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  const contexts = [];
  try {
    const lobbyContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(lobbyContext);
    const lobbyPage = await lobbyContext.newPage();
    await lobbyPage.goto('http://127.0.0.1:3000');
    await lobbyPage.screenshot({ path: path.join(root, 'work', 'visual-lobby.png'), fullPage: true });

    const battleContexts = await Promise.all(Array.from({ length: 4 }, () =>
      browser.newContext({ viewport: { width: 1440, height: 1000 } }),
    ));
    contexts.push(...battleContexts);
    const pages = await Promise.all(battleContexts.map((context) => context.newPage()));
    await Promise.all(pages.map(async (page, index) => {
      await page.goto('http://127.0.0.1:3000');
      await page.locator('#username').fill(`Visual_${index + 1}`);
      await page.locator('#join-queue').click();
      await page.locator('#game-shell').waitFor({ state: 'visible' });
    }));
    await pages[0].screenshot({ path: path.join(root, 'work', 'visual-game.png'), fullPage: true });
    await Promise.all(pages.map((page) => page.locator('#lock-turn').click()));
    await Promise.all(pages.map((page) => page.locator('#game-shell[data-round="2"]').waitFor()));
    await pages[0].screenshot({ path: path.join(root, 'work', 'visual-attack.png'), fullPage: true });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
    await new Promise((resolve) => io.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
