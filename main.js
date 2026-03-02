const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const connEl = document.getElementById('conn');
const scoreEl = document.getElementById('score');
const massEl = document.getElementById('mass');
const overlayEl = document.getElementById('overlay');
const leadersEl = document.getElementById('leaders');

let state = null;
let myId = null;
let connected = false;

const input = { x: 0, y: 0 };
const keys = { splitReady: true, ejectReady: true };
let dpr = 1;

function wsUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

const ws = new WebSocket(wsUrl());

ws.addEventListener('open', () => {
  connected = true;
  connEl.textContent = '연결됨';
  overlayEl.classList.add('hidden');
});

ws.addEventListener('close', () => {
  connected = false;
  connEl.textContent = '연결 끊김';
  overlayEl.textContent = '서버 연결이 끊어졌습니다. 새로고침 해주세요.';
  overlayEl.classList.remove('hidden');
});

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== 'state') return;
  state = msg;
  myId = msg.you;
  updateHud();
  updateLeaders();
});

function sendInput() {
  if (!connected || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'input', x: input.x, y: input.y }));
}

function sendAction(key) {
  if (!connected || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'action', key }));
}

function findMe() {
  if (!state) return null;
  return state.players.find((p) => p.id === myId) || null;
}

function centerOf(cells) {
  if (!cells || cells.length === 0) return { x: 0, y: 0 };
  const sum = cells.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
  return { x: sum.x / cells.length, y: sum.y / cells.length };
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(window.devicePixelRatio || 1, 1.25);
  const w = Math.max(900, Math.floor(rect.width * dpr));
  const h = Math.max(520, Math.floor((rect.width * 0.57) * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function worldToScreen(x, y, camera) {
  return { x: x - camera.x, y: y - camera.y };
}

function drawGrid(camera) {
  const size = 60;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;

  const startX = -((camera.x % size) + size) % size;
  const startY = -((camera.y % size) + size) % size;

  for (let x = startX; x < canvas.width; x += size) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = startY; y < canvas.height; y += size) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawBorder(camera) {
  const topLeft = worldToScreen(0, 0, camera);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 3;
  ctx.strokeRect(topLeft.x, topLeft.y, state.world.width, state.world.height);
}

function drawFoods(camera) {
  for (const f of state.foods) {
    const p = worldToScreen(f.x, f.y, camera);
    if (p.x < -10 || p.y < -10 || p.x > canvas.width + 10 || p.y > canvas.height + 10) continue;

    ctx.beginPath();
    ctx.fillStyle = f.color;
    ctx.arc(p.x, p.y, f.r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const b of state.bonusOrbs) {
    const p = worldToScreen(b.x, b.y, camera);
    if (p.x < -20 || p.y < -20 || p.x > canvas.width + 20 || p.y > canvas.height + 20) continue;

    ctx.beginPath();
    ctx.fillStyle = b.color;
    ctx.arc(p.x, p.y, b.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawCell(cell, actor, camera, isMe) {
  const p = worldToScreen(cell.x, cell.y, camera);

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(cell.sx || 1, cell.sy || 1);

  ctx.beginPath();
  ctx.fillStyle = actor.color;
  ctx.arc(0, 0, cell.r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = isMe ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.3)';
  ctx.lineWidth = isMe ? 2 : 1.1;
  ctx.stroke();

  ctx.restore();

  if (cell.r > 16) {
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.textAlign = 'center';
    ctx.font = `600 ${Math.min(cell.r * 0.52, 15)}px sans-serif`;
    ctx.fillText(actor.name, p.x, p.y + 4);
  }
}

function updateHud() {
  const me = findMe();
  if (!me) return;

  const totalMass = me.cells.reduce((sum, c) => sum + c.mass, 0);
  scoreEl.textContent = String(Math.floor(me.score));
  massEl.textContent = String(Math.floor(totalMass));
}

function updateLeaders() {
  if (!state) return;

  const sorted = state.leaders || [];

  leadersEl.innerHTML = '';
  for (const p of sorted) {
    const li = document.createElement('li');
    li.textContent = `${p.name}: ${Math.floor(p.score)}`;
    if (p.id === myId) li.style.color = '#6df4d0';
    leadersEl.appendChild(li);
  }
}

function frame() {
  requestAnimationFrame(frame);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!state) return;
  const me = findMe();
  if (!me) return;

  const center = centerOf(me.cells);
  const camera = {
    x: center.x - canvas.width / 2,
    y: center.y - canvas.height / 2,
  };

  drawGrid(camera);
  drawBorder(camera);
  drawFoods(camera);

  for (const actor of state.players) {
    for (const cell of actor.cells) {
      const p = worldToScreen(cell.x, cell.y, camera);
      if (p.x < -cell.r - 20 || p.y < -cell.r - 20 || p.x > canvas.width + cell.r + 20 || p.y > canvas.height + cell.r + 20) {
        continue;
      }
      drawCell(cell, actor, camera, actor.id === myId);
    }
  }
}

canvas.addEventListener('mousemove', (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left - rect.width / 2;
  const y = event.clientY - rect.top - rect.height / 2;
  const len = Math.hypot(x, y) || 1;

  input.x = x / len;
  input.y = y / len;
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && keys.splitReady) {
    sendAction('split');
    keys.splitReady = false;
  }

  if (event.code === 'KeyQ' && keys.ejectReady) {
    sendAction('eject');
    keys.ejectReady = false;
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') keys.splitReady = true;
  if (event.code === 'KeyQ') keys.ejectReady = true;
});

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

setInterval(sendInput, 75);
frame();
