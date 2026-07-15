const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const logDir = path.join(root, '.logs');
const outputDir = path.join(root, 'outputs');
const workDir = path.join(root, 'work', 'evaluation');
const tempDir = path.join(root, 'work', 'playwright-temp');
const logFile = path.join(logDir, 'hackathon_eval.log');
const outputLogFile = path.join(outputDir, 'hackathon_eval.log');
const vitestReportFile = path.join(workDir, 'vitest.json');
const playwrightReportFile = path.join(workDir, 'playwright.json');
const testResultsDir = path.join(root, 'test-results');
const minimumFreeBytes = 256 * 1024 * 1024;

for (const directory of [workDir, tempDir, testResultsDir]) {
  fs.rmSync(directory, { recursive: true, force: true });
}

const disk = fs.statfsSync(root);
const freeBytes = disk.bavail * disk.bsize;
if (freeBytes < minimumFreeBytes) {
  console.error(
    `Evaluation not started: only ${Math.floor(freeBytes / 1024 / 1024)} MiB is free. `
      + `Free at least ${minimumFreeBytes / 1024 / 1024} MiB so Chromium can write test artifacts.`,
  );
  process.exit(2);
}

for (const directory of [logDir, outputDir, workDir, tempDir]) {
  fs.mkdirSync(directory, { recursive: true });
}
for (const report of [vitestReportFile, playwrightReportFile]) {
  fs.rmSync(report, { force: true });
}

function runNode(label, script, args = [], timeout = 180_000, extraEnv = {}) {
  const startedAt = Date.now();
  const run = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FORCE_COLOR: '0',
      TEMP: tempDir,
      TMP: tempDir,
      ...extraEnv,
    },
    maxBuffer: 10 * 1024 * 1024,
    timeout,
  });
  return {
    label,
    passed: run.status === 0,
    status: run.status,
    durationMs: Date.now() - startedAt,
    stdout: run.stdout || '',
    stderr: run.stderr || '',
    error: run.error ? String(run.error.stack || run.error) : '',
  };
}

function readJson(filename) {
  try {
    return JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function collectVitest(report) {
  const titles = new Map();
  for (const file of report?.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      titles.set(assertion.title, assertion.status === 'passed');
    }
  }
  return titles;
}

function collectPlaywright(report) {
  const titles = new Map();
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) titles.set(spec.title, spec.ok === true);
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report?.suites ?? []) visit(suite);
  return titles;
}

const startedAt = new Date();
const tsc = runNode(
  'TypeScript',
  path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
  ['--build'],
  120_000,
);
const build = runNode(
  'Production build',
  path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
  ['build'],
  120_000,
);
const vitest = runNode(
  'Engine + Devvit storage/API/recovery',
  path.join(root, 'node_modules', 'vitest', 'vitest.mjs'),
  [
    'run',
    '--config',
    'vitest.config.ts',
    'tests/game-engine.test.js',
    'tests/devvit-store.test.ts',
    'tests/devvit-route.test.ts',
    '--reporter=json',
    `--outputFile=${vitestReportFile}`,
  ],
  180_000,
);
const playwright = runNode(
  'Desktop + mobile multi-client Playwright',
  path.join(root, 'node_modules', '@playwright', 'test', 'cli.js'),
  ['test', 'evaluation.spec.js', '--reporter=json'],
  300_000,
  { PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightReportFile },
);
const video = runNode(
  'Submission video decode',
  path.join(root, 'scripts', 'verify-video.js'),
  [],
  120_000,
);

const vitestReport = readJson(vitestReportFile);
const playwrightReport = readJson(playwrightReportFile);
const vitestTests = collectVitest(vitestReport);
const playwrightTests = collectPlaywright(playwrightReport);
const videoReport = (() => {
  try {
    return JSON.parse(video.stdout);
  } catch (_error) {
    return null;
  }
})();

const V = (title) => ({
  source: 'Vitest',
  title,
  passed: vitest.passed && vitestTests.get(title) === true,
});
const P = (title) => ({
  source: 'Playwright',
  title,
  passed: playwright.passed && playwrightTests.get(title) === true,
});
const G = (source, title, passed) => ({ source, title, passed });

const engineRounds = 'ENGINE: two and four player matches enforce the exact six-round sequence and all-ready barrier';
const engineResources = 'ENGINE: resources, replacement-only building, and optional cannon costs are authoritative';
const engineDamage = 'ENGINE: direct fire penetration, material resistance, cumulative damage, and scoring are exact';
const engineFinalScore = 'ENGINE: final scoring preserves zero-house players and adds surviving-castle bonuses';
const architecture = 'ARCHITECTURE: local and Devvit runtimes share one server-authoritative engine';
const devvitBarrier = 'DEVVIT ROUTE: four concurrent identities match, wait at the lock barrier, and emit one resolution';
const devvitRecovery = 'DEVVIT ROUTE: interrupted final resolution recovers once, records once, and supports privacy deletion';
const redisJoins = 'Redis transactions retain simultaneous post-lobby joins';
const leaderboardReceipts = 'leaderboard receipts are concurrent-safe and players are keyed by user id';
const channelNames = 'Realtime channel names use only Reddit-supported characters';
const damageModel = 'authoritative damage model applies penetration, material resistance, and weighted scoring';
const twoLayout = 'two-player matches render exactly two side-by-side 5×5 territories';
const twoFull = 'two clients complete the full six-round duel with barrier, NPCs, scoring, and leaderboard';
const fourFull = 'four clients see all territories and complete the six-round direct-fire battle';
const snes = 'SNES presentation exposes pixel rendering, CRT scanlines, retro controls, and an accessible toggle';
const inlineMobile = 'inline Devvit launch screen fits phone portrait and short landscape without scrolling';
const mobileBattle = 'mobile battle keeps all territories visible and provides touch-sized build and aim controls';

const criteria = [
  {
    name: '6-Round State Machine',
    evidence: [V(engineRounds), P(twoFull), P(fourFull)],
  },
  {
    name: 'Turn-Based Multiplayer Sync',
    evidence: [V(engineRounds), V(redisJoins), V(devvitBarrier), P(twoFull), P(fourFull)],
  },
  {
    name: 'Resource Loadouts & Random Territory Spawns',
    evidence: [V(engineResources), P(twoLayout), P(fourFull)],
  },
  {
    name: 'Penetration, Damage & Scoring',
    evidence: [V(engineDamage), V(engineFinalScore), P(damageModel)],
  },
  {
    name: 'Autonomous Villagers & Soldiers',
    evidence: [P(twoFull), P(fourFull)],
  },
  {
    name: 'SNES Aesthetic',
    evidence: [P(snes)],
  },
  {
    name: '2/4-Player Shared-Map Matchmaking',
    evidence: [V(redisJoins), V(devvitBarrier), P(twoLayout), P(twoFull), P(fourFull)],
  },
  {
    name: 'Persistent Global Leaderboard',
    evidence: [V(leaderboardReceipts), V(devvitRecovery), P(twoFull), P(fourFull)],
  },
  {
    name: 'Code Architecture',
    evidence: [V(architecture), G('Build', 'TypeScript compilation', tsc.passed), G('Build', 'Vite production bundle', build.passed)],
  },
  {
    name: 'Playwright Multi-Client & Mobile Pass',
    evidence: [
      G('Playwright', 'Complete Playwright command', playwright.passed),
      P(twoFull),
      P(fourFull),
      P(inlineMobile),
      P(mobileBattle),
    ],
  },
].map((criterion) => ({
  ...criterion,
  passed: criterion.evidence.every((item) => item.passed),
}));

const score = criteria.filter((criterion) => criterion.passed).length;
const vitestPassed = vitestReport?.numPassedTests ?? 0;
const vitestTotal = vitestReport?.numTotalTests ?? 0;
const playwrightTotal = playwrightTests.size;
const playwrightPassed = [...playwrightTests.values()].filter(Boolean).length;
const commandRuns = [tsc, build, vitest, playwright, video];

const lines = [
  'CANNONS AND CASTLES — CRITERION-SPECIFIC HACKATHON EVALUATION',
  `Started: ${startedAt.toISOString()}`,
  `Finished: ${new Date().toISOString()}`,
  '',
  'COMMAND GATES',
  ...commandRuns.map((run) =>
    `[${run.passed ? 'PASS' : 'FAIL'}] ${run.label} (${(run.durationMs / 1000).toFixed(1)}s)`
  ),
  '',
  'RUBRIC',
];

for (const [index, criterion] of criteria.entries()) {
  lines.push(
    `[${criterion.passed ? 'PASS' : 'FAIL'}] ${index + 1}. ${criterion.name} — ${criterion.passed ? '1/1' : '0/1'}`,
  );
  for (const evidence of criterion.evidence) {
    lines.push(`  [${evidence.passed ? 'PASS' : 'FAIL'}] ${evidence.source}: ${evidence.title}`);
  }
}

lines.push(
  '',
  `FINAL AUTOMATED SCORE: ${score}/10`,
  '',
  'SUPPLEMENTAL RELEASE EVIDENCE',
  `[${vitest.passed ? 'PASS' : 'FAIL'}] Vitest assertions: ${vitestPassed}/${vitestTotal}`,
  `[${playwright.passed ? 'PASS' : 'FAIL'}] Playwright scenarios: ${playwrightPassed}/${playwrightTotal}`,
  `[${vitestTests.get(channelNames) === true ? 'PASS' : 'FAIL'}] Devvit-safe Realtime channel names`,
  `[${video.passed ? 'PASS' : 'FAIL'}] Devpost video: ${videoReport?.duration ?? '?'}s, ${videoReport?.width ?? '?'}x${videoReport?.height ?? '?'}, H.264=${videoReport?.codecs?.h264 ?? false}, AAC=${videoReport?.codecs?.aac ?? false}, audio decoded=${videoReport?.audioDecodedBytes ?? 0} bytes`,
  '',
  'MANUAL REDDIT LAUNCH GATES — NOT CLAIMED BY LOCAL AUTOMATION',
  '[PENDING] Complete npm run dev playtest on actual Reddit desktop and mobile clients.',
  '[PENDING] Complete developer, moderator, and regular-user account matrix on the same battle post.',
  '[PENDING] Collect and record early feedback from r/Devvit, r/GamesOnReddit, or Reddit Developers Discord.',
  '[HOLD] Do not publish another version while Devvit 0.0.4 review is pending.',
  '',
  `LAUNCH DECISION: ${score === 10 && commandRuns.every((run) => run.passed) ? 'AUTOMATED 10/10; HOLD FOR MANUAL REDDIT GATES AND REVIEW' : 'NOT READY'}`,
);

const failures = commandRuns.filter((run) => !run.passed);
if (failures.length) {
  lines.push('', 'FAILURE OUTPUT');
  for (const run of failures) {
    lines.push(
      '',
      `--- ${run.label} ---`,
      run.stdout.trim() || '(no stdout)',
      run.stderr.trim() || '(no stderr)',
      run.error.trim() || '(no process error)',
    );
  }
}

const log = `${lines.join('\n')}\n`;
fs.writeFileSync(logFile, log);
fs.writeFileSync(outputLogFile, log);
process.stdout.write(`${log}\n`);

const automatedPassed = score === 10 && commandRuns.every((run) => run.passed);
process.exit(automatedPassed ? 0 : 1);
