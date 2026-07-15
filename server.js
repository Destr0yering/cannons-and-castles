const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const {
  createMatch,
  finalResults,
  normalizeAction,
  publicMatch,
  resolveRound,
} = require('./server/game-engine');

const PORT = Number(process.env.PORT || 3000);
const TEST_MODE = process.argv.includes('--test') || process.env.NODE_ENV === 'test';
const RESOLUTION_MS = TEST_MODE ? 220 : 1450;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, '.data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: false },
  serveClient: true,
});

const queues = new Map([
  [2, []],
  [4, []],
]);
const matches = new Map();
let leaderboard = loadLeaderboard();

app.disable('x-powered-by');
app.use(express.json({ limit: '32kb' }));
app.use((request, response, next) => {
  response.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/vendor', express.static(path.join(ROOT, 'node_modules', 'phaser', 'dist')));
app.use(express.static(path.join(ROOT, 'public')));

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, matches: matches.size, queued: queueSummary() });
});

app.get('/api/leaderboard', (_request, response) => {
  response.json({ leaderboard: sortedLeaderboard() });
});

app.post('/api/test/reset', (_request, response) => {
  for (const queue of queues.values()) queue.length = 0;
  matches.clear();
  leaderboard = {};
  persistLeaderboard();
  response.json({ ok: true });
});

app.use((_request, response) => {
  response.sendFile(path.join(ROOT, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  socket.emit('leaderboard', sortedLeaderboard());

  socket.on('joinQueue', (payload = {}, acknowledge = () => {}) => {
    if (socket.data.matchId || socket.data.queuedFor) {
      acknowledge({ ok: false, error: 'Already queued or matched.' });
      return;
    }

    const desiredPlayers = Number(payload.desiredPlayers);
    const username = sanitizeUsername(payload.username);
    if (![2, 4].includes(desiredPlayers)) {
      acknowledge({ ok: false, error: 'Choose a two or four player battle.' });
      return;
    }
    if (!username) {
      acknowledge({ ok: false, error: 'Enter a commander name.' });
      return;
    }

    socket.data.queuedFor = desiredPlayers;
    socket.data.username = username;
    queues.get(desiredPlayers).push({ id: socket.id, username });
    acknowledge({ ok: true });
    emitQueueStatus(desiredPlayers);
    tryStartMatch(desiredPlayers);
  });

  socket.on('leaveQueue', () => removeFromQueue(socket));

  socket.on('lockTurn', (rawAction = {}, acknowledge = () => {}) => {
    const match = matches.get(socket.data.matchId);
    if (!match || match.status !== 'playing') {
      acknowledge({ ok: false, error: 'No active match.' });
      return;
    }
    if (match.resolving) {
      acknowledge({ ok: false, error: 'The battlefield is resolving.' });
      return;
    }
    if (match.ready.has(socket.id)) {
      acknowledge({ ok: false, error: 'Turn already locked.' });
      return;
    }

    const action = normalizeAction(match, socket.id, rawAction);
    if (!action) {
      acknowledge({ ok: false, error: 'Invalid action.' });
      return;
    }

    match.actions.set(socket.id, action);
    match.ready.add(socket.id);
    acknowledge({ ok: true, readyCount: match.ready.size, totalPlayers: match.players.length });
    emitMatchState(match);
    resolveIfReady(match);
  });

  socket.on('requestState', () => {
    const match = matches.get(socket.data.matchId);
    if (match) socket.emit('matchState', publicMatch(match, socket.id));
  });

  socket.on('disconnect', () => {
    removeFromQueue(socket);
    const match = matches.get(socket.data.matchId);
    if (!match || match.status === 'ended') return;
    const player = match.players.find((candidate) => candidate.id === socket.id);
    if (!player) return;
    player.connected = false;
    if (!match.resolving && !match.ready.has(socket.id)) {
      const emptyAction = match.phase === 'attack' ? { shots: [] } : { placements: [] };
      match.actions.set(socket.id, emptyAction);
      match.ready.add(socket.id);
    }
    emitMatchState(match);
    resolveIfReady(match);
  });
});

function tryStartMatch(desiredPlayers) {
  const queue = queues.get(desiredPlayers);
  while (queue.length >= desiredPlayers) {
    const entrants = queue.splice(0, desiredPlayers);
    const liveEntrants = entrants.filter((entrant) => io.sockets.sockets.has(entrant.id));
    if (liveEntrants.length !== desiredPlayers) {
      for (const entrant of liveEntrants) queue.unshift(entrant);
      continue;
    }

    const match = createMatch(crypto.randomUUID(), liveEntrants);
    matches.set(match.id, match);
    for (const entrant of liveEntrants) {
      const playerSocket = io.sockets.sockets.get(entrant.id);
      playerSocket.data.matchId = match.id;
      playerSocket.data.queuedFor = null;
      playerSocket.join(match.id);
      playerSocket.emit('matchFound', {
        matchId: match.id,
        players: match.players.map((player) => player.username),
      });
    }
    emitMatchState(match);
  }
  emitQueueStatus(desiredPlayers);
}

function resolveIfReady(match) {
  if (match.resolving || match.ready.size !== match.players.length) return;
  const resolution = resolveRound(match);
  if (!resolution) return;
  io.to(match.id).emit('phaseResolution', resolution);

  setTimeout(() => {
    if (resolution.gameOver) {
      finishMatch(match);
      return;
    }
    match.resolving = false;
    emitMatchState(match);
  }, RESOLUTION_MS);
}

function finishMatch(match) {
  if (match.status === 'ended') return;
  match.status = 'ended';
  match.resolving = false;
  const results = finalResults(match);

  for (const result of results) {
    const current = leaderboard[result.username] || {
      username: result.username,
      lifetimeDamage: 0,
      victories: 0,
      battles: 0,
    };
    current.lifetimeDamage += result.rawDamage;
    current.victories += result.winner ? 1 : 0;
    current.battles += 1;
    leaderboard[result.username] = current;
  }
  persistLeaderboard();

  for (const player of match.players) {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (!playerSocket) continue;
    playerSocket.emit('gameOver', {
      state: publicMatch(match, player.id),
      results,
      leaderboard: sortedLeaderboard(),
    });
  }
}

function emitMatchState(match) {
  for (const player of match.players) {
    const playerSocket = io.sockets.sockets.get(player.id);
    if (playerSocket) playerSocket.emit('matchState', publicMatch(match, player.id));
  }
}

function emitQueueStatus(desiredPlayers) {
  const queue = queues.get(desiredPlayers);
  const status = { desiredPlayers, queued: queue.length };
  for (const entrant of queue) io.to(entrant.id).emit('queueStatus', status);
}

function removeFromQueue(socket) {
  const desiredPlayers = socket.data.queuedFor;
  if (!desiredPlayers || !queues.has(desiredPlayers)) return;
  const queue = queues.get(desiredPlayers);
  const index = queue.findIndex((entrant) => entrant.id === socket.id);
  if (index >= 0) queue.splice(index, 1);
  socket.data.queuedFor = null;
  emitQueueStatus(desiredPlayers);
}

function sanitizeUsername(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9_\- ]/g, '')
    .trim()
    .slice(0, 20);
}

function queueSummary() {
  return Object.fromEntries([...queues.entries()].map(([size, queue]) => [size, queue.length]));
}

function sortedLeaderboard() {
  return Object.values(leaderboard)
    .sort((a, b) => b.lifetimeDamage - a.lifetimeDamage || b.victories - a.victories)
    .slice(0, 20)
    .map((entry, index) => ({ rank: index + 1, ...entry }));
}

function loadLeaderboard() {
  try {
    return JSON.parse(fs.readFileSync(LEADERBOARD_FILE, 'utf8'));
  } catch (_error) {
    return {};
  }
}

function persistLeaderboard() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporaryFile = `${LEADERBOARD_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, JSON.stringify(leaderboard, null, 2));
  fs.renameSync(temporaryFile, LEADERBOARD_FILE);
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Cannons and Castles is ready at http://127.0.0.1:${PORT}`);
});

module.exports = { app, io, server };
