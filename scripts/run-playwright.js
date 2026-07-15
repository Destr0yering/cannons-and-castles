const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempDir = path.join(root, 'work', 'playwright-temp');
const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
fs.mkdirSync(tempDir, { recursive: true });

const run = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TEMP: tempDir, TMP: tempDir },
});

if (run.error) {
  console.error(run.error);
  process.exit(1);
}
process.exit(run.status ?? 1);
