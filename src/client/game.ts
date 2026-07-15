import * as Phaser from 'phaser';
import { DevvitSocket } from './transport/devvit-socket';

async function loadGameShell(): Promise<void> {
  const response = await fetch('/index.html', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load the game shell.');
  const source = await response.text();
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  document.body.innerHTML = parsed.body.innerHTML;
}

async function loadLegacyController(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/castle-controller.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the Phaser controller.'));
    document.body.append(script);
  });
}

async function start(): Promise<void> {
  await loadGameShell();
  const socket = new DevvitSocket();
  Object.defineProperty(globalThis, 'Phaser', { value: Phaser, configurable: true });
  Object.defineProperty(globalThis, 'io', {
    value: () => socket,
    configurable: true,
  });
  await loadLegacyController();
}

void start().catch((error: unknown) => {
  console.error('Failed to start Cannons and Castles:', error);
  document.body.innerHTML =
    '<main class="devvit-loading">THE WAR ROOM FAILED TO OPEN. RELOAD THE REDDIT POST.</main>';
});
