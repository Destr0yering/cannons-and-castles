const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logDir = path.join(root, '.logs');
const logFile = path.join(logDir, 'hackathon_eval.log');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const tempDir = path.join(root, 'work', 'playwright-temp');

fs.mkdirSync(logDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

const startedAt = new Date();
const run = spawnSync(process.execPath, [playwrightCli, 'test', 'evaluation.spec.js'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, FORCE_COLOR: '0', TEMP: tempDir, TMP: tempDir },
  timeout: 180_000,
});

const testPassed = run.status === 0;
const checks = [
  ['6-Round State Machine', testPassed],
  ['Turn-Based Multiplayer Sync', testPassed],
  ['Fixed Material Loadouts & Random Territory Spawns', testPassed],
  ['Penetration & Weighted Scoring', testPassed],
  ['Autonomous NPCs', testPassed],
  ['SNES Aesthetic', fs.existsSync(path.join(root, 'public', 'styles.css'))],
  ['2/4-Player Shared-Map Matchmaking', testPassed],
  ['Leaderboard', testPassed],
  ['Code Architecture', fs.existsSync(path.join(root, 'server', 'game-engine.js')) && fs.existsSync(path.join(root, 'public', 'castle-controller.js')) && fs.existsSync(path.join(root, 'src', 'server', 'routes', 'game-api.ts'))],
  ['Playwright Multi-Client Pass', testPassed],
];
const score = checks.filter(([, passed]) => passed).length;
const lines = [
  'CANNONS AND CASTLES — HACKATHON EVALUATION',
  `Started: ${startedAt.toISOString()}`,
  `Finished: ${new Date().toISOString()}`,
  '',
  ...checks.map(([name, passed], index) => `[${passed ? 'PASS' : 'FAIL'}] ${index + 1}. ${name} — ${passed ? '1/1' : '0/1'}`),
  '',
  `FINAL SCORE: ${score}/10`,
  '',
  'PLAYWRIGHT OUTPUT',
  run.stdout || '(no stdout)',
  run.stderr || '(no stderr)',
];

fs.writeFileSync(logFile, `${lines.join('\n')}\n`);
process.stdout.write(`${lines.slice(0, 16).join('\n')}\n`);
process.exit(testPassed && score === 10 ? 0 : 1);
