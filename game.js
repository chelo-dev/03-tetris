'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#b0bec5', // N - gris (tuerca)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,8,8],[8,0,8],[8,8,8]],                  // N - tuerca (3x3 con hueco central)
];

const PIECE_COUNT = PIECES.length - 1;

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600]; // 0..3 líneas
const PERFECT_CLEAR_BONUS = 2000;
const B2B_MULT = 1.5;
const POPUP_LIFE = 1200;

// ---- Modo desafío: campaña de 5 niveles con objetivos y reglas propias ----
const CHALLENGES = [
  {
    id: 'sprint40',
    title: 'Sprint 40',
    goalText: '40 líneas en 2:00',
    goalLines: 40,
    timeLimit: 120000,
  },
  {
    id: 'garbage',
    title: 'Basura ascendente',
    goalText: 'Sobrevive 90 s con basura subiendo cada 10 s',
    goalTime: 90000,
    garbageEvery: 10000,
  },
  {
    id: 'preset',
    title: 'Terreno minado',
    goalText: '12 líneas con bloques pre-colocados',
    goalLines: 12,
    presetRows: 8,
  },
  {
    id: 'blind',
    title: 'A ciegas',
    goalText: '10 líneas: las piezas fijas se vuelven invisibles',
    goalLines: 10,
    hideLocked: true,
  },
  {
    id: 'inverted',
    title: 'Espejo',
    goalText: '20 líneas, rotación invertida desde el nivel 3',
    goalLines: 20,
    invertRotationFrom: 3,
  },
];
const PROGRESS_KEY = 'tetris-challenges';
const RECORDS_KEY = 'tetris-records';
const MAX_RECORDS = 5;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const comboEl = document.getElementById('combo');
const challengeHud = document.getElementById('challenge-hud');
const objectiveEl = document.getElementById('objective');
const timerEl = document.getElementById('timer');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const nextBtn = document.getElementById('next-btn');
const menuBtn = document.getElementById('menu-btn');
const menuEl = document.getElementById('menu');
const challengeListEl = document.getElementById('challenge-list');
const classicBtn = document.getElementById('classic-btn');
const themeSwitch = document.getElementById('theme-switch');
const curtain = document.getElementById('curtain');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const overlayRecords = document.getElementById('overlay-records');
const overlayRecordsList = document.getElementById('overlay-records-list');
const recordsListEl = document.getElementById('records-list');
const recordComboEl = document.getElementById('record-combo');
const recordLinesEl = document.getElementById('record-lines');
const resetRecordsBtn = document.getElementById('reset-records-btn');

const THEME_KEY = 'tetris-theme';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let combo, b2b, lastMoveRotation, popups, maxCombo;
let challenge, elapsed, garbageAccum, revealUntil;
let gridColor = '#22222e';
let accentColor = '#7aa2f7';
let pendingScore = null;
let lastHighlightId = null;
let resetArmTimeout = null;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * PIECE_COUNT) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function rotateCCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[cols - 1 - c][r] = shape[r][c];
  return result;
}

function tryRotate() {
  const inverted = challenge && challenge.invertRotationFrom && level >= challenge.invertRotationFrom;
  const rotated = inverted ? rotateCCW(current.shape) : rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveRotation = true;
      return;
    }
  }
}

function isTSpin() {
  if (current.type !== 3 || !lastMoveRotation) return false;
  const corners = [
    [current.x, current.y],
    [current.x + 2, current.y],
    [current.x, current.y + 2],
    [current.x + 2, current.y + 2],
  ];
  let occupied = 0;
  for (const [cx, cy] of corners) {
    if (cx < 0 || cx >= COLS || cy >= ROWS || (cy >= 0 && board[cy][cx])) occupied++;
  }
  return occupied >= 3;
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

function isBoardEmpty() {
  return board.every(row => row.every(v => v === 0));
}

function pushPopup(text) {
  popups.push({ text, life: POPUP_LIFE });
  canvas.classList.remove('combo-flash');
  void canvas.offsetWidth; // reinicia la animación si ya estaba corriendo
  canvas.classList.add('combo-flash');
}

function applyScore(cleared, tspin) {
  if (cleared === 0) {
    combo = 0;
    if (tspin) {
      score += Math.round(TSPIN_SCORES[0] * level);
      pushPopup('T-SPIN');
      updateHUD();
    }
    return;
  }

  let base = tspin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared];
  const difficult = tspin || cleared === 4;

  if (difficult && b2b) {
    base *= B2B_MULT;
    pushPopup('B2B');
  }

  combo++;
  if (combo > maxCombo) maxCombo = combo;
  if (combo >= 2) {
    base *= combo;
    pushPopup(`COMBO x${combo}`);
  }

  if (tspin) pushPopup('T-SPIN');

  if (isBoardEmpty()) {
    base += PERFECT_CLEAR_BONUS * level;
    pushPopup('PERFECT CLEAR');
  }

  b2b = difficult;

  score += Math.round(base * level);
  lines += cleared;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  updateHUD();

  if (challenge && challenge.goalLines && lines >= challenge.goalLines) {
    finishChallenge(true);
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveRotation = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tspin = isTSpin();
  merge();
  if (challenge && challenge.hideLocked) revealUntil = performance.now() + 600;
  const cleared = clearLines();
  applyScore(cleared, tspin);
  if (gameOver) return;
  lastMoveRotation = false;
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function updateChallengeTimerText() {
  if (!challenge) return;
  if (challenge.timeLimit) timerEl.textContent = formatTime(Math.max(0, challenge.timeLimit - elapsed));
  else if (challenge.goalTime) timerEl.textContent = formatTime(Math.max(0, challenge.goalTime - elapsed));
  else timerEl.textContent = '';
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = combo >= 2 ? `x${combo}` : '–';
  challengeHud.classList.toggle('hidden', !challenge);
  if (challenge) {
    objectiveEl.textContent = challenge.goalLines
      ? `${lines}/${challenge.goalLines} líneas`
      : `Sobrevive ${formatTime(challenge.goalTime)}`;
    updateChallengeTimerText();
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board (oculto en el desafío "A ciegas" salvo el destello tras cada pieza)
  const showLocked = !(challenge && challenge.hideLocked) || performance.now() <= revealUntil;
  if (showLocked) {
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++)
        drawBlock(ctx, c, r, board[r][c], BLOCK);
  }

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawPopups();
}

function drawPopups() {
  if (!popups.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 20px system-ui, sans-serif';
  const cx = canvas.width / 2;
  const baseY = canvas.height / 2;
  popups.forEach((p, i) => {
    const t = p.life / POPUP_LIFE;
    const rise = (1 - t) * 30;
    ctx.globalAlpha = Math.max(0, t);
    ctx.fillStyle = accentColor;
    ctx.fillText(p.text, cx, baseY + i * 26 - rise);
  });
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  if (challenge) { finishChallenge(false); return; }
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  nextBtn.classList.add('hidden');

  updateGlobalStats(lines, maxCombo);

  const qualifies = score > 0 && qualifiesForTop(score);
  if (qualifies) {
    pendingScore = { score, lines, combo: maxCombo };
    nameInput.value = '';
    nameEntry.classList.remove('hidden');
    setTimeout(() => nameInput.focus(), 50);
  } else {
    pendingScore = null;
    nameEntry.classList.add('hidden');
  }

  overlayRecords.classList.remove('hidden');
  renderRecordsInto(overlayRecordsList);
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nextBtn.classList.add('hidden');
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (popups.length) {
    popups.forEach(p => p.life -= dt);
    popups = popups.filter(p => p.life > 0);
  }
  updateChallenge(dt);
  if (gameOver) return;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
      if (gameOver) return;
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init(ch = null) {
  challenge = ch;
  board = challenge && challenge.presetRows ? buildPresetRows(challenge.presetRows) : createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  combo = 0;
  maxCombo = 0;
  b2b = false;
  lastMoveRotation = false;
  popups = [];
  elapsed = 0;
  garbageAccum = 0;
  revealUntil = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  menuEl.classList.add('hidden');
  nameEntry.classList.add('hidden');
  overlayRecords.classList.add('hidden');
  pendingScore = null;
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  const style = getComputedStyle(document.body);
  gridColor = style.getPropertyValue('--grid-color').trim();
  accentColor = style.getPropertyValue('--accent').trim();
  themeSwitch.checked = light;
  localStorage.setItem(THEME_KEY, light ? 'light' : 'dark');
}

function toggleTheme() {
  themeSwitch.disabled = true;
  curtain.classList.add('active');
  curtain.addEventListener('transitionend', function onCovered() {
    curtain.removeEventListener('transitionend', onCovered);
    applyTheme(!document.body.classList.contains('light'));
    requestAnimationFrame(() => curtain.classList.remove('active'));
    curtain.addEventListener('transitionend', function onRevealed() {
      curtain.removeEventListener('transitionend', onRevealed);
      themeSwitch.disabled = false;
    });
  });
}

// ---- Tabla de récords ----

function loadRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(RECORDS_KEY));
    return {
      scores: Array.isArray(data?.scores) ? data.scores : [],
      bestCombo: data?.bestCombo || 0,
      maxLines: data?.maxLines || 0,
    };
  } catch {
    return { scores: [], bestCombo: 0, maxLines: 0 };
  }
}

function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records));
  } catch {}
}

function qualifiesForTop(scoreValue) {
  const records = loadRecords();
  return records.scores.length < MAX_RECORDS || scoreValue > records.scores[records.scores.length - 1].score;
}

function updateGlobalStats(linesValue, comboValue) {
  const records = loadRecords();
  if (comboValue > records.bestCombo || linesValue > records.maxLines) {
    records.bestCombo = Math.max(records.bestCombo, comboValue);
    records.maxLines = Math.max(records.maxLines, linesValue);
    saveRecords(records);
  }
}

function addRecordScore(name, scoreValue, linesValue, comboValue) {
  const records = loadRecords();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  records.scores.push({ id, name, score: scoreValue, lines: linesValue, combo: comboValue });
  records.scores.sort((a, b) => b.score - a.score);
  records.scores = records.scores.slice(0, MAX_RECORDS);
  records.bestCombo = Math.max(records.bestCombo, comboValue);
  records.maxLines = Math.max(records.maxLines, linesValue);
  saveRecords(records);
  lastHighlightId = records.scores.some(r => r.id === id) ? id : null;
}

function renderRecordsInto(listEl) {
  const records = loadRecords();
  listEl.innerHTML = '';
  if (records.scores.length === 0) {
    const li = document.createElement('li');
    li.className = 'record-empty';
    li.textContent = 'Sin récords todavía';
    listEl.appendChild(li);
  } else {
    records.scores.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'record-row' + (r.id && r.id === lastHighlightId ? ' highlight' : '');
      const rank = document.createElement('span');
      rank.className = 'record-rank';
      rank.textContent = `${i + 1}.`;
      const name = document.createElement('span');
      name.className = 'record-name';
      name.textContent = r.name;
      const sc = document.createElement('span');
      sc.className = 'record-score';
      sc.textContent = r.score.toLocaleString();
      li.append(rank, name, sc);
      listEl.appendChild(li);
    });
  }
  recordComboEl.textContent = records.bestCombo >= 2 ? `x${records.bestCombo}` : '–';
  recordLinesEl.textContent = records.maxLines || '–';
}

function renderRecords() {
  renderRecordsInto(recordsListEl);
}

function saveNameEntry() {
  if (!pendingScore) return;
  const name = (nameInput.value || '').trim().toUpperCase().slice(0, 10) || 'AAA';
  addRecordScore(name, pendingScore.score, pendingScore.lines, pendingScore.combo);
  pendingScore = null;
  nameEntry.classList.add('hidden');
  renderRecordsInto(overlayRecordsList);
}

// ---- Modo desafío ----

function makeGarbageRow() {
  const row = new Array(COLS).fill(0);
  const gapCount = 1 + Math.floor(Math.random() * 2); // 1-2 huecos
  const gaps = new Set();
  while (gaps.size < gapCount) gaps.add(Math.floor(Math.random() * COLS));
  const type = 1 + Math.floor(Math.random() * PIECE_COUNT);
  for (let c = 0; c < COLS; c++) {
    if (!gaps.has(c)) row[c] = type;
  }
  return row;
}

function buildPresetRows(n) {
  const b = createBoard();
  for (let i = 0; i < n; i++) {
    b[ROWS - 1 - i] = makeGarbageRow();
  }
  return b;
}

function pushGarbage() {
  const overflow = board[0].some(v => v !== 0);
  board.shift();
  board.push(makeGarbageRow());
  if (overflow || collide(current.shape, current.x, current.y)) {
    finishChallenge(false);
  }
}

function updateChallenge(dt) {
  if (!challenge) return;
  elapsed += dt;
  updateChallengeTimerText();

  if (challenge.timeLimit && elapsed >= challenge.timeLimit) {
    finishChallenge(false);
    return;
  }
  if (challenge.goalTime && elapsed >= challenge.goalTime) {
    finishChallenge(true);
    return;
  }
  if (challenge.garbageEvery) {
    garbageAccum += dt;
    if (garbageAccum >= challenge.garbageEvery) {
      garbageAccum -= challenge.garbageEvery;
      pushGarbage();
    }
  }
}

function finishChallenge(won) {
  gameOver = true;
  cancelAnimationFrame(animId);
  if (won) saveProgress(challenge.id, { completed: true, lines, elapsed });
  overlayTitle.textContent = won ? '¡DESAFÍO SUPERADO!' : 'DESAFÍO FALLIDO';
  overlayScore.textContent = won
    ? `Líneas: ${lines} · Tiempo: ${formatTime(elapsed)}`
    : `Puntuación: ${score.toLocaleString()}`;
  const idx = CHALLENGES.indexOf(challenge);
  nextBtn.classList.toggle('hidden', !(won && idx >= 0 && idx < CHALLENGES.length - 1));
  overlay.classList.remove('hidden');
}

function loadProgress() {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProgress(id, stat) {
  const progress = loadProgress();
  progress[id] = stat;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {}
}

function renderMenu() {
  const progress = loadProgress();
  challengeListEl.innerHTML = '';
  CHALLENGES.forEach((ch, i) => {
    const prev = CHALLENGES[i - 1];
    const locked = prev && !progress[prev.id]?.completed;
    const done = !!progress[ch.id]?.completed;
    const card = document.createElement('div');
    card.className = 'challenge-card' + (locked ? ' locked' : '') + (done ? ' done' : '');
    const best = done && progress[ch.id].lines != null
      ? `<span class="card-best">Mejor: ${progress[ch.id].lines} líneas en ${formatTime(progress[ch.id].elapsed)}</span>`
      : '';
    card.innerHTML = `
      <span class="card-title">${i + 1}. ${ch.title}${done ? ' ✓' : ''}</span>
      <span class="card-goal">${ch.goalText}</span>
      ${best}
    `;
    if (!locked) card.addEventListener('click', () => init(ch));
    challengeListEl.appendChild(card);
  });
}

function openMenu() {
  cancelAnimationFrame(animId);
  overlay.classList.add('hidden');
  renderMenu();
  renderRecords();
  menuEl.classList.remove('hidden');
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light');
  themeSwitch.addEventListener('change', toggleTheme);
}

document.addEventListener('keydown', e => {
  if (!menuEl.classList.contains('hidden')) return;
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastMoveRotation = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastMoveRotation = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => init(challenge));
nextBtn.addEventListener('click', () => {
  const idx = CHALLENGES.indexOf(challenge);
  init(CHALLENGES[idx + 1]);
});
menuBtn.addEventListener('click', openMenu);
classicBtn.addEventListener('click', () => init());

saveNameBtn.addEventListener('click', saveNameEntry);
nameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    saveNameEntry();
  }
});

resetRecordsBtn.addEventListener('click', () => {
  if (!resetRecordsBtn.classList.contains('armed')) {
    resetRecordsBtn.classList.add('armed');
    resetRecordsBtn.textContent = '¿Seguro? Confirmar';
    clearTimeout(resetArmTimeout);
    resetArmTimeout = setTimeout(() => {
      resetRecordsBtn.classList.remove('armed');
      resetRecordsBtn.textContent = 'Resetear récords';
    }, 3000);
    return;
  }
  clearTimeout(resetArmTimeout);
  resetRecordsBtn.classList.remove('armed');
  resetRecordsBtn.textContent = 'Resetear récords';
  saveRecords({ scores: [], bestCombo: 0, maxLines: 0 });
  lastHighlightId = null;
  renderRecords();
});

initTheme();
openMenu();
