// Shared by the local Socket.io harness and the Reddit Devvit transport.
(() => {
  'use strict';

  const SIZE = 5;
  const CANVAS_WIDTH = 960;
  const CANVAS_HEIGHT = 640;
  const socket = io({ transports: ['websocket', 'polling'] });
  const dom = {};
  const local = {
    state: null,
    currentRound: 0,
    selectedTool: 'wood',
    placements: new Map(),
    aims: new Map(),
    locked: false,
    scene: null,
    animationCounts: {
      'villager-water': 0,
      'soldier-hammer': 0,
      'cannon-impact': 0,
    },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();

  function initialize() {
    cacheDom();
    createBuildOverlay();
    bindUi();
    initializePhaser();
    window.__gameDebug = {
      getState: () => local.state,
      getAims: () => [...local.aims.entries()].map(([key, angle]) => ({ key, angle, trace: traceForAim(key, angle) })),
      getPendingOrders: () => ({ placements: [...local.placements.values()], aims: [...local.aims.entries()] }),
      animations: local.animationCounts,
      socket,
    };
  }

  function cacheDom() {
    const ids = [
      'connection-status', 'scanline-toggle', 'lobby-screen', 'matchmaking-form', 'username',
      'queue-state', 'queue-count', 'leave-queue', 'lobby-error', 'lobby-leaderboard', 'game-shell',
      'match-code', 'round-heading', 'ready-counter', 'round-timeline', 'resolution-banner',
      'battle-callout', 'territory-labels', 'grid-overlay', 'commander-card', 'commander-name', 'commander-score',
      'orders-kicker', 'orders-title', 'order-count', 'resource-rack', 'resource-wood',
      'resource-brick', 'resource-steel', 'attack-orders', 'aim-controls', 'order-summary',
      'clear-orders', 'lock-turn', 'lock-feedback', 'player-scores', 'end-screen', 'winner-copy',
      'final-results', 'end-leaderboard', 'play-again', 'animation-events', 'open-mobile-build',
      'mobile-build-editor', 'mobile-build-grid', 'mobile-build-title', 'close-mobile-build',
      'privacy-controls', 'delete-leaderboard-entry', 'privacy-feedback',
    ];
    for (const id of ids) dom[id] = document.getElementById(id);
  }

  function bindUi() {
    dom['matchmaking-form'].addEventListener('submit', joinQueue);
    dom['leave-queue'].addEventListener('click', () => {
      socket.emit('leaveQueue');
      dom['matchmaking-form'].classList.remove('hidden');
      dom['queue-state'].classList.add('hidden');
    });
    dom['scanline-toggle'].addEventListener('click', () => {
      const off = document.body.classList.toggle('crt-off');
      dom['scanline-toggle'].textContent = off ? 'CRT: OFF' : 'CRT: ON';
      dom['scanline-toggle'].setAttribute('aria-pressed', String(!off));
    });
    dom['resource-rack'].addEventListener('click', (event) => {
      const button = event.target.closest('[data-tool]');
      if (!button || button.disabled || local.locked) return;
      local.selectedTool = button.dataset.tool;
      renderState();
    });
    dom['clear-orders'].addEventListener('click', () => {
      if (local.locked) return;
      local.placements.clear();
      if (local.state?.phase === 'attack') initializeAims(true);
      renderState();
    });
    dom['open-mobile-build'].addEventListener('click', openMobileBuildEditor);
    dom['close-mobile-build'].addEventListener('click', closeMobileBuildEditor);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !dom['mobile-build-editor'].classList.contains('hidden')) {
        closeMobileBuildEditor();
      }
    });
    dom['lock-turn'].addEventListener('click', lockTurn);
    dom['play-again'].addEventListener('click', () => window.location.reload());
    if (socket.transport === 'reddit-realtime') {
      dom['privacy-controls'].classList.remove('hidden');
      dom['delete-leaderboard-entry'].addEventListener('click', deleteLeaderboardEntry);
    }

    socket.on('connect', () => {
      dom['connection-status'].dataset.connected = 'true';
      dom['connection-status'].textContent = 'WAR ROOM ONLINE';
    });
    socket.on('disconnect', () => {
      dom['connection-status'].dataset.connected = 'false';
      dom['connection-status'].textContent = 'RECONNECTING…';
    });
    socket.on('leaderboard', (entries) => renderLeaderboard(dom['lobby-leaderboard'], entries));
    socket.on('queueStatus', ({ queued, desiredPlayers }) => {
      dom['queue-count'].textContent = `${queued} / ${desiredPlayers} commanders ready`;
    });
    socket.on('matchFound', ({ matchId }) => {
      dom['lobby-error'].textContent = '';
      dom['queue-count'].textContent = `Battle ${matchId.slice(0, 8)} found. Drawing borders…`;
    });
    socket.on('matchState', receiveMatchState);
    socket.on('phaseResolution', playResolution);
    socket.on('gameOver', showGameOver);
  }

  function joinQueue(event) {
    event.preventDefault();
    const data = new FormData(dom['matchmaking-form']);
    socket.emit('joinQueue', {
      username: String(data.get('username') || '').trim(),
      desiredPlayers: Number(data.get('desiredPlayers')),
    }, (result) => {
      if (!result?.ok) {
        dom['lobby-error'].textContent = result?.error || 'The war room could not join the queue.';
        return;
      }
      dom['lobby-error'].textContent = '';
      dom['matchmaking-form'].classList.add('hidden');
      dom['queue-state'].classList.remove('hidden');
    });
  }

  function deleteLeaderboardEntry() {
    if (!window.confirm('Remove your lifetime leaderboard score and battle totals? This cannot be undone.')) return;
    const button = dom['delete-leaderboard-entry'];
    button.disabled = true;
    dom['privacy-feedback'].textContent = 'REMOVING LEADERBOARD DATA…';
    socket.emit('deleteLeaderboardEntry', undefined, (result) => {
      button.disabled = false;
      if (!result?.ok) {
        dom['privacy-feedback'].textContent = result?.error || 'LEADERBOARD DATA COULD NOT BE REMOVED.';
        return;
      }
      renderLeaderboard(dom['lobby-leaderboard'], result.leaderboard || []);
      dom['privacy-feedback'].textContent = 'YOUR LEADERBOARD DATA HAS BEEN REMOVED.';
    });
  }

  function receiveMatchState(state) {
    const enteringMatch = dom['game-shell'].classList.contains('hidden');
    const roundChanged = state.round !== local.currentRound;
    local.state = state;
    local.currentRound = state.round;
    const self = getSelf();
    local.locked = Boolean(self?.ready || state.resolving);
    if (roundChanged) {
      local.placements.clear();
      local.selectedTool = 'wood';
      local.aims.clear();
      if (state.phase === 'attack') initializeAims(true);
    }
    dom['lobby-screen'].classList.add('hidden');
    dom['end-screen'].classList.add('hidden');
    dom['game-shell'].classList.remove('hidden');
    document.body.classList.add('battle-active');
    dom['resolution-banner'].classList.toggle('hidden', !state.resolving);
    renderState();
    if (enteringMatch) {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    }
  }

  function renderState() {
    const state = local.state;
    const self = getSelf();
    if (!state || !self) return;
    if (state.phase === 'attack' && !local.aims.size) initializeAims(true);

    dom['game-shell'].dataset.round = String(state.round);
    dom['game-shell'].dataset.phase = state.phase;
    dom['match-code'].textContent = state.id.slice(0, 8).toUpperCase();
    dom['round-heading'].textContent = `ROUND ${state.round} — ${state.roundName}`;
    dom['ready-counter'].querySelector('strong').textContent = `${state.readyCount} / ${state.totalPlayers}`;
    dom['commander-name'].textContent = self.username.toUpperCase();
    dom['commander-score'].textContent = `${self.damageScore} SIEGE PTS · ${self.housesSurviving}/4 CASTLES`;
    dom['commander-card'].style.setProperty('--player-color', self.color);
    dom['resource-wood'].textContent = self.resources.wood;
    dom['resource-brick'].textContent = self.resources.brick;
    dom['resource-steel'].textContent = self.resources.steel;

    renderTimeline();
    renderPhaseControls(self);
    renderBuildOverlay(self);
    renderTerritoryLabels();
    renderScores();
    renderToolSelection();
    if (local.scene) local.scene.renderMatch(state, local.placements, local.aims);
  }

  function renderTimeline() {
    dom['round-timeline'].innerHTML = local.state.timeline.map((item) => {
      const className = item.round < local.state.round ? 'done' : item.round === local.state.round ? 'active' : '';
      const shortName = item.round === 6 ? 'FINAL' : item.phase === 'attack' ? 'FIRE' : item.phase === 'rebuild' ? 'REBUILD' : 'BUILD';
      return `<li class="${className}" data-round="${item.round}" data-phase="${item.phase}"><span class="round-number">R${item.round}</span><span class="round-name">${escapeHtml(item.name)}</span><span class="round-short">${shortName}</span></li>`;
    }).join('');
  }

  function renderPhaseControls(self) {
    const isAttack = local.state.phase === 'attack';
    const isRebuild = local.state.phase === 'rebuild';
    dom['resource-rack'].classList.toggle('hidden', isAttack);
    dom['attack-orders'].classList.toggle('hidden', !isAttack);
    dom['open-mobile-build'].classList.toggle('hidden', isAttack);
    if (isAttack) closeMobileBuildEditor(false);
    dom['orders-kicker'].textContent = isAttack ? 'GUN CREW ORDER' : isRebuild ? 'REBUILD ORDER' : 'FORTIFY ORDER';
    dom['orders-title'].textContent = isAttack ? 'PIVOT EVERY CANNON' : isRebuild ? 'REPLACE OR EXTEND WALLS' : 'PLACE YOUR WALLS';
    dom['order-count'].textContent = isAttack ? `${local.aims.size} SHOTS` : `${local.placements.size} / 25`;
    dom['resource-rack'].querySelector('[data-tool="cannon"]').disabled = isRebuild || self.extraCannonBuilt;
    dom['resource-rack'].querySelector('[data-tool="cannon"]').classList.toggle('hidden', isRebuild || self.extraCannonBuilt);
    if (isAttack) renderAimControls();

    const feedback = self.ready
      ? `ORDERS SEALED — WAITING FOR ${local.state.totalPlayers - local.state.readyCount}`
      : local.state.resolving ? 'THE BATTLEFIELD IS RESOLVING…' : '';
    dom['lock-feedback'].textContent = feedback;
    dom['lock-turn'].disabled = local.locked;
    dom['clear-orders'].disabled = local.locked;
    dom['lock-turn'].querySelector('span').textContent = self.ready ? 'ORDERS LOCKED' : local.state.resolving ? 'RESOLVING…' : 'LOCK IN ORDERS';

    if (isAttack) {
      dom['battle-callout'].innerHTML = '<span class="callout-kicker">DIRECT FIRE ONLY</span><strong>Dotted guides stop at the first enemy object. Wood lets half the shot through.</strong>';
    } else if (isRebuild) {
      dom['battle-callout'].innerHTML = '<span class="callout-kicker">THE MASONS RETURN</span><strong>Damaged walls cannot be repaired. Replace destroyed walls or extend elsewhere.</strong>';
    } else {
      dom['battle-callout'].innerHTML = '<span class="callout-kicker">FORTIFY TWO FRONTS</span><strong>10 wood · 5 brick · 3 steel. An extra cannon costs all 3 steel.</strong>';
    }
  }

  function renderAimControls() {
    const self = getSelf();
    const cannons = findCannons(self);
    dom['aim-controls'].innerHTML = cannons.map((cannon, index) => {
      const key = `${cannon.x}:${cannon.y}`;
      const angle = local.aims.get(key) ?? 0;
      const trace = clientTrace(local.state, self, cannon, angle);
      const target = trace.first
        ? `${trace.first.player.username.toUpperCase()} · ${trace.first.cell.type.toUpperCase()}${trace.second ? ` → ${trace.second.cell.type.toUpperCase()}` : ''}`
        : 'NO ENEMY ON LINE';
      return `
        <div class="cannon-aim-row" data-cannon="${key}" data-hit="${trace.first ? trace.first.cell.type : 'miss'}">
          <strong>CANNON ${index + 1}<small class="${trace.first ? '' : 'miss'}" title="${escapeHtml(target)}">${escapeHtml(target)}</small></strong>
          <button type="button" class="aim-button" data-turn="-10" aria-label="Rotate cannon ${index + 1} left">‹</button>
          <span class="aim-angle">${String(angle).padStart(3, '0')}°</span>
          <button type="button" class="aim-button" data-turn="10" aria-label="Rotate cannon ${index + 1} right">›</button>
        </div>`;
    }).join('');
    for (const button of dom['aim-controls'].querySelectorAll('.aim-button')) {
      button.disabled = local.locked;
      button.addEventListener('click', () => {
        if (local.locked) return;
        const row = button.closest('.cannon-aim-row');
        const current = local.aims.get(row.dataset.cannon) || 0;
        local.aims.set(row.dataset.cannon, normalizeAngle(current + Number(button.dataset.turn)));
        renderState();
      });
    }
  }

  function initializeAims(force = false) {
    const self = getSelf();
    if (!self || (local.aims.size && !force)) return;
    local.aims.clear();
    for (const cannon of findCannons(self)) {
      let best = { angle: 0, score: Infinity };
      for (let angle = 0; angle < 360; angle += 10) {
        const trace = clientTrace(local.state, self, cannon, angle);
        if (!trace.first) continue;
        const priority = trace.first.cell.type === 'house' ? -8 : trace.first.cell.type === 'cannon' ? -4 : 0;
        const score = trace.first.distance + priority;
        if (score < best.score) best = { angle, score };
      }
      local.aims.set(`${cannon.x}:${cannon.y}`, best.angle);
    }
  }

  function traceForAim(key, angle) {
    const [x, y] = key.split(':').map(Number);
    return clientTrace(local.state, getSelf(), { x, y }, angle);
  }

  function createBuildOverlay() {
    createBuildGrid(dom['grid-overlay'], 'board-cell');
    createBuildGrid(dom['mobile-build-grid'], 'mobile-build-cell');
  }

  function createBuildGrid(container, className) {
    const fragment = document.createDocumentFragment();
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className;
        button.dataset.x = String(x);
        button.dataset.y = String(y);
        button.setAttribute('role', 'gridcell');
        button.addEventListener('click', () => queuePlacement(x, y));
        fragment.appendChild(button);
      }
    }
    container.appendChild(fragment);
  }

  function renderBuildOverlay(self) {
    const view = boardView(local.state.layout);
    const left = view.x + self.territory.col * SIZE * view.tile;
    const top = view.y + self.territory.row * SIZE * view.tile;
    Object.assign(dom['grid-overlay'].style, {
      left: `${left / CANVAS_WIDTH * 100}%`,
      top: `${top / CANVAS_HEIGHT * 100}%`,
      width: `${SIZE * view.tile / CANVAS_WIDTH * 100}%`,
      height: `${SIZE * view.tile / CANVAS_HEIGHT * 100}%`,
    });
    dom['grid-overlay'].classList.toggle('hidden', local.state.phase === 'attack');

    for (const button of document.querySelectorAll('.board-cell, .mobile-build-cell')) {
      const x = Number(button.dataset.x);
      const y = Number(button.dataset.y);
      const cell = self.grid[y][x];
      const pending = local.placements.get(`${x}:${y}`);
      button.dataset.structure = cell?.type || 'ground';
      button.dataset.pendingMaterial = pending?.type || '';
      button.classList.toggle('pending', Boolean(pending));
      button.disabled = local.locked || Boolean(cell);
      button.setAttribute('aria-label', `${cell?.type || 'open ground'} at column ${x + 1}, row ${y + 1}${pending ? `; pending ${pending.type}` : ''}`);
    }
  }

  function renderTerritoryLabels() {
    const view = boardView(local.state.layout);
    const territoryWidth = SIZE * view.tile;
    dom['territory-labels'].innerHTML = local.state.players.map((player, index) => {
      const left = (view.x + player.territory.col * territoryWidth + 6) / CANVAS_WIDTH * 100;
      const top = (view.y + player.territory.row * territoryWidth + 6) / CANVAS_HEIGHT * 100;
      const width = (territoryWidth - 12) / CANVAS_WIDTH * 100;
      const self = player.id === local.state.viewerId;
      const label = `${self ? 'YOU' : `P${index + 1}`} · ${player.housesSurviving} CASTLES`;
      return `<span class="${self ? 'self' : ''}" data-player-id="${player.id}" title="${escapeHtml(player.username)} · ${player.housesSurviving} castles" style="left:${left}%;top:${top}%;width:${width}%;--player-color:${player.color}">${label}</span>`;
    }).join('');
  }

  function openMobileBuildEditor() {
    if (local.state?.phase === 'attack') return;
    dom['mobile-build-editor'].classList.remove('hidden');
    dom['open-mobile-build'].setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-editor-open');
    dom['close-mobile-build'].focus();
  }

  function closeMobileBuildEditor(restoreFocus = true) {
    if (dom['mobile-build-editor'].classList.contains('hidden')) return;
    dom['mobile-build-editor'].classList.add('hidden');
    dom['open-mobile-build'].setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-editor-open');
    if (restoreFocus && !dom['open-mobile-build'].classList.contains('hidden')) dom['open-mobile-build'].focus();
  }

  function queuePlacement(x, y) {
    if (!local.state || local.state.phase === 'attack' || local.locked) return;
    const key = `${x}:${y}`;
    if (local.placements.has(key)) {
      local.placements.delete(key);
      renderState();
      return;
    }
    if (!hasResourcesFor(local.selectedTool)) return;
    local.placements.set(key, { x, y, type: local.selectedTool });
    renderState();
  }

  function hasResourcesFor(type) {
    const self = getSelf();
    if (!self) return false;
    if (type === 'cannon' && (self.extraCannonBuilt || [...local.placements.values()].some((item) => item.type === 'cannon'))) return false;
    const remaining = { ...self.resources };
    for (const placement of local.placements.values()) applyLocalCost(remaining, placement.type);
    const cost = type === 'cannon' ? { steel: 3 } : { [type]: 1 };
    return Object.entries(cost).every(([resource, amount]) => remaining[resource] >= amount);
  }

  function applyLocalCost(resources, type) {
    if (type === 'cannon') resources.steel -= 3;
    else if (resources[type] !== undefined) resources[type] -= 1;
  }

  function renderToolSelection() {
    for (const button of dom['resource-rack'].querySelectorAll('[data-tool]')) {
      button.classList.toggle('selected', button.dataset.tool === local.selectedTool);
    }
  }

  function renderScores() {
    dom['player-scores'].innerHTML = [...local.state.players]
      .sort((a, b) => b.damageScore - a.damageScore)
      .map((player) => `
        <div class="player-score" style="--player-color:${player.color}" data-player-id="${player.id}">
          <span>${escapeHtml(player.username)}${player.id === local.state.viewerId ? ' · YOU' : ''} · ${player.housesSurviving} CASTLES</span>
          <b>${player.damageScore}</b>
        </div>`).join('');
  }

  function lockTurn() {
    if (!local.state || local.locked) return;
    local.locked = true;
    dom['lock-turn'].disabled = true;
    dom['lock-feedback'].textContent = 'SEALING ORDERS…';
    const action = local.state.phase === 'attack'
      ? { shots: [...local.aims.entries()].map(([key, angle]) => {
        const [x, y] = key.split(':').map(Number);
        return { x, y, angle };
      }) }
      : { placements: [...local.placements.values()] };
    socket.emit('lockTurn', action, (result) => {
      if (result?.ok) return;
      local.locked = false;
      dom['lock-turn'].disabled = false;
      dom['lock-feedback'].textContent = result?.error || 'ORDERS REJECTED';
    });
  }

  function playResolution(resolution) {
    dom['resolution-banner'].classList.remove('hidden');
    dom['game-shell'].dataset.resolvingRound = String(resolution.round);
    local.locked = true;
    if (local.scene) local.scene.playResolution(resolution);
  }

  function showGameOver(payload) {
    local.state = payload.state;
    closeMobileBuildEditor(false);
    document.body.classList.remove('battle-active');
    dom['game-shell'].classList.add('hidden');
    dom['end-screen'].classList.remove('hidden');
    dom['end-screen'].dataset.gameOver = 'true';
    const winner = payload.results[0];
    dom['winner-copy'].textContent = `${winner.username} wins with ${winner.finalScore} points and ${winner.housesSurviving} castles standing.`;
    dom['final-results'].innerHTML = payload.results.map((result) => `
      <div class="final-result ${result.winner ? 'winner' : ''}" data-rank="${result.rank}">
        <span class="rank">#${result.rank}</span>
        <strong>${escapeHtml(result.username)}</strong>
        <span>${result.damageScore} SIEGE</span>
        <span>${result.housesSurviving} CASTLES · +${result.survivalBonus}</span>
        <b>${result.finalScore} PTS</b>
      </div>`).join('');
    renderLeaderboard(dom['end-leaderboard'], payload.leaderboard);
    window.scrollTo(0, 0);
  }

  function renderLeaderboard(container, entries = []) {
    if (!entries.length) {
      container.innerHTML = '<li class="empty-row">NO BATTLES RECORDED — YET.</li>';
      return;
    }
    container.innerHTML = entries.slice(0, 8).map((entry) => `
      <li><span>${escapeHtml(entry.username)}</span><b>${entry.lifetimeDamage} DMG</b></li>`).join('');
  }

  function recordAnimation(name) {
    local.animationCounts[name] = (local.animationCounts[name] || 0) + 1;
    dom['game-shell'].dataset.lastAnimation = name;
    dom['game-shell'].setAttribute(`data-${name}-count`, String(local.animationCounts[name]));
    const event = document.createElement('span');
    event.dataset.animation = name;
    event.textContent = `${name}:${local.animationCounts[name]}`;
    dom['animation-events'].appendChild(event);
  }

  function getSelf() {
    return local.state?.players.find((player) => player.id === local.state.viewerId);
  }

  function findCannons(player) {
    const cannons = [];
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (player.grid[y][x]?.type === 'cannon' && player.grid[y][x].hp > 0) cannons.push({ x, y });
      }
    }
    return cannons;
  }

  function normalizeAngle(value) {
    return ((Math.round(value / 10) * 10) % 360 + 360) % 360;
  }

  function areNeighbors(first, second) {
    return first.id !== second.id && Math.abs(first.territory.col - second.territory.col) + Math.abs(first.territory.row - second.territory.row) === 1;
  }

  function rayBoxDistance(origin, direction, minX, minY, maxX, maxY) {
    let near = -Infinity;
    let far = Infinity;
    for (const [originValue, directionValue, minimum, maximum] of [
      [origin.x, direction.x, minX, maxX], [origin.y, direction.y, minY, maxY],
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
    return far <= 0.001 ? null : Math.max(near, 0.001);
  }

  function clientTrace(state, attacker, cannon, angle) {
    if (!state || !attacker) return { first: null, second: null, origin: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
    const origin = {
      x: attacker.territory.col * SIZE + cannon.x + 0.5,
      y: attacker.territory.row * SIZE + cannon.y + 0.5,
    };
    const radians = normalizeAngle(angle) * Math.PI / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const hits = [];
    for (const player of state.players) {
      if (!areNeighbors(attacker, player)) continue;
      for (let y = 0; y < SIZE; y += 1) {
        for (let x = 0; x < SIZE; x += 1) {
          const cell = player.grid[y][x];
          if (!cell) continue;
          const worldX = player.territory.col * SIZE + x;
          const worldY = player.territory.row * SIZE + y;
          const distance = rayBoxDistance(origin, direction, worldX, worldY, worldX + 1, worldY + 1);
          if (distance !== null) hits.push({ distance, player, cell, x, y, worldX, worldY });
        }
      }
    }
    hits.sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id) || a.y - b.y || a.x - b.x);
    const first = hits[0] || null;
    const second = first?.cell.type === 'wood' ? hits[1] || null : null;
    let end;
    if (first) {
      end = { x: origin.x + direction.x * first.distance, y: origin.y + direction.y * first.distance };
    } else {
      const bounds = [];
      if (direction.x > 0) bounds.push((state.layout.worldWidth - origin.x) / direction.x);
      if (direction.x < 0) bounds.push((0 - origin.x) / direction.x);
      if (direction.y > 0) bounds.push((state.layout.worldHeight - origin.y) / direction.y);
      if (direction.y < 0) bounds.push((0 - origin.y) / direction.y);
      const distance = Math.min(...bounds.filter((value) => value > 0));
      end = { x: origin.x + direction.x * distance, y: origin.y + direction.y * distance };
    }
    return { first, second, origin, end, angle: normalizeAngle(angle) };
  }

  function boardView(layout) {
    if (layout.rows === 1) return { x: 110, y: 150, tile: 74 };
    return { x: 200, y: 40, tile: 56 };
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }

  function initializePhaser() {
    class SharedBattlefieldScene extends Phaser.Scene {
      constructor() {
        super({ key: 'SharedBattlefieldScene' });
        this.currentState = null;
        this.view = null;
        this.units = new Map();
      }

      create() {
        this.cameras.main.setBackgroundColor('#172432');
        this.baseLayer = this.add.graphics();
        this.worldLayer = this.add.container(0, 0);
        this.effectLayer = this.add.container(0, 0);
        local.scene = this;
        if (local.state) this.renderMatch(local.state, local.placements, local.aims);
      }

      renderMatch(state, pendingPlacements = new Map(), aims = new Map()) {
        this.currentState = state;
        this.view = boardView(state.layout);
        this.worldLayer.removeAll(true);
        this.units.clear();
        this.drawBackdrop();
        for (const player of state.players) this.drawTerritory(player, pendingPlacements, aims);
        if (state.phase === 'attack') this.drawAimGuides(aims);
      }

      drawBackdrop() {
        const g = this.baseLayer;
        g.clear();
        g.fillStyle(0x172432, 1).fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        g.fillStyle(0x35445b, 1).fillRect(0, 0, CANVAS_WIDTH, 90);
        g.fillStyle(0x4e5b71, 1).fillTriangle(0, 90, 170, 20, 340, 90);
        g.fillTriangle(260, 90, 470, 35, 680, 90);
        g.fillTriangle(590, 90, 770, 12, 960, 90);
        g.fillStyle(0xffd35a, 1).fillCircle(875, 42, 19);
        g.fillStyle(0x20344a, 1).fillRect(0, 560, CANVAS_WIDTH, 80);
        g.fillStyle(0x2d5364, 1);
        for (let x = 0; x < CANVAS_WIDTH; x += 32) g.fillRect(x, 578 + (x % 64 ? 5 : 0), 22, 4);
      }

      drawTerritory(player, pendingPlacements, aims) {
        const { tile, x: boardX, y: boardY } = this.view;
        const ox = boardX + player.territory.col * SIZE * tile;
        const oy = boardY + player.territory.row * SIZE * tile;
        const color = Phaser.Display.Color.HexStringToColor(player.color).color;
        const self = player.id === this.currentState.viewerId;
        const terrain = this.add.graphics();
        terrain.fillStyle(0x3b663c, 1).fillRect(ox, oy, SIZE * tile, SIZE * tile);
        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) {
            terrain.fillStyle((x + y) % 2 ? 0x56884a : 0x5d914e, 1).fillRect(ox + x * tile, oy + y * tile, tile, tile);
            terrain.lineStyle(1, 0x315c34, 0.6).strokeRect(ox + x * tile, oy + y * tile, tile, tile);
            terrain.fillStyle(0x376a37, 0.7).fillRect(ox + x * tile + tile * 0.15, oy + y * tile + tile * 0.72, 4, 3);
          }
        }
        terrain.lineStyle(self ? 7 : 5, self ? 0xfff4cf : color, 1).strokeRect(ox, oy, SIZE * tile, SIZE * tile);
        this.worldLayer.add(terrain);

        const namePlate = this.add.rectangle(ox + 7, oy + 7, Math.min(SIZE * tile - 14, 174), 24, 0x171622, 0.9).setOrigin(0);
        namePlate.setStrokeStyle(2, color);
        const label = this.add.text(ox + 16, oy + 12, `${player.username.toUpperCase()} · ${player.housesSurviving} CASTLES`, {
          fontFamily: 'Courier New', fontSize: `${Math.max(9, tile * 0.16)}px`, fontStyle: 'bold', color: player.color,
        });
        this.worldLayer.add([namePlate, label]);

        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) {
            const cell = player.grid[y][x];
            if (cell) this.drawStructure(player, x, y, cell, false, aims);
            if (self) {
              const pending = pendingPlacements.get(`${x}:${y}`);
              if (pending) this.drawStructure(player, x, y, { type: pending.type, hp: 100, maxHp: 100 }, true, aims);
            }
          }
        }
        this.createTerritoryUnits(player);
      }

      drawStructure(player, x, y, cell, pending, aims) {
        const { tile, x: boardX, y: boardY } = this.view;
        const px = boardX + (player.territory.col * SIZE + x) * tile;
        const py = boardY + (player.territory.row * SIZE + y) * tile;
        const c = this.add.container(px, py).setAlpha(pending ? 0.58 : 1);
        const g = this.add.graphics();
        const pad = tile * 0.12;
        const width = tile - pad * 2;

        if (cell.type === 'wood') {
          g.fillStyle(0x5c3426, 1).fillRect(pad, pad * 1.3, width, tile - pad * 1.8);
          g.fillStyle(0xc77c3d, 1);
          for (let index = 0; index < 4; index += 1) g.fillRect(pad + 3 + index * width / 4, pad, width / 5, tile - pad * 2);
          g.fillStyle(0x35211c, 1).fillRect(pad, tile * 0.45, width, tile * 0.1);
        } else if (cell.type === 'brick') {
          g.fillStyle(0x713e3a, 1).fillRect(pad, pad, width, width);
          g.fillStyle(0xb96858, 1);
          const bw = width * 0.42;
          g.fillRect(pad + 2, pad + 2, bw, width * 0.25).fillRect(pad + bw + 6, pad + 2, bw, width * 0.25);
          g.fillRect(pad + width * 0.22, pad + width * 0.34, bw, width * 0.25);
          g.fillRect(pad + 2, pad + width * 0.67, bw, width * 0.25).fillRect(pad + bw + 6, pad + width * 0.67, bw, width * 0.25);
        } else if (cell.type === 'steel') {
          g.fillStyle(0x2c3843, 1).fillRect(pad, pad, width, width);
          g.fillStyle(0x687f8e, 1).fillRect(pad + 3, pad + 3, width - 6, width - 6);
          g.fillStyle(0xa8bac1, 1).fillRect(pad + 6, pad + 6, width - 12, 5);
          g.fillStyle(0x28313a, 1);
          for (const [rx, ry] of [[0.22, 0.28], [0.75, 0.28], [0.22, 0.75], [0.75, 0.75]]) g.fillCircle(pad + width * rx, pad + width * ry, 3);
        } else if (cell.type === 'cannon') {
          g.fillStyle(0x8a542b, 1).fillRect(tile * 0.22, tile * 0.62, tile * 0.55, tile * 0.16);
          g.fillStyle(0x171622, 1).fillCircle(tile * 0.3, tile * 0.78, tile * 0.12).fillCircle(tile * 0.7, tile * 0.78, tile * 0.12);
          const angle = player.id === this.currentState.viewerId ? aims.get(`${x}:${y}`) || 0 : 0;
          const radians = angle * Math.PI / 180;
          g.lineStyle(Math.max(7, tile * 0.16), 0x30343d, 1);
          g.beginPath();
          g.moveTo(tile * 0.5, tile * 0.52);
          g.lineTo(tile * 0.5 + Math.cos(radians) * tile * 0.34, tile * 0.52 + Math.sin(radians) * tile * 0.34);
          g.strokePath();
          g.fillStyle(0x6c7780, 1).fillCircle(tile * 0.5, tile * 0.52, tile * 0.18);
        } else if (cell.type === 'house') {
          g.fillStyle(0x7b5033, 1).fillRect(tile * 0.18, tile * 0.35, tile * 0.64, tile * 0.5);
          g.fillStyle(0xe0bd68, 1).fillRect(tile * 0.22, tile * 0.4, tile * 0.56, tile * 0.41);
          g.fillStyle(0x9f3349, 1).fillTriangle(tile * 0.1, tile * 0.4, tile * 0.5, tile * 0.08, tile * 0.9, tile * 0.4);
          g.fillStyle(0xffd35a, 1).fillRect(tile * 0.3, tile * 0.48, tile * 0.14, tile * 0.16);
          g.fillStyle(0x4b3540, 1).fillRect(tile * 0.57, tile * 0.58, tile * 0.14, tile * 0.23);
        }
        c.add(g);
        if (!pending && cell.hp < cell.maxHp) {
          const hp = this.add.graphics();
          const ratio = cell.hp / cell.maxHp;
          hp.fillStyle(0x171622, 1).fillRect(tile * 0.12, tile * 0.04, tile * 0.76, 5);
          hp.fillStyle(ratio > 0.5 ? 0x55d6be : 0xe64f5f, 1).fillRect(tile * 0.14, tile * 0.055, tile * 0.72 * ratio, 3);
          c.add(hp);
        }
        this.worldLayer.add(c);
      }

      drawAimGuides(aims) {
        const self = this.currentState.players.find((player) => player.id === this.currentState.viewerId);
        if (!self) return;
        for (const cannon of findCannons(self)) {
          const key = `${cannon.x}:${cannon.y}`;
          const angle = aims.get(key) || 0;
          const trace = clientTrace(this.currentState, self, cannon, angle);
          const start = this.worldToPixel(trace.origin.x, trace.origin.y);
          const end = this.worldToPixel(trace.end.x, trace.end.y);
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const length = Math.hypot(dx, dy);
          const dots = Math.max(1, Math.floor(length / 13));
          const guide = this.add.graphics();
          const color = trace.first ? 0xffd35a : 0xe64f5f;
          for (let index = 1; index <= dots; index += 1) {
            const t = index / dots;
            guide.fillStyle(color, 0.9).fillCircle(start.x + dx * t, start.y + dy * t, index === dots ? 5 : 2.4);
          }
          this.worldLayer.add(guide);
        }
      }

      createTerritoryUnits(player) {
        const units = [];
        const open = [];
        for (let y = 0; y < SIZE; y += 1) {
          for (let x = 0; x < SIZE; x += 1) if (!player.grid[y][x]) open.push({ x, y });
        }
        const fallback = [{ x: 2, y: 2 }, { x: 1, y: 2 }];
        const spots = open.length >= 2 ? open : fallback;
        units.push(this.createUnit(player, 'villager', spots[0], -8));
        units.push(this.createUnit(player, 'soldier', spots[1] || spots[0], 8));
        this.units.set(player.id, units);
      }

      createUnit(player, kind, cell, offset) {
        const globalX = player.territory.col * SIZE + cell.x + 0.5;
        const globalY = player.territory.row * SIZE + cell.y + 0.72;
        const position = this.worldToPixel(globalX, globalY);
        const scale = Math.max(0.7, this.view.tile / 60);
        const unit = this.add.container(position.x + offset, position.y).setScale(scale);
        const shadow = this.add.rectangle(0, 7, 15, 5, 0x171622, 0.35);
        const body = this.add.rectangle(0, 0, 10, 12, kind === 'villager' ? 0x55d6be : 0xe64f5f);
        const head = this.add.rectangle(0, -8, 7, 7, 0xe8b978);
        const hat = this.add.rectangle(0, -13, 11, 3, kind === 'villager' ? 0xd89b45 : 0xaeb8c0);
        const arm = this.add.rectangle(7, 0, 3, 9, kind === 'villager' ? 0xe8b978 : 0x9aa2a8);
        unit.add([shadow, body, head, hat, arm]);
        unit.setData({ kind, arm, playerId: player.id });
        this.worldLayer.add(unit);
        this.tweens.add({ targets: unit, y: unit.y - 2, duration: 430, yoyo: true, repeat: -1, ease: 'Stepped' });
        return unit;
      }

      worldToPixel(worldX, worldY) {
        return { x: this.view.x + worldX * this.view.tile, y: this.view.y + worldY * this.view.tile };
      }

      playResolution(resolution) {
        if (resolution.phase === 'attack') this.playAttackResolution(resolution);
        else this.playBuildResolution(resolution);
      }

      playAttackResolution(resolution) {
        const damaging = resolution.impacts.filter((impact) => !impact.miss && impact.damage > 0);
        if (damaging.length) recordAnimation('villager-water');
        const shots = resolution.impacts.filter((impact, index, all) =>
          index === all.findIndex((candidate) => candidate.attackerId === impact.attackerId && candidate.cannonX === impact.cannonX && candidate.cannonY === impact.cannonY),
        );
        shots.slice(0, 12).forEach((shot, index) => {
          this.time.delayedCall(index * 70, () => this.launchShot(shot));
        });
        if (!shots.length) this.flashReport('NO CANNONS SURVIVED', '#e64f5f');
      }

      launchShot(shot) {
        const start = this.worldToPixel(shot.origin.x, shot.origin.y);
        const end = this.worldToPixel(shot.end.x, shot.end.y);
        const ball = this.add.circle(start.x, start.y, 5, 0x171622).setStrokeStyle(2, 0xaeb8c0);
        this.effectLayer.add(ball);
        const travel = { t: 0 };
        this.tweens.add({
          targets: travel,
          t: 1,
          duration: 330,
          ease: 'Linear',
          onUpdate: () => {
            ball.x = Phaser.Math.Linear(start.x, end.x, travel.t);
            ball.y = Phaser.Math.Linear(start.y, end.y, travel.t);
          },
          onComplete: () => {
            ball.destroy();
            if (!shot.miss) this.createImpact(end.x, end.y, shot);
          },
        });
      }

      createImpact(x, y, impact) {
        recordAnimation('cannon-impact');
        this.cameras.main.shake(130, 0.009);
        const burst = this.add.graphics();
        burst.fillStyle(0xffd35a, 1).fillCircle(0, 0, 16);
        burst.fillStyle(0xe64f5f, 1).fillCircle(0, 0, 9);
        const blast = this.add.container(x, y, [burst]);
        this.effectLayer.add(blast);
        this.tweens.add({ targets: blast, alpha: 0, scale: 1.8, duration: 260, onComplete: () => blast.destroy() });
        const text = this.add.text(x, y - 16, `-${impact.damage}  +${impact.points}`, {
          fontFamily: 'Courier New', fontSize: '17px', fontStyle: 'bold', color: '#fff4cf', stroke: '#171622', strokeThickness: 5,
        }).setOrigin(0.5);
        this.effectLayer.add(text);
        this.tweens.add({ targets: text, y: y - 58, alpha: 0, duration: 680, onComplete: () => text.destroy() });
        this.createFire(x, y);
        this.dispatchUnit(impact.targetPlayerId, 'villager', x, y);
      }

      createFire(x, y) {
        const fire = this.add.container(x, y);
        const outer = this.add.rectangle(0, 0, 16, 23, 0xe64f5f);
        const inner = this.add.rectangle(2, 3, 7, 15, 0xffd35a);
        fire.add([outer, inner]);
        this.effectLayer.add(fire);
        this.tweens.add({ targets: [outer, inner], scaleY: 0.7, duration: 100, yoyo: true, repeat: 6, ease: 'Stepped' });
        this.tweens.add({ targets: fire, alpha: 0, delay: 700, duration: 260, onComplete: () => fire.destroy() });
      }

      playBuildResolution(resolution) {
        if (resolution.builds.length) recordAnimation('soldier-hammer');
        for (const build of resolution.builds.slice(0, 8)) {
          const player = this.currentState.players.find((candidate) => candidate.id === build.playerId);
          if (!player) continue;
          const target = this.worldToPixel(
            player.territory.col * SIZE + build.x + 0.5,
            player.territory.row * SIZE + build.y + 0.5,
          );
          this.dispatchUnit(build.playerId, 'soldier', target.x, target.y);
        }
      }

      dispatchUnit(playerId, kind, targetX, targetY) {
        const unit = (this.units.get(playerId) || []).find((candidate) => candidate.getData('kind') === kind);
        if (!unit) return;
        this.tweens.killTweensOf(unit);
        this.tweens.add({
          targets: unit,
          x: targetX - 12,
          y: targetY + 12,
          duration: 280,
          ease: 'Stepped',
          onComplete: () => {
            const arm = unit.getData('arm');
            this.tweens.add({ targets: arm, angle: -90, duration: 80, yoyo: true, repeat: 5, ease: 'Stepped' });
            if (kind === 'villager') {
              for (let i = 0; i < 3; i += 1) {
                this.time.delayedCall(i * 90, () => {
                  const drop = this.add.rectangle(unit.x + 8, unit.y - 4, 4, 4, 0x6faee8);
                  this.effectLayer.add(drop);
                  this.tweens.add({ targets: drop, x: targetX, y: targetY, duration: 160, onComplete: () => drop.destroy() });
                });
              }
            }
          },
        });
      }

      flashReport(message, color) {
        const report = this.add.text(480, 310, message, {
          fontFamily: 'Courier New', fontSize: '24px', fontStyle: 'bold', color,
          backgroundColor: '#171622', padding: { x: 18, y: 12 },
        }).setOrigin(0.5);
        this.effectLayer.add(report);
        this.tweens.add({ targets: report, alpha: 0, delay: 450, duration: 250, onComplete: () => report.destroy() });
      }
    }

    new Phaser.Game({
      type: Phaser.CANVAS,
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      parent: 'phaser-game',
      backgroundColor: '#172432',
      pixelArt: true,
      antialias: false,
      roundPixels: true,
      render: { antialias: false, pixelArt: true, roundPixels: true },
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [SharedBattlefieldScene],
      banner: false,
    });
  }
})();
