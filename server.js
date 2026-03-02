const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const WORLD = { width: 5600, height: 3600 };
const FOOD_COUNT = 520;
const BOT_COUNT = 12;
const TICK_MS = 1000 / 60;
const SNAPSHOT_MS = 1000 / 20;
const MAX_PLAYER_CELLS = 16;

const FOOD_COLORS = ['#ffd166', '#ff8c69', '#59d4c8', '#7ca8ff', '#ff7bb8'];

const players = new Map();
const bots = new Map();
const socketToPlayer = new Map();
let foods = [];
let bonusOrbs = [];
let nextCellId = 1;

function rand(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function makeFood() {
  return {
    id: crypto.randomUUID(),
    x: rand(0, WORLD.width),
    y: rand(0, WORLD.height),
    r: rand(2.3, 4.5),
    mass: rand(0.8, 1.4),
    color: FOOD_COLORS[Math.floor(Math.random() * FOOD_COLORS.length)],
  };
}

function updateRadius(cell) {
  cell.r = Math.sqrt(cell.mass) * 2;
}

function makeCell(ownerId, x, y, mass, color) {
  const cell = {
    id: nextCellId += 1,
    ownerId,
    x,
    y,
    vx: 0,
    vy: 0,
    mass,
    r: 0,
    color,
    canMergeAt: Date.now() + 1200,
    squashX: 1,
    squashY: 1,
  };
  updateRadius(cell);
  return cell;
}

function makeActor(id, name, color, isBot = false) {
  const x = rand(300, WORLD.width - 300);
  const y = rand(300, WORLD.height - 300);
  return {
    id,
    name,
    color,
    isBot,
    score: 0,
    input: { x: 0, y: 0 },
    splitQueued: false,
    ejectQueued: false,
    cells: [makeCell(id, x, y, rand(36, 45), color)],
    aiCooldown: 0,
  };
}

function initWorld() {
  foods = Array.from({ length: FOOD_COUNT }, makeFood);
  bonusOrbs = [];
  bots.clear();

  for (let i = 0; i < BOT_COUNT; i += 1) {
    const id = `bot-${i + 1}`;
    bots.set(id, makeActor(id, `BOT-${i + 1}`, `hsl(${Math.floor(rand(0, 360))} 85% 62%)`, true));
  }
}

function getAllActors() {
  return [...players.values(), ...bots.values()];
}

function getAllCells() {
  return getAllActors().flatMap((actor) => actor.cells.map((cell) => ({ actor, cell })));
}

function normalizeInput(input) {
  const m = Math.hypot(input.x, input.y);
  if (m <= 0.0001) return { x: 0, y: 0 };
  return { x: input.x / m, y: input.y / m };
}

function applyWall(cell) {
  let hitX = false;
  let hitY = false;

  if (cell.x - cell.r < 0) {
    cell.x = cell.r;
    cell.vx = Math.abs(cell.vx) * 0.33;
    hitX = true;
  }
  if (cell.x + cell.r > WORLD.width) {
    cell.x = WORLD.width - cell.r;
    cell.vx = -Math.abs(cell.vx) * 0.33;
    hitX = true;
  }
  if (cell.y - cell.r < 0) {
    cell.y = cell.r;
    cell.vy = Math.abs(cell.vy) * 0.33;
    hitY = true;
  }
  if (cell.y + cell.r > WORLD.height) {
    cell.y = WORLD.height - cell.r;
    cell.vy = -Math.abs(cell.vy) * 0.33;
    hitY = true;
  }

  if (hitX) {
    cell.squashX = 1.22;
    cell.squashY = 0.82;
  }
  if (hitY) {
    cell.squashX = 0.82;
    cell.squashY = 1.22;
  }

  cell.squashX += (1 - cell.squashX) * 0.15;
  cell.squashY += (1 - cell.squashY) * 0.15;
}

function moveCell(actor, cell, dt) {
  const input = normalizeInput(actor.input);
  const maxSpeed = clamp(255 / Math.pow(cell.mass, 0.22), 20, 210);
  const accel = 730 / Math.pow(cell.mass, 0.18);

  cell.vx += input.x * accel * dt;
  cell.vy += input.y * accel * dt;

  const speed = Math.hypot(cell.vx, cell.vy);
  if (speed > maxSpeed) {
    const f = maxSpeed / speed;
    cell.vx *= f;
    cell.vy *= f;
  }

  cell.vx *= 0.9;
  cell.vy *= 0.9;

  cell.x += cell.vx * dt;
  cell.y += cell.vy * dt;

  applyWall(cell);
}

function trySplit(actor) {
  if (!actor.splitQueued) return;
  actor.splitQueued = false;

  if (actor.cells.length >= MAX_PLAYER_CELLS) return;

  const input = normalizeInput(actor.input);
  const dir = input.x === 0 && input.y === 0 ? { x: 1, y: 0 } : input;

  const newCells = [];
  for (const cell of actor.cells) {
    if (cell.mass < 28 || actor.cells.length + newCells.length >= MAX_PLAYER_CELLS) continue;

    const childMass = cell.mass / 2;
    cell.mass = childMass;
    updateRadius(cell);

    const launch = clamp(420 / Math.pow(childMass, 0.15), 210, 520);
    const child = makeCell(
      actor.id,
      cell.x + dir.x * (cell.r + 4),
      cell.y + dir.y * (cell.r + 4),
      childMass,
      actor.color,
    );
    child.vx = dir.x * launch;
    child.vy = dir.y * launch;
    child.canMergeAt = Date.now() + 5500;
    cell.canMergeAt = Date.now() + 5500;
    newCells.push(child);
  }

  actor.cells.push(...newCells);
}

function tryEject(actor) {
  if (!actor.ejectQueued) return;
  actor.ejectQueued = false;

  if (actor.score < 10) return;
  const source = actor.cells.reduce((best, c) => (c.mass > best.mass ? c : best), actor.cells[0]);
  if (!source || source.mass < 16) return;

  actor.score -= 10;
  source.mass = Math.max(10, source.mass - 3.5);
  updateRadius(source);

  const input = normalizeInput(actor.input);
  const dir = input.x === 0 && input.y === 0 ? { x: 1, y: 0 } : input;

  bonusOrbs.push({
    id: crypto.randomUUID(),
    x: clamp(source.x + dir.x * (source.r + 7), 0, WORLD.width),
    y: clamp(source.y + dir.y * (source.r + 7), 0, WORLD.height),
    vx: dir.x * 360,
    vy: dir.y * 360,
    r: 6,
    value: 5,
    massGain: 1.4,
    color: '#f7ff66',
    ownerId: actor.id,
    bornAt: Date.now(),
  });
}

function updateBonusOrbs(dt) {
  for (const orb of bonusOrbs) {
    orb.x += orb.vx * dt;
    orb.y += orb.vy * dt;
    orb.vx *= 0.94;
    orb.vy *= 0.94;

    if (orb.x - orb.r < 0 || orb.x + orb.r > WORLD.width) orb.vx *= -0.7;
    if (orb.y - orb.r < 0 || orb.y + orb.r > WORLD.height) orb.vy *= -0.7;

    orb.x = clamp(orb.x, orb.r, WORLD.width - orb.r);
    orb.y = clamp(orb.y, orb.r, WORLD.height - orb.r);
  }

  const now = Date.now();
  bonusOrbs = bonusOrbs.filter((o) => now - o.bornAt < 10000);
}

function botInput(actor, dt) {
  actor.aiCooldown -= dt;
  if (actor.aiCooldown > 0) return;

  actor.aiCooldown = rand(0.16, 0.38);

  const main = actor.cells[0];
  if (!main) return;

  let target = null;
  let targetDist = Infinity;

  for (const food of foods) {
    const d = Math.hypot(food.x - main.x, food.y - main.y);
    if (d < targetDist && d < 300) {
      target = food;
      targetDist = d;
    }
  }

  for (const other of getAllCells()) {
    if (other.actor.id === actor.id) continue;
    const d = dist(main, other.cell);

    if (other.cell.mass > main.mass * 1.1 && d < 340) {
      actor.input.x = main.x - other.cell.x;
      actor.input.y = main.y - other.cell.y;
      return;
    }

    if (main.mass > other.cell.mass * 1.35 && d < 260) {
      target = other.cell;
      targetDist = d;
    }
  }

  if (target) {
    actor.input.x = target.x - main.x;
    actor.input.y = target.y - main.y;
  } else {
    actor.input.x = rand(-1, 1);
    actor.input.y = rand(-1, 1);
  }

  if (main.mass > 72 && Math.random() < 0.04) actor.splitQueued = true;
  if (actor.score >= 10 && Math.random() < 0.02) actor.ejectQueued = true;
}

function absorbFoods() {
  const cells = getAllCells();

  for (const pair of cells) {
    const { actor, cell } = pair;

    for (let i = foods.length - 1; i >= 0; i -= 1) {
      const f = foods[i];
      if (Math.hypot(cell.x - f.x, cell.y - f.y) < cell.r) {
        cell.mass += f.mass;
        actor.score += 1;
        updateRadius(cell);
        foods[i] = makeFood();
      }
    }

    for (let i = bonusOrbs.length - 1; i >= 0; i -= 1) {
      const o = bonusOrbs[i];
      if (Math.hypot(cell.x - o.x, cell.y - o.y) < cell.r) {
        cell.mass += o.massGain;
        actor.score += o.value;
        updateRadius(cell);
        bonusOrbs.splice(i, 1);
      }
    }
  }
}

function canEat(big, small) {
  if (big.mass <= small.mass) return false;
  const diffRatio = (big.mass - small.mass) / big.mass;
  if (diffRatio <= 0.1) return false;
  return diffRatio >= 0.11;
}

function resolveCellEating() {
  const all = getAllCells();
  const removed = new Set();

  for (let i = 0; i < all.length; i += 1) {
    const a = all[i];
    if (removed.has(a.cell.id)) continue;

    for (let j = i + 1; j < all.length; j += 1) {
      const b = all[j];
      if (removed.has(b.cell.id)) continue;
      if (a.actor.id === b.actor.id) continue;

      const d = dist(a.cell, b.cell);
      if (d > Math.max(a.cell.r, b.cell.r) * 0.92) continue;

      if (canEat(a.cell, b.cell)) {
        a.cell.mass += b.cell.mass * 0.84;
        a.actor.score += Math.floor(b.cell.mass * 1.6);
        updateRadius(a.cell);
        removed.add(b.cell.id);
      } else if (canEat(b.cell, a.cell)) {
        b.cell.mass += a.cell.mass * 0.84;
        b.actor.score += Math.floor(a.cell.mass * 1.6);
        updateRadius(b.cell);
        removed.add(a.cell.id);
        break;
      }
    }
  }

  for (const actor of getAllActors()) {
    actor.cells = actor.cells.filter((c) => !removed.has(c.id));

    if (actor.cells.length === 0) {
      actor.score = Math.max(0, actor.score - 30);
      actor.cells = [
        makeCell(actor.id, rand(200, WORLD.width - 200), rand(200, WORLD.height - 200), 40, actor.color),
      ];
    }
  }
}

function keepPlayerCellsApart(actor) {
  for (let i = 0; i < actor.cells.length; i += 1) {
    const a = actor.cells[i];
    for (let j = i + 1; j < actor.cells.length; j += 1) {
      const b = actor.cells[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.0001;
      const minDist = a.r + b.r;

      if (d < minDist) {
        const overlap = (minDist - d) * 0.5;
        const nx = dx / d;
        const ny = dy / d;

        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
      }

      if (Date.now() > a.canMergeAt && Date.now() > b.canMergeAt) {
        if (d < Math.max(a.r, b.r) * 0.65) {
          a.mass += b.mass;
          updateRadius(a);
          actor.cells.splice(j, 1);
          j -= 1;
        }
      }
    }
  }
}

function tick(dt) {
  for (const actor of bots.values()) botInput(actor, dt);

  for (const actor of getAllActors()) {
    trySplit(actor);
    tryEject(actor);

    for (const cell of actor.cells) {
      moveCell(actor, cell, dt);
    }

    keepPlayerCellsApart(actor);
  }

  updateBonusOrbs(dt);
  absorbFoods();
  resolveCellEating();
}

function snapshotFor(id) {
  const actorList = getAllActors().map((a) => ({
    id: a.id,
    name: a.name,
    color: a.color,
    score: Math.floor(a.score),
    isBot: a.isBot,
    cells: a.cells.map((c) => ({
      id: c.id,
      x: c.x,
      y: c.y,
      r: c.r,
      mass: c.mass,
      sx: c.squashX,
      sy: c.squashY,
    })),
  }));

  return {
    type: 'state',
    you: id,
    world: WORLD,
    players: actorList,
    foods,
    bonusOrbs,
    ts: Date.now(),
  };
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

const server = http.createServer((req, res) => {
  let target = req.url === '/' ? '/index.html' : req.url;
  if (target.includes('..')) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  const filePath = path.join(ROOT, target);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const id = crypto.randomUUID();
  const color = `hsl(${Math.floor(rand(0, 360))} 86% 62%)`;
  players.set(id, makeActor(id, `P-${id.slice(0, 4)}`, color, false));
  socketToPlayer.set(ws, id);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const actor = players.get(id);
    if (!actor) return;

    if (msg.type === 'input') {
      actor.input.x = Number(msg.x) || 0;
      actor.input.y = Number(msg.y) || 0;
    }

    if (msg.type === 'action') {
      if (msg.key === 'split') actor.splitQueued = true;
      if (msg.key === 'eject') actor.ejectQueued = true;
    }

    if (msg.type === 'name') {
      actor.name = String(msg.name || '').slice(0, 14) || actor.name;
    }
  });

  ws.on('close', () => {
    players.delete(id);
    socketToPlayer.delete(ws);
  });
});

initWorld();

let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = clamp((now - lastTick) / 1000, 0.001, 0.033);
  lastTick = now;
  tick(dt);
}, TICK_MS);

setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== 1) continue;
    const you = socketToPlayer.get(client);
    if (!you || !players.has(you)) continue;
    client.send(JSON.stringify(snapshotFor(you)));
  }
}, SNAPSHOT_MS);

server.listen(PORT, () => {
  console.log(`Cell Arena server running on http://localhost:${PORT}`);
});
