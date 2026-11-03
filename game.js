(() => {
  // ---------- Setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;       // 960
  const H = canvas.height;      // 640
  const GROUND_Y = 580;         // where Pete's feet rest
  const PETE_X = W / 2;         // Pete never moves sideways

  // Jumping. Holding the spacebar keeps gravity light for up to HOLD_MAX seconds,
  // so the jump height grows smoothly with how long the key is held.
  const JUMP_SPEED = 700;       // px/s upward at takeoff
  const GRAVITY = 2800;         // px/s² normally
  const HOLD_GRAVITY = 400;     // px/s² while the spacebar is held
  const HOLD_MAX = 0.45;        // seconds; holding longer than this doesn't go higher
  const JUMP_BUFFER = 0.12;     // seconds; a press just before landing still jumps

  // Potatoes
  const MOUTH_OFFSET = 57;      // the mouth is this far above Pete's feet
  const REST_MOUTH_Y = GROUND_Y - MOUTH_OFFSET;
  const CATCH_RADIUS = 34;      // a potato whose center comes this close to the mouth is eaten
  const PASS_DISTANCE = 40;     // a potato this far past Pete is missed
  const POTATO_MIN_Y = 220;     // highest a potato flies (screen y)
  const POTATO_MAX_Y = 440;     // lowest a potato flies
  const ENTRY_DIST = W / 2 + 40;  // potatoes appear just off the edge of the screen
  const FIRST_ARRIVAL = 2.5;    // seconds until the first potato reaches Pete
  const PLAN_AHEAD = 6;         // seconds of potatoes planned before they appear
  const RAMP_TIME = 60;         // seconds until potatoes are as close together as they get
  const SPEED_START = 260;      // px/s, plus up to SPEED_SPREAD at random
  const SPEED_END = 480;        // px/s at RAMP_TIME
  const SPEED_SPREAD = 60;
  const SLACK_START = [0.7, 0.6];   // [minimum, random extra] seconds between potatoes beyond what a perfect jump needs
  const SLACK_END = [0.05, 0.2];    // the same at RAMP_TIME
  const LATE_SPEEDUP = 3;       // px/s faster for every second past RAMP_TIME, so no run lasts forever
  const OVERLOAD_START = 30;    // seconds; after this, extra potatoes come that Pete can't always reach
  const OVERLOAD_RAMP = 60;     // seconds for the chance of an extra to grow to EXTRA_CHANCE_MAX
  const EXTRA_CHANCE_MAX = 0.6; // chance that a potato brings an extra one along
  const EXTRA_GAP = [0.2, 0.5]; // [minimum, random extra] seconds the extra arrives after its potato
  const BAD_CHANCE = 0.1;
  const GOLDEN_CHANCE = 0.08;
  const POTATO_POINTS = 100;
  const GOLDEN_POINTS = 300;

  // Health
  const MAX_HEALTH = 10;
  const BAD_DAMAGE = 5;
  const PARALYZE_TIME = 2.6;    // seconds Pete can't jump or eat after a bad potato
  const GAME_OVER_DELAY = 1.4;  // seconds between running out of health and the end panel

  // ---------- State ----------
  const pete = {
    y: GROUND_Y,
    vy: 0,
    onGround: true,
    holding: false,   // this jump is still being held up by the spacebar
    holdTime: 0,      // seconds the spacebar has held this jump
    paralyzed: 0,     // seconds left unable to jump or eat
    squash: 0,        // landing squash, fades to 0
    chomp: 0          // seconds left on the chewing face
  };
  // A potato's kind is 'good', 'bad' or 'golden'
  const potatoes = [];   // on screen: {x, y, dir, speed, kind, spin, missed}
  const queue = [];      // planned but not on screen yet: {arrival, y, dir, speed, kind}
  const particles = [];  // crumbs: {x, y, vx, vy, life, color}
  const texts = [];      // floating labels: {x, y, text, color, life}
  let lastPlanned = null;  // the most recently planned potato, not counting extras
  let lastKind = 'good';   // kind of the most recently planned potato, extras included
  let planned = 0;         // potatoes planned this run

  let health = MAX_HEALTH;
  let score = 0;
  let eaten = 0;
  let best = 0;           // top saved score, shown in the HUD
  let clock = 0;          // seconds since the run started
  let started = false;    // nothing happens until this is true
  let dying = false;      // health ran out; waiting to show the end panel
  let overTimer = 0;
  let outcome = null;     // set once the end panel is up
  let spaceHeld = false;
  let jumpBuffer = 0;
  let hpFlash = 0, redFlash = 0, shake = 0;
  let anim = 0;           // always-running timer for idle animation

  // Cheap deterministic hash so scenery doesn't change between loads
  const hash = (x, n) => {
    const s = Math.sin(x * 127.1 + n * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Input ----------
  function press() {
    if (!started || dying) return;
    if (!spaceHeld) jumpBuffer = JUMP_BUFFER;
    spaceHeld = true;
  }
  function release() { spaceHeld = false; }

  window.addEventListener('keydown', e => {
    if (e.code === 'KeyR' && outcome && initialsForm.hidden) { newRun(); return; }
    // Space on a button or in the initials box does its usual job
    if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLInputElement) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!e.repeat) press();
    }
  });
  window.addEventListener('keyup', e => { if (e.code === 'Space') release(); });
  window.addEventListener('blur', release);
  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.focus();
    press();
  });
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);

  // ---------- Panels ----------
  const startScreen = document.getElementById('start');
  const introPanel = document.getElementById('intro');
  const scoresPanel = document.getElementById('scores');
  const endPanel = document.getElementById('end');
  const panels = [introPanel, scoresPanel, endPanel];
  const startButton = document.getElementById('start-game');
  const showScoresButton = document.getElementById('show-scores');
  const hideScoresButton = document.getElementById('hide-scores');
  const playAgainButton = document.getElementById('play-again');
  const initialsForm = document.getElementById('initials-form');
  const initialsInput = document.getElementById('initials');
  const saveInitialsButton = document.getElementById('save-initials');
  const endResults = document.getElementById('end-results');

  function showPanel(panel, button) {
    startScreen.hidden = false;
    panels.forEach(p => { p.hidden = p !== panel; });
    button.focus();
  }
  showScoresButton.addEventListener('click', () => showPanel(scoresPanel, hideScoresButton));
  hideScoresButton.addEventListener('click', () => showPanel(introPanel, startButton));

  function resetRun() {
    health = MAX_HEALTH;
    score = 0;
    eaten = 0;
    clock = 0;
    potatoes.length = 0;
    queue.length = 0;
    particles.length = 0;
    texts.length = 0;
    lastPlanned = null;
    lastKind = 'good';
    planned = 0;
    Object.assign(pete, { y: GROUND_Y, vy: 0, onGround: true, holding: false, holdTime: 0, paralyzed: 0, squash: 0, chomp: 0 });
    dying = false;
    outcome = null;
    spaceHeld = false;
    jumpBuffer = 0;
    hpFlash = redFlash = shake = 0;
    best = loadScores()[0]?.score || 0;
  }

  function newRun() {
    resetRun();
    started = true;
    startScreen.hidden = true;
    canvas.focus();
  }
  startButton.addEventListener('click', newRun);
  playAgainButton.addEventListener('click', newRun);

  function endRun() {
    started = false;
    dying = false;
    outcome = 'over';
    document.getElementById('end-score').textContent = score.toLocaleString();
    document.getElementById('end-eaten').textContent = eaten === 1 ? '1 potato' : eaten + ' potatoes';

    const entering = makesList(score);
    initialsForm.hidden = !entering;
    endResults.hidden = entering;
    if (entering) {
      initialsInput.value = '';
      saveInitialsButton.disabled = true;
      showPanel(endPanel, initialsInput);
    } else {
      renderScores();
      showPanel(endPanel, playAgainButton);
    }
  }

  initialsInput.addEventListener('input', () => {
    initialsInput.value = initialsInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    saveInitialsButton.disabled = initialsInput.value.length < 3;
  });

  initialsForm.addEventListener('submit', e => {
    e.preventDefault();
    if (initialsInput.value.length < 3) return;
    const rank = addScore({ initials: initialsInput.value, score });
    renderScores(rank);
    initialsForm.hidden = true;
    endResults.hidden = false;
    playAgainButton.focus();
  });

  // ---------- High scores ----------
  const SCORES_KEY = 'potato-pete-high-scores';
  const MAX_SCORES = 10;

  // Browser storage for now. These two functions are all that need to change
  // to keep scores somewhere permanent.
  function loadScores() {
    try {
      const saved = JSON.parse(localStorage.getItem(SCORES_KEY));
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function saveScores(scores) {
    try {
      localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
    } catch {
      // storage can be blocked; the game still works without saved scores
    }
  }

  // Highest first; a new score has to beat a tie to pass it
  function makesList(points) {
    if (points <= 0) return false;
    const scores = loadScores();
    return scores.length < MAX_SCORES || points > scores[scores.length - 1].score;
  }

  // Returns the entry's place in the list
  function addScore(entry) {
    const scores = loadScores();
    scores.push(entry);
    scores.sort((a, b) => b.score - a.score);
    const kept = scores.slice(0, MAX_SCORES);
    saveScores(kept);
    return kept.indexOf(entry);
  }

  function addCell(row, text) {
    const cell = document.createElement('td');
    cell.textContent = text;
    row.appendChild(cell);
  }

  function renderScores(highlight = -1) {
    const scores = loadScores();
    document.querySelectorAll('.score-rows').forEach(rows => {
      rows.replaceChildren();
      scores.forEach((s, i) => {
        const row = document.createElement('tr');
        if (i === highlight) row.className = 'latest';
        addCell(row, i + 1);
        addCell(row, s.initials);
        addCell(row, s.score.toLocaleString());
        rows.appendChild(row);
      });
      if (!scores.length) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 3;
        cell.textContent = 'No scores yet';
        row.appendChild(cell);
        rows.appendChild(row);
      }
    });
  }

  // ---------- Pete ----------
  function updatePete(dt) {
    pete.squash = Math.max(0, pete.squash - dt * 5);
    pete.chomp = Math.max(0, pete.chomp - dt);
    pete.paralyzed = Math.max(0, pete.paralyzed - dt);
    jumpBuffer = Math.max(0, jumpBuffer - dt);
    const canMove = pete.paralyzed === 0 && !dying;

    if (pete.onGround && jumpBuffer > 0 && canMove) {
      pete.vy = -JUMP_SPEED;
      pete.onGround = false;
      pete.holding = spaceHeld;
      pete.holdTime = 0;
      jumpBuffer = 0;
    }
    if (pete.onGround) return;

    let g = GRAVITY;
    if (pete.holding && spaceHeld && canMove && pete.holdTime < HOLD_MAX && pete.vy < 0) {
      g = HOLD_GRAVITY;
      pete.holdTime += dt;
    } else {
      pete.holding = false;   // once let go, holding again doesn't help this jump
    }
    pete.vy += g * dt;
    pete.y += pete.vy * dt;
    if (pete.y >= GROUND_Y) {
      pete.y = GROUND_Y;
      pete.vy = 0;
      pete.onGround = true;
      pete.squash = 1;
    }
  }

  // ---------- Potatoes ----------
  // How far a potato at screen y is above Pete's mouth when he stands
  const heightOf = y => REST_MOUTH_Y - y;

  // Seconds for a fully held jump to lift the mouth h px
  function riseTime(h) {
    const holdRise = JUMP_SPEED * HOLD_MAX - HOLD_GRAVITY * HOLD_MAX ** 2 / 2;
    if (h <= holdRise) {
      return (JUMP_SPEED - Math.sqrt(Math.max(0, JUMP_SPEED ** 2 - 2 * HOLD_GRAVITY * h))) / HOLD_GRAVITY;
    }
    const v = JUMP_SPEED - HOLD_GRAVITY * HOLD_MAX;
    return HOLD_MAX + (v - Math.sqrt(Math.max(0, v * v - 2 * GRAVITY * (h - holdRise)))) / GRAVITY;
  }

  // Seconds to fall h px back to the ground
  const fallTime = h => Math.sqrt(2 * h / GRAVITY);

  const randomHeight = () => POTATO_MIN_Y + Math.random() * (POTATO_MAX_Y - POTATO_MIN_Y);

  // The first few are always good, and bad ones never come twice in a row
  function pickKind() {
    if (planned < 3) return 'good';
    const r = Math.random();
    if (r < BAD_CHANCE && lastKind !== 'bad') return 'bad';
    if (r > 1 - GOLDEN_CHANCE) return 'golden';
    return 'good';
  }

  function queuePotato(arrival, y, ramp, late) {
    const potato = {
      arrival,
      y,
      dir: Math.random() < 0.5 ? 1 : -1,
      speed: lerp(SPEED_START, SPEED_END, ramp) + late * LATE_SPEEDUP + Math.random() * SPEED_SPREAD,
      kind: pickKind()
    };
    queue.push(potato);
    lastKind = potato.kind;
    planned++;
    return potato;
  }

  // Chance that a potato arriving at time t brings an extra along
  const extraChance = t => Math.min(1, Math.max(0, (t - OVERLOAD_START) / OVERLOAD_RAMP)) * EXTRA_CHANCE_MAX;

  // Each potato is timed to reach Pete long enough after the last one that
  // he can land from that catch and jump to the new height, plus some slack
  // that shrinks as the run goes on.
  function planPotato() {
    const y = randomHeight();
    let arrival = FIRST_ARRIVAL;
    let ramp = 0;   // 0 at the start, 1 once potatoes are as close together as they get
    let late = 0;   // seconds past RAMP_TIME
    if (lastPlanned) {
      late = Math.max(0, lastPlanned.arrival - RAMP_TIME);
      ramp = Math.min(lastPlanned.arrival / RAMP_TIME, 1);
      const needed = fallTime(heightOf(lastPlanned.y)) + riseTime(heightOf(y)) + 0.15;
      const slack = lerp(SLACK_START[0], SLACK_END[0], ramp) + Math.random() * lerp(SLACK_START[1], SLACK_END[1], ramp);
      arrival = lastPlanned.arrival + needed + slack;
    }
    lastPlanned = queuePotato(arrival, y, ramp, late);
    // Extras squeeze in too close to catch both. They aren't lastPlanned, so
    // the next regular potato is always catchable if Pete lets the extra go.
    if (Math.random() < extraChance(arrival)) {
      queuePotato(arrival + EXTRA_GAP[0] + Math.random() * EXTRA_GAP[1], randomHeight(), ramp, late);
    }
  }

  function spawnPotatoes() {
    while (!lastPlanned || lastPlanned.arrival < clock + PLAN_AHEAD) planPotato();
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      const away = q.speed * (q.arrival - clock);
      if (away > ENTRY_DIST) continue;
      queue.splice(i, 1);
      potatoes.push({
        x: PETE_X - q.dir * away,
        y: q.y,
        dir: q.dir,
        speed: q.speed,
        kind: q.kind,
        spin: Math.random() * Math.PI * 2,
        missed: false
      });
    }
  }

  function updatePotatoes(dt) {
    const mouthY = pete.y - MOUTH_OFFSET;
    const canEat = pete.paralyzed === 0 && !dying;
    for (let i = potatoes.length - 1; i >= 0; i--) {
      const p = potatoes[i];
      p.x += p.dir * p.speed * dt;
      p.spin += p.dir * dt * 5;
      if (!p.missed && canEat && Math.hypot(p.x - PETE_X, p.y - mouthY) < CATCH_RADIUS) {
        potatoes.splice(i, 1);
        eat(p, mouthY);
        continue;
      }
      if (!p.missed && (p.x - PETE_X) * p.dir > PASS_DISTANCE) {
        p.missed = true;
        if (p.kind !== 'bad' && !dying) miss(p);   // dodging a bad potato is free
      }
      if (p.x < -80 || p.x > W + 80) potatoes.splice(i, 1);
    }
  }

  function eat(p, mouthY) {
    pete.chomp = 0.35;
    addCrumbs(PETE_X, mouthY, POTATO_LOOK[p.kind].crumb);
    if (p.kind === 'bad') {
      pete.paralyzed = PARALYZE_TIME;
      pete.holding = false;
      redFlash = 1;
      shake = 0.4;
      addText(PETE_X, mouthY - 60, 'Bad potato! -5', '#ff5a4a');
      changeHealth(-BAD_DAMAGE);
    } else {
      const golden = p.kind === 'golden';
      const points = golden ? GOLDEN_POINTS : POTATO_POINTS;
      score += points;
      eaten++;
      addText(PETE_X, mouthY - 50, '+' + points, golden ? '#ffe14d' : '#fff0c0');
      changeHealth(1);
    }
  }

  function miss(p) {
    addText(PETE_X + p.dir * 90, GROUND_Y - 150, 'Missed! -1', '#ffb0a0');
    changeHealth(-1);
  }

  function changeHealth(n) {
    const before = health;
    health = Math.max(0, Math.min(MAX_HEALTH, health + n));
    if (health !== before) hpFlash = 0.4;
    if (health === 0 && !dying) {
      dying = true;
      overTimer = GAME_OVER_DELAY;
    }
  }

  // ---------- Effects ----------
  function addCrumbs(x, y, color) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 160;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.6 + Math.random() * 0.3, color });
    }
  }

  function addText(x, y, text, color) {
    texts.push({ x, y, text, color, life: 1.1 });
  }

  function updateEffects(dt) {
    hpFlash = Math.max(0, hpFlash - dt);
    redFlash = Math.max(0, redFlash - dt * 2);
    shake = Math.max(0, shake - dt);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 900 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 45 * dt;
      texts[i].life -= dt;
      if (texts[i].life <= 0) texts.splice(i, 1);
    }
  }

  const clouds = [
    { x: 120, y: 90, s: 1.1, speed: 12 },
    { x: 420, y: 60, s: 0.8, speed: 8 },
    { x: 640, y: 150, s: 1.3, speed: 15 },
    { x: 860, y: 230, s: 0.7, speed: 6 },
    { x: 300, y: 260, s: 0.9, speed: 10 }
  ];

  function updateClouds(dt) {
    clouds.forEach(c => {
      c.x += c.speed * dt;
      if (c.x > W + 120) c.x = -120;
    });
  }

  // ---------- Update ----------
  function update(dt) {
    anim += dt;
    updateClouds(dt);
    updateEffects(dt);
    if (!started) return;
    if (!dying) clock += dt;
    updatePete(dt);
    if (!dying) spawnPotatoes();
    updatePotatoes(dt);
    if (dying) {
      overTimer -= dt;
      if (overTimer <= 0) endRun();
    }
  }

  // ---------- Drawing ----------
  function fillEllipse(x, y, rx, ry, c = ctx) {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  }

  function fillTriangle(x1, y1, x2, y2, x3, y3) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y3);
    ctx.closePath();
    ctx.fill();
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  // Static scenery is drawn once into its own canvas
  function makeLayer(paint) {
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    paint(layer.getContext('2d'));
    return layer;
  }

  const skyLayer = makeLayer(g => {
    const sky = g.createLinearGradient(0, 0, 0, 480);
    sky.addColorStop(0, '#79c2ee');
    sky.addColorStop(0.7, '#bfe3f5');
    sky.addColorStop(1, '#fbe6c2');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(820, 110, 20, 820, 110, 110);
    glow.addColorStop(0, 'rgba(255, 244, 190, .9)');
    glow.addColorStop(1, 'rgba(255, 244, 190, 0)');
    g.fillStyle = glow;
    g.fillRect(700, 0, 240, 240);
    g.fillStyle = '#fff4b8';
    fillEllipse(820, 110, 38, 38, g);
  });

  const sceneryLayer = makeLayer(g => {
    function hills(base, wave, color) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base + wave(x));
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    }
    hills(420, x => Math.sin(x * 0.008) * 26 + Math.sin(x * 0.021) * 10, '#9acb83');
    hills(470, x => Math.sin(x * 0.012 + 2) * 18, '#78b562');

    // Fence
    g.fillStyle = '#d9b27c';
    g.fillRect(0, 494, W, 9);
    g.fillRect(0, 520, W, 9);
    for (let x = 10; x < W; x += 56) {
      g.fillStyle = '#e4c08c';
      g.beginPath();
      g.moveTo(x, 548);
      g.lineTo(x, 484);
      g.lineTo(x + 9, 474);
      g.lineTo(x + 18, 484);
      g.lineTo(x + 18, 548);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(120, 80, 40, .25)';
      g.fillRect(x + 13, 484, 5, 64);
    }

    // Lawn
    g.fillStyle = '#5fa548';
    g.fillRect(0, 545, W, H - 545);
    g.fillStyle = '#4e9139';
    g.fillRect(0, 545, W, 5);
    g.strokeStyle = '#4b8c37';
    g.lineWidth = 2;
    for (let i = 0; i < 260; i++) {
      const x = hash(i, 1) * W;
      const y = 556 + hash(i, 2) * 84;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (hash(i, 3) - 0.5) * 6, y - 5 - hash(i, 4) * 5);
      g.stroke();
    }
    const petals = ['#fff6e0', '#ffd4e6', '#ffe27a'];
    for (let i = 0; i < 18; i++) {
      const x = hash(i, 5) * W;
      if (Math.abs(x - PETE_X) < 60) continue;   // keep Pete's spot clear
      const y = 560 + hash(i, 6) * 70;
      g.fillStyle = petals[i % petals.length];
      for (let k = 0; k < 5; k++) {
        const a = k * Math.PI * 2 / 5;
        fillEllipse(x + Math.cos(a) * 3.5, y + Math.sin(a) * 3.5, 2.6, 2.6, g);
      }
      g.fillStyle = '#e8a33a';
      fillEllipse(x, y, 2, 2, g);
    }
  });

  function drawCloud(c) {
    ctx.fillStyle = 'rgba(255, 255, 255, .9)';
    const s = c.s;
    fillEllipse(c.x, c.y, 46 * s, 20 * s);
    fillEllipse(c.x - 30 * s, c.y + 4 * s, 28 * s, 15 * s);
    fillEllipse(c.x + 32 * s, c.y + 5 * s, 30 * s, 14 * s);
    fillEllipse(c.x + 4 * s, c.y - 14 * s, 26 * s, 18 * s);
  }

  const POTATO_SPOTS = [[-9, -3, 2.4], [4, -6, 2], [10, 3, 2.2], [-2, 6, 1.8]];
  // glow is an "r, g, b" string, or null for no glow
  const POTATO_LOOK = {
    good: { glow: null, skin: '#c99a5b', edge: '#7a5530', spot: '#8a6238', crumb: '#e8c48a' },
    bad: { glow: '255, 40, 30', skin: '#b5543a', edge: '#6e2014', spot: '#6e2014', crumb: '#d9573b' },
    golden: { glow: '255, 200, 40', skin: '#f0c43c', edge: '#8a6210', spot: '#b08218', crumb: '#ffd34d' }
  };

  function drawPotato(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.missed) ctx.globalAlpha = 0.45;

    // Speed streaks trail behind
    ctx.strokeStyle = 'rgba(255, 255, 255, .55)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    [-7, 0, 7].forEach((k, n) => line(-p.dir * 28, k, -p.dir * (44 + n % 2 * 10), k));

    const look = POTATO_LOOK[p.kind];
    if (look.glow) {
      const pulse = 0.65 + 0.35 * Math.sin(anim * 9);
      const glow = ctx.createRadialGradient(0, 0, 8, 0, 0, 44);
      glow.addColorStop(0, `rgba(${look.glow}, ${0.8 * pulse})`);
      glow.addColorStop(1, `rgba(${look.glow}, 0)`);
      ctx.fillStyle = glow;
      fillEllipse(0, 0, 44, 44);
    }

    ctx.rotate(p.spin);
    ctx.fillStyle = look.skin;
    ctx.strokeStyle = look.edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, 21, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = look.spot;
    POTATO_SPOTS.forEach(([x, y, r]) => fillEllipse(x, y, r, r));
    ctx.fillStyle = 'rgba(255, 255, 255, .25)';
    fillEllipse(-6, -6, 8, 3);
    ctx.restore();
  }

  // The potato Pete is most interested in: the closest one he hasn't missed
  function nearestPotato() {
    const mouthY = pete.y - MOUTH_OFFSET;
    let best = null, bestDist = Infinity;
    potatoes.forEach(p => {
      if (p.missed) return;
      const d = Math.hypot(p.x - PETE_X, p.y - mouthY);
      if (d < bestDist) { best = p; bestDist = d; }
    });
    return best && { p: best, d: bestDist };
  }

  function drawStar(x, y, r) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5;
      const rr = k % 2 ? r * 0.45 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawSpiral(x, y) {
    ctx.beginPath();
    for (let t = 0; t < 12; t += 0.3) {
      const a = t + anim * 8;
      ctx.lineTo(x + Math.cos(a) * t * 0.55, y + Math.sin(a) * t * 0.55);
    }
    ctx.stroke();
  }

  const FUR = '#f2a24c', FUR_DARK = '#c76f28', FUR_LIGHT = '#fde6c8';
  const SICK = '#a9c25a', SICK_DARK = '#7a9136';

  function drawPete() {
    const sick = pete.paralyzed > 0 || dying;
    const fur = sick ? SICK : FUR;
    const dark = sick ? SICK_DARK : FUR_DARK;
    const air = GROUND_Y - pete.y;
    const near = nearestPotato();

    // Shadow shrinks as he rises
    const s = Math.max(0.3, 1 - air / 450);
    ctx.fillStyle = 'rgba(40, 30, 10, .28)';
    fillEllipse(PETE_X, GROUND_Y + 3, 36 * s, 8 * s);

    ctx.save();
    ctx.translate(PETE_X + (sick ? Math.sin(anim * 70) * 1.5 : 0), pete.y);
    // Squash on landing, stretch while rising
    const sy = pete.onGround ? 1 - pete.squash * 0.18 : 1 + Math.min(Math.max(-pete.vy, 0), 700) / 700 * 0.12;
    ctx.scale(1 / sy, sy);
    ctx.lineCap = 'round';

    // Tail
    const sway = sick ? 0 : Math.sin(anim * 3) * 8;
    ctx.strokeStyle = fur;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(18, -14);
    ctx.quadraticCurveTo(52, -20, 44 + sway, -58);
    ctx.stroke();
    ctx.fillStyle = dark;
    fillEllipse(44 + sway, -58, 5, 5);

    // Feet dangle in the air
    ctx.fillStyle = FUR_LIGHT;
    if (pete.onGround) {
      fillEllipse(-13, -4, 10, 6);
      fillEllipse(13, -4, 10, 6);
    } else {
      fillEllipse(-11, 0, 8, 8);
      fillEllipse(11, 0, 8, 8);
    }

    // Body
    ctx.fillStyle = fur;
    fillEllipse(0, -30, 26, 28);
    ctx.fillStyle = FUR_LIGHT;
    fillEllipse(0, -24, 15, 19);
    ctx.strokeStyle = dark;
    ctx.lineWidth = 3.5;
    line(-25, -36, -17, -34);
    line(-25, -26, -18, -25);
    line(25, -36, 17, -34);
    line(25, -26, 18, -25);

    // Ears
    ctx.fillStyle = fur;
    fillTriangle(-28, -84, -22, -114, -4, -98);
    fillTriangle(28, -84, 22, -114, 4, -98);
    ctx.fillStyle = '#f4a6a6';
    fillTriangle(-23, -89, -20, -106, -9, -98);
    fillTriangle(23, -89, 20, -106, 9, -98);

    // Head
    ctx.fillStyle = fur;
    fillEllipse(0, -74, 30, 29);
    ctx.strokeStyle = dark;
    line(0, -102, 0, -93);
    line(-9, -100, -7, -93);
    line(9, -100, 7, -93);
    line(-29, -76, -22, -74);
    line(29, -76, 22, -74);

    // Eyes
    if (sick) {
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 2;
      drawSpiral(-11, -80);
      drawSpiral(11, -80);
    } else if (pete.chomp > 0) {
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 3;
      [-11, 11].forEach(x => {
        ctx.beginPath();
        ctx.arc(x, -77, 6, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      });
    } else {
      let lx = 0, ly = 0;
      if (near) {
        const dx = near.p.x - PETE_X, dy = near.p.y - (pete.y - 80);
        const len = Math.hypot(dx, dy) || 1;
        lx = dx / len * 2.5;
        ly = dy / len * 2.5;
      }
      [-11, 11].forEach(x => {
        ctx.fillStyle = '#fff';
        fillEllipse(x, -80, 7, 8);
        ctx.fillStyle = '#2a1e14';
        fillEllipse(x + lx, -80 + ly, 3.5, 6);
      });
    }

    // Muzzle and nose
    ctx.fillStyle = FUR_LIGHT;
    fillEllipse(-7, -63, 9, 7);
    fillEllipse(7, -63, 9, 7);
    ctx.fillStyle = '#e8838a';
    fillTriangle(-4, -70, 4, -70, 0, -65);

    // Mouth opens wider as a potato gets close
    let open = 0;
    if (pete.chomp > 0) open = Math.abs(Math.sin(pete.chomp * 28)) * 0.35;
    else if (!sick && near) open = Math.min(1, Math.max(0, 1 - (near.d - CATCH_RADIUS) / 150));
    if (sick) {
      ctx.strokeStyle = '#3a2a1a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-7, -56);
      for (let k = 1; k <= 4; k++) ctx.lineTo(-7 + k * 3.5, k % 2 ? -59 : -56);
      ctx.stroke();
    } else if (open > 0.05) {
      ctx.fillStyle = '#5a1f1f';
      fillEllipse(0, -55, 6 + 4 * open, 2 + 9 * open);
      ctx.fillStyle = '#e86b7a';
      fillEllipse(0, -55 + 5 * open, 4 + 2 * open, 3 * open);
    } else {
      ctx.strokeStyle = '#5a3a2a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-6, -58);
      ctx.quadraticCurveTo(-3, -54, 0, -58);
      ctx.quadraticCurveTo(3, -54, 6, -58);
      ctx.stroke();
    }

    // Whiskers
    ctx.strokeStyle = 'rgba(255, 255, 255, .85)';
    ctx.lineWidth = 1.5;
    line(-13, -63, -40, -67);
    line(-13, -60, -40, -56);
    line(13, -63, 40, -67);
    line(13, -60, 40, -56);

    // Stars circle his head while he's stuck
    if (sick) {
      ctx.fillStyle = '#ffe14d';
      for (let k = 0; k < 3; k++) {
        const a = anim * 4 + k * Math.PI * 2 / 3;
        drawStar(Math.cos(a) * 28, -116 + Math.sin(a) * 6, 6);
      }
    }
    ctx.restore();
  }

  function drawEffects() {
    particles.forEach(p => {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.fillStyle = p.color;
      fillEllipse(p.x, p.y, 3, 3);
    });
    ctx.globalAlpha = 1;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    texts.forEach(t => {
      ctx.globalAlpha = Math.min(1, t.life * 2);
      ctx.strokeStyle = 'rgba(40, 25, 10, .85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    });
    ctx.globalAlpha = 1;
  }

  function drawHUD() {
    // Health
    ctx.fillStyle = 'rgba(28, 23, 18, .6)';
    ctx.beginPath();
    ctx.roundRect(16, 14, 280, 54, 8);
    ctx.fill();
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#e6dccf';
    ctx.fillText('HEALTH', 28, 32);
    const color = health > 6 ? '#6fd05a' : health > 3 ? '#ffd966' : '#ff5a4a';
    const pulse = health <= 3 && health > 0 ? 0.6 + 0.4 * Math.sin(anim * 10) : 1;
    for (let i = 0; i < MAX_HEALTH; i++) {
      ctx.globalAlpha = i < health ? pulse : 1;
      ctx.fillStyle = i < health ? color : '#3a2f24';
      ctx.fillRect(28 + i * 26, 40, 22, 18);
    }
    ctx.globalAlpha = 1;
    if (hpFlash > 0) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${hpFlash / 0.4})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(25, 37, 258, 24);
    }

    // Score
    ctx.fillStyle = 'rgba(28, 23, 18, .6)';
    ctx.beginPath();
    ctx.roundRect(W - 226, 14, 210, 54, 8);
    ctx.fill();
    ctx.fillStyle = '#e6dccf';
    ctx.fillText('SCORE', W - 214, 32);
    ctx.textAlign = 'right';
    ctx.fillText('BEST ' + Math.max(best, score).toLocaleString(), W - 28, 32);
    ctx.font = 'bold 26px system-ui, sans-serif';
    ctx.fillStyle = '#ffd966';
    ctx.fillText(score.toLocaleString(), W - 28, 60);

    if (started && clock < 1.6) {
      ctx.globalAlpha = Math.min(1, (1.6 - clock) * 2);
      ctx.font = 'bold 40px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(40, 25, 10, .85)';
      ctx.strokeText('Get ready!', W / 2, 250);
      ctx.fillStyle = '#fff4b8';
      ctx.fillText('Get ready!', W / 2, 250);
      ctx.globalAlpha = 1;
    }
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 30, (Math.random() - 0.5) * shake * 30);
    ctx.drawImage(skyLayer, 0, 0);
    clouds.forEach(drawCloud);
    ctx.drawImage(sceneryLayer, 0, 0);
    drawPete();
    potatoes.forEach(drawPotato);
    drawEffects();
    ctx.restore();
    if (redFlash > 0) {
      ctx.fillStyle = `rgba(255, 30, 20, ${redFlash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawHUD();
  }

  // ---------- Loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05);  // a long gap (hidden tab) doesn't jump ahead
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  resetRun();
  renderScores();
  startButton.focus();
  requestAnimationFrame(frame);
})();
