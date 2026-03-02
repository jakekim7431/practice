const canvas = document.getElementById('arena');
const ctx = canvas.getContext('2d');

const scoreEl = document.getElementById('score');
const massEl = document.getElementById('mass');
const timeEl = document.getElementById('time');

const overlayEl = document.getElementById('overlay');
const gameOverEl = document.getElementById('gameOver');
const finalTextEl = document.getElementById('finalText');

const startBtn = document.getElementById('startBtn');
const restartBtn = document.getElementById('restartBtn');

const WORLD_WIDTH = 4200;
const WORLD_HEIGHT = 2800;
const FOOD_COUNT = 450;
const BOT_COUNT = 18;

const foodColors = ['#ffd166', '#f78c6b', '#4fd1c5', '#7aa2ff', '#ff7eb6'];

let mouse = { x: canvas.width / 2, y: canvas.height / 2 };
let running = false;
let startTime = 0;
let rafId = 0;

let player;
let foods;
let bots;

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function makeCell({ x, y, mass, color, name, isBot = false }) {
    return {
        x,
        y,
        mass,
        r: Math.sqrt(mass) * 2,
        color,
        name,
        isBot,
        vx: 0,
        vy: 0,
        aiTimer: 0,
        targetX: x,
        targetY: y,
    };
}

function updateRadius(cell) {
    cell.r = Math.sqrt(cell.mass) * 2;
}

function makeFood() {
    return {
        x: randomBetween(0, WORLD_WIDTH),
        y: randomBetween(0, WORLD_HEIGHT),
        r: randomBetween(2.6, 4.2),
        value: randomBetween(0.9, 1.6),
        color: foodColors[Math.floor(Math.random() * foodColors.length)],
    };
}

function resetGame() {
    player = makeCell({
        x: WORLD_WIDTH / 2,
        y: WORLD_HEIGHT / 2,
        mass: 40,
        color: '#47e0c6',
        name: 'YOU',
    });

    foods = Array.from({ length: FOOD_COUNT }, makeFood);

    bots = Array.from({ length: BOT_COUNT }, (_, i) =>
        makeCell({
            x: randomBetween(200, WORLD_WIDTH - 200),
            y: randomBetween(200, WORLD_HEIGHT - 200),
            mass: randomBetween(28, 95),
            color: `hsl(${Math.floor(randomBetween(0, 360))} 80% 60%)`,
            name: `BOT-${i + 1}`,
            isBot: true,
        }),
    );
}

function getCamera() {
    return {
        x: player.x - canvas.width / 2,
        y: player.y - canvas.height / 2,
    };
}

function worldToScreen(x, y, camera) {
    return { x: x - camera.x, y: y - camera.y };
}

function drawGrid(camera) {
    const gridSize = 55;
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;

    const startX = -((camera.x % gridSize) + gridSize) % gridSize;
    const startY = -((camera.y % gridSize) + gridSize) % gridSize;

    for (let x = startX; x < canvas.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }

    for (let y = startY; y < canvas.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function drawFood(camera) {
    for (const f of foods) {
        const p = worldToScreen(f.x, f.y, camera);
        if (p.x < -10 || p.y < -10 || p.x > canvas.width + 10 || p.y > canvas.height + 10) {
            continue;
        }
        ctx.beginPath();
        ctx.fillStyle = f.color;
        ctx.arc(p.x, p.y, f.r, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawCell(cell, camera) {
    const p = worldToScreen(cell.x, cell.y, camera);

    ctx.beginPath();
    ctx.fillStyle = cell.color;
    ctx.arc(p.x, p.y, cell.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    if (cell.r > 16) {
        ctx.fillStyle = 'rgba(255,255,255,0.95)';
        ctx.font = `600 ${Math.min(cell.r * 0.55, 16)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(cell.name, p.x, p.y + 4);
    }
}

function drawWorldBorder(camera) {
    const topLeft = worldToScreen(0, 0, camera);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 3;
    ctx.strokeRect(topLeft.x, topLeft.y, WORLD_WIDTH, WORLD_HEIGHT);
}

function updatePlayer(dt) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const dx = mouse.x - centerX;
    const dy = mouse.y - centerY;
    const dist = Math.hypot(dx, dy) || 1;

    const dirX = dx / dist;
    const dirY = dy / dist;

    const baseSpeed = 210;
    const speed = clamp(baseSpeed / Math.pow(player.mass, 0.22), 28, 180);
    const force = clamp(dist / 140, 0, 1);

    player.vx = dirX * speed * force;
    player.vy = dirY * speed * force;

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = clamp(player.x, player.r, WORLD_WIDTH - player.r);
    player.y = clamp(player.y, player.r, WORLD_HEIGHT - player.r);
}

function chooseBotTarget(bot) {
    const danger = player.mass > bot.mass * 1.17;
    const canHuntPlayer = bot.mass > player.mass * 1.17;

    if (danger) {
        const awayX = bot.x - player.x;
        const awayY = bot.y - player.y;
        const len = Math.hypot(awayX, awayY) || 1;
        bot.targetX = bot.x + (awayX / len) * 260;
        bot.targetY = bot.y + (awayY / len) * 260;
        return;
    }

    if (canHuntPlayer && Math.hypot(player.x - bot.x, player.y - bot.y) < 480) {
        bot.targetX = player.x;
        bot.targetY = player.y;
        return;
    }

    const nearbyFood = foods.find((f) => Math.hypot(f.x - bot.x, f.y - bot.y) < 250);
    if (nearbyFood) {
        bot.targetX = nearbyFood.x;
        bot.targetY = nearbyFood.y;
        return;
    }

    bot.targetX = clamp(bot.x + randomBetween(-280, 280), 0, WORLD_WIDTH);
    bot.targetY = clamp(bot.y + randomBetween(-280, 280), 0, WORLD_HEIGHT);
}

function updateBots(dt) {
    for (const bot of bots) {
        bot.aiTimer -= dt;
        if (bot.aiTimer <= 0) {
            chooseBotTarget(bot);
            bot.aiTimer = randomBetween(0.2, 0.65);
        }

        const dx = bot.targetX - bot.x;
        const dy = bot.targetY - bot.y;
        const dist = Math.hypot(dx, dy) || 1;

        const speed = clamp(185 / Math.pow(bot.mass, 0.22), 20, 150);
        bot.vx = (dx / dist) * speed;
        bot.vy = (dy / dist) * speed;

        bot.x += bot.vx * dt;
        bot.y += bot.vy * dt;

        bot.x = clamp(bot.x, bot.r, WORLD_WIDTH - bot.r);
        bot.y = clamp(bot.y, bot.r, WORLD_HEIGHT - bot.r);
    }
}

function absorbFood(cell) {
    for (let i = foods.length - 1; i >= 0; i -= 1) {
        const f = foods[i];
        const d = Math.hypot(cell.x - f.x, cell.y - f.y);
        if (d < cell.r) {
            cell.mass += f.value;
            updateRadius(cell);
            foods[i] = makeFood();
            if (cell === player) {
                scoreEl.textContent = String(Math.floor((player.mass - 40) * 5));
            }
        }
    }
}

function canEat(a, b) {
    return a.mass > b.mass * 1.15;
}

function resolveCellCollisions() {
    const allCells = [player, ...bots];

    for (let i = allCells.length - 1; i >= 0; i -= 1) {
        const a = allCells[i];
        for (let j = i - 1; j >= 0; j -= 1) {
            const b = allCells[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const overlap = d < Math.max(a.r, b.r) * 0.9;
            if (!overlap) {
                continue;
            }

            if (canEat(a, b)) {
                a.mass += b.mass * 0.88;
                updateRadius(a);
                if (b === player) {
                    endGame();
                    return;
                }
                bots.splice(bots.indexOf(b), 1);
                bots.push(
                    makeCell({
                        x: randomBetween(50, WORLD_WIDTH - 50),
                        y: randomBetween(50, WORLD_HEIGHT - 50),
                        mass: randomBetween(26, 75),
                        color: `hsl(${Math.floor(randomBetween(0, 360))} 80% 60%)`,
                        name: `BOT-${Math.floor(randomBetween(10, 99))}`,
                        isBot: true,
                    }),
                );
            } else if (canEat(b, a)) {
                b.mass += a.mass * 0.88;
                updateRadius(b);
                if (a === player) {
                    endGame();
                    return;
                }
                bots.splice(bots.indexOf(a), 1);
                bots.push(
                    makeCell({
                        x: randomBetween(50, WORLD_WIDTH - 50),
                        y: randomBetween(50, WORLD_HEIGHT - 50),
                        mass: randomBetween(26, 75),
                        color: `hsl(${Math.floor(randomBetween(0, 360))} 80% 60%)`,
                        name: `BOT-${Math.floor(randomBetween(10, 99))}`,
                        isBot: true,
                    }),
                );
            }
        }
    }
}

function updateHud() {
    massEl.textContent = Math.floor(player.mass);
    const elapsed = Math.floor((performance.now() - startTime) / 1000);
    timeEl.textContent = `${elapsed}s`;
}

function drawFrame() {
    const camera = getCamera();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(camera);
    drawWorldBorder(camera);
    drawFood(camera);

    for (const bot of bots) {
        drawCell(bot, camera);
    }
    drawCell(player, camera);
}

let last = 0;
function tick(now) {
    if (!running) {
        return;
    }

    const dt = clamp((now - last) / 1000, 0.001, 0.03);
    last = now;

    updatePlayer(dt);
    updateBots(dt);

    absorbFood(player);
    for (const bot of bots) {
        absorbFood(bot);
    }

    resolveCellCollisions();
    if (!running) {
        return;
    }

    updateHud();
    drawFrame();

    rafId = requestAnimationFrame(tick);
}

function endGame() {
    running = false;
    cancelAnimationFrame(rafId);
    const survival = Math.floor((performance.now() - startTime) / 1000);
    const score = Math.floor((player.mass - 40) * 5);
    finalTextEl.textContent = `점수 ${score}점 · 생존 ${survival}초`;
    gameOverEl.classList.remove('hidden');
}

function startGame() {
    overlayEl.classList.add('hidden');
    gameOverEl.classList.add('hidden');

    resetGame();
    scoreEl.textContent = '0';
    massEl.textContent = '40';
    timeEl.textContent = '0s';

    startTime = performance.now();
    last = performance.now();
    running = true;
    drawFrame();
    rafId = requestAnimationFrame(tick);
}

canvas.addEventListener('mousemove', (event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouse.x = (event.clientX - rect.left) * scaleX;
    mouse.y = (event.clientY - rect.top) * scaleY;
});

startBtn.addEventListener('click', startGame);
restartBtn.addEventListener('click', startGame);

resetGame();
drawFrame();
