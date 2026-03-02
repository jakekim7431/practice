const drawBtn = document.getElementById('drawBtn');
const numbersEl = document.getElementById('numbers');
const bonusEl = document.getElementById('bonus');
const historyEl = document.getElementById('history');
const themeBtn = document.getElementById('themeBtn');

const history = [];
const THEME_KEY = 'lotto-theme';

function updateThemeButton(theme) {
    themeBtn.textContent = theme === 'dark' ? '화이트 모드' : '다크 모드';
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
    updateThemeButton(theme);
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme === 'dark' || savedTheme === 'light') {
        applyTheme(savedTheme);
        return;
    }

    const preferredDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(preferredDark ? 'dark' : 'light');
}

function getTierClass(num) {
    if (num <= 10) return 'tier-1';
    if (num <= 20) return 'tier-2';
    if (num <= 30) return 'tier-3';
    if (num <= 40) return 'tier-4';
    return 'tier-5';
}

function generateLottoSet() {
    const picks = new Set();

    while (picks.size < 7) {
        picks.add(Math.floor(Math.random() * 45) + 1);
    }

    const values = Array.from(picks);
    const main = values.slice(0, 6).sort((a, b) => a - b);
    const bonus = values[6];

    return { main, bonus };
}

function renderBalls(numbers) {
    numbersEl.innerHTML = '';

    numbers.forEach((num) => {
        const ball = document.createElement('span');
        ball.className = `ball ${getTierClass(num)}`;
        ball.textContent = String(num);
        numbersEl.appendChild(ball);
    });
}

function renderHistory() {
    historyEl.innerHTML = '';

    history.forEach((entry, index) => {
        const li = document.createElement('li');
        li.textContent = `${index + 1}회: ${entry.main.join(', ')} + 보너스 ${entry.bonus}`;
        historyEl.appendChild(li);
    });
}

function drawNumbers() {
    const result = generateLottoSet();

    renderBalls(result.main);
    bonusEl.textContent = `보너스 번호: ${result.bonus}`;

    history.unshift(result);
    if (history.length > 5) {
        history.pop();
    }
    renderHistory();
}

drawBtn.addEventListener('click', drawNumbers);
themeBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

initTheme();
