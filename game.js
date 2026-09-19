/* ==========================================================================
   Mob Control - Child-Friendly Game Logic & Canvas Renderer
   ========================================================================== */

(function () {
  "use strict";

  /* ---------- Canvas Setup & Responsive Scaling ---------- */
  var canvas = document.getElementById('c');
  var ctx = canvas.getContext('2d');

  var W = 400, H = 700, scale = 1, offY = 0, dpr = 1;
  var crowdY;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var vw = rect.width || window.innerWidth;
    var vh = rect.height || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    H = Math.max(520, Math.min(1000, Math.round(W * vh / vw)));
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    scale = (vw * dpr) / W;
    offY = (vh * dpr - H * scale) / 2;
    crowdY = H * 0.76;
  }

  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', function () {
    setTimeout(resize, 120);
  });

  /* ---------- Sound Effects Synthesizer ---------- */
  var actx = null, masterGain = null, muted = false;
  try {
    muted = localStorage.getItem('mob_muted') === '1';
  } catch (e) {}

  function initAudio() {
    if (!actx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        masterGain = actx.createGain();
        masterGain.gain.value = 0.45;
        masterGain.connect(actx.destination);
      } catch (e) {
        actx = null;
      }
    }
    if (actx && actx.state === 'suspended') actx.resume();
  }

  function tone(o) {
    if (!actx || muted) return;
    var t0 = actx.currentTime + (o.delay || 0);
    var osc = actx.createOscillator(), g = actx.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.from, t0);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.15, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
  }

  function noise(dur, vol, freq, q, type) {
    if (!actx || muted) return;
    var n = Math.floor(actx.sampleRate * dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource();
    src.buffer = buf;
    var f = actx.createBiquadFilter();
    f.type = type || 'bandpass';
    f.frequency.value = freq || 900;
    f.Q.value = q || 1;
    var g = actx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(masterGain);
    src.start();
  }

  var sfx = {
    gain: function () {
      tone({ from: 520, to: 980, dur: 0.14, type: 'triangle', vol: 0.12 });
      tone({ from: 980, to: 1400, dur: 0.12, type: 'sine', vol: 0.08, delay: 0.04 });
    },
    lose: function () {
      tone({ from: 380, to: 180, dur: 0.18, type: 'sawtooth', vol: 0.08 });
      noise(0.08, 0.04, 500, 1.2);
    },
    toll: function () {
      tone({ from: 260, dur: 0.1, type: 'square', vol: 0.09 });
      tone({ from: 390, dur: 0.16, type: 'square', vol: 0.09, delay: 0.08 });
    },
    milestone: function () {
      var notes = [523.25, 659.25, 783.99, 1046.50];
      for (var i = 0; i < notes.length; i++) {
        tone({ from: notes[i], dur: 0.22, type: 'triangle', vol: 0.1, delay: i * 0.07 });
      }
    },
    crash: function () {
      noise(0.25, 0.12, 400, 0.6);
      tone({ from: 280, to: 80, dur: 0.45, type: 'sawtooth', vol: 0.1 });
    }
  };

  /* ---------- Helpers ---------- */
  function shade(hex, amt) {
    var r = parseInt(hex.slice(1, 3), 16),
      g = parseInt(hex.slice(3, 5), 16),
      b = parseInt(hex.slice(5, 7), 16);
    function c(v) {
      return Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
    }
    return 'rgb(' + c(r) + ',' + c(g) + ',' + c(b) + ')';
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function randInt(a, b) { return Math.floor(rand(a, b + 1)); }

  /* ---------- Game State Variables ---------- */
  var STATE_TITLE = 0, STATE_PLAY = 1, STATE_OVER = 2;
  var state = STATE_TITLE;

  var crowd, crowdX, vx, dots, particles, popups;
  var obstacles, distance, score, best = 0, peak, shake, alive, tclock;
  var pointerActive = false, tx = 0, kInput = 0;
  var milestoneNext;
  var touchDir = 0;
  var currentLevel = 1, levelToast = { text: '', subtext: '', life: 0, scale: 0 };

  try {
    best = parseInt(localStorage.getItem('mob_best') || '0', 10) || 0;
  } catch (e) {}

  var POS_OPS = [
    { op: '+', mk: function () { return randInt(2, 8); }, color: '#4caf50' },
    { op: 'x', mk: function () { return Math.random() < 0.75 ? 2 : 3; }, color: '#2196f3' }
  ];
  var NEG_OPS = [
    { op: '-', mk: function () { return randInt(4, 12); }, color: '#ff5252' },
    { op: '/', mk: function () { return 2; }, color: '#ff5252' }
  ];

  function applyOp(count, seg) {
    if (seg.op === '+') return count + seg.val;
    if (seg.op === '-') return count - seg.val;
    if (seg.op === 'x') return count * seg.val;
    if (seg.op === '/') return Math.floor(count / seg.val);
    return count;
  }

  function makeGate(y) {
    var segCount = distance > 2200 ? 3 : (distance > 700 ? (Math.random() < 0.65 ? 3 : 2) : 2);
    var probNeg = Math.min(0.60, 0.20 + distance / 3500);
    var isMoving = distance > 600 && Math.random() < 0.35;
    var segs = [];
    var w = W / segCount;
    var hasPos = false;
    for (var i = 0; i < segCount; i++) {
      var isNeg = Math.random() < probNeg;
      var pool = isNeg ? NEG_OPS : POS_OPS;
      var base = pool[(Math.random() * pool.length) | 0];
      var val = base.mk();
      if (!isNeg) hasPos = true;
      segs.push({ x0: i * w, x1: (i + 1) * w, op: base.op, val: val, color: base.color, neg: isNeg });
    }
    if (!hasPos) {
      var f = segs[(Math.random() * segs.length) | 0];
      var p = POS_OPS[(Math.random() * POS_OPS.length) | 0];
      f.op = p.op; f.val = p.mk(); f.color = p.color; f.neg = false;
    }
    return { type: 'gate', y: y, segs: segs, resolved: false, isMoving: isMoving, moveOffset: 0, moveDir: Math.random() < 0.5 ? 1 : -1 };
  }

  function makeToll(y) {
    var req = 10 + Math.floor(distance / 200) + randInt(0, 8);
    return { type: 'toll', y: y, req: req, resolved: false };
  }

  function getHighestObstacleY() {
    if (obstacles.length === 0) return 9999;
    var minY = 9999;
    for (var i = 0; i < obstacles.length; i++) {
      if (obstacles[i].y < minY) minY = obstacles[i].y;
    }
    return minY;
  }

  function spawnObstacleAt(y) {
    if (distance > 450 && Math.random() < 0.30) obstacles.push(makeToll(y));
    else obstacles.push(makeGate(y));
  }

  function reset() {
    crowd = 6; crowdX = W / 2; vx = 0;
    obstacles = []; particles = []; popups = []; dots = [];
    distance = 0; score = 0; peak = crowd; shake = 0; alive = true; tclock = 0;
    milestoneNext = 500; currentLevel = 1; levelToast = { text: '', subtext: '', life: 0, scale: 0 };
    tx = crowdX; pointerActive = false; kInput = 0; touchDir = 0;
    
    // Spawn initial obstacle sequence with guaranteed clean spacing (no overlap)
    var startY = -120;
    for (var i = 0; i < 4; i++) {
      spawnObstacleAt(startY);
      startY -= randInt(280, 320);
    }
  }

  function burst(x, y, n, color, spread, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * 6.2832, sp = Math.random() * power;
      particles.push({
        x: x + (Math.random() - 0.5) * spread,
        y: y + (Math.random() - 0.5) * spread,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        r: 2.2 + Math.random() * 3.5,
        life: 1,
        decay: 0.02 + Math.random() * 0.02,
        color: color
      });
    }
  }

  function crowdWidth() {
    return Math.max(20, Math.min(230, 22 + Math.sqrt(crowd) * 7.5));
  }

  /* ---------- Collision Resolution ---------- */
  function resolveGate(g) {
    var seg = g.segs[0];
    for (var i = 0; i < g.segs.length; i++) {
      var leftEdge = g.segs[i].x0 + (g.moveOffset || 0);
      var rightEdge = g.segs[i].x1 + (g.moveOffset || 0);
      if (crowdX >= leftEdge && crowdX < rightEdge) { seg = g.segs[i]; break; }
    }
    var before = crowd;
    crowd = applyOp(crowd, seg);
    if (crowd < 0) crowd = 0;
    var delta = crowd - before;
    popups.push({
      x: crowdX,
      y: crowdY - 44,
      life: 1,
      text: (delta >= 0 ? '+' : '') + Math.round(delta) + (delta >= 0 ? ' ⭐' : ' 💧'),
      color: seg.neg ? '255,100,100' : '255,235,59'
    });
    if (seg.neg) {
      sfx.lose();
      shake = Math.max(shake, 0.35);
      burst(crowdX, crowdY, 14, '255,120,100', crowdWidth(), 2.6);
    } else {
      sfx.gain();
      burst(crowdX, crowdY, 16, '255,235,59', crowdWidth(), 2.8);
    }
    if (crowd <= 0) return crash();
    peak = Math.max(peak, crowd);
  }

  function resolveToll(o) {
    if (crowd >= o.req) {
      var cost = Math.round(o.req * 0.45);
      crowd = Math.max(1, crowd - cost);
      score += o.req;
      sfx.toll();
      popups.push({ x: crowdX, y: crowdY - 44, life: 1, text: '-' + cost, color: '255,167,38' });
      burst(crowdX, crowdY, 18, '255,167,38', crowdWidth(), 3);
      peak = Math.max(peak, crowd);
    } else {
      burst(crowdX, crowdY, 24, '255,255,255', crowdWidth(), 3.4);
      return crash();
    }
  }

  function crash() {
    alive = false;
    shake = 1;
    sfx.crash();
    gameOver();
  }

  /* ---------- Physics & Game Step (Slightly harder speed & obstacle progression) ---------- */
  function step(dt) {
    tclock += dt;

    var steerInput = kInput || touchDir;
    var ax = 0;
    if (steerInput !== 0) {
      ax = steerInput * 380;
    } else if (pointerActive) {
      var dx = tx - crowdX;
      ax = Math.max(-1, Math.min(1, dx / 38)) * 340;
    }
    vx += ax * dt;
    vx *= Math.pow(0.88, dt * 60);
    crowdX += vx * dt;
    var half = crowdWidth() / 2;
    if (crowdX < half) { crowdX = half; vx *= -0.3; }
    if (crowdX > W - half) { crowdX = W - half; vx *= -0.3; }

    // Scroll speed calculation & distance progression
    var speed = 150 + Math.min(270, distance * 0.055);
    distance += speed * dt / 10;
    score = Math.floor(distance) + Math.floor(peak * 2);

    // Level calculation & progression (Every 400m = Level up)
    var newLevel = 1 + Math.floor(distance / 400);
    if (newLevel > currentLevel) {
      currentLevel = newLevel;
      sfx.milestone();
      levelToast = { text: 'LEVEL ' + currentLevel + '! 🚀', subtext: 'Keep it up!', life: 2.0, scale: 0 };
      burst(W / 2, H * 0.35, 28, '255,235,59', 160, 4.2);
    }

    if (levelToast.life > 0) {
      levelToast.life -= dt;
      if (levelToast.scale < 1) levelToast.scale = Math.min(1, levelToast.scale + dt * 5);
    }

    // Maintain obstacle queue with guaranteed clean gap (never overlap)
    var highestY = getHighestObstacleY();
    if (highestY > -120) {
      spawnObstacleAt(highestY - randInt(270, 320));
    }

    for (var i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      o.y += speed * dt;

      // Handle moving gates
      if (o.isMoving) {
        o.moveOffset += o.moveDir * 45 * dt;
        if (Math.abs(o.moveOffset) > 28) o.moveDir *= -1;
      }

      if (!o.resolved && o.y >= crowdY) {
        o.resolved = true;
        if (o.type === 'gate') resolveGate(o); else resolveToll(o);
        if (!alive) return;
      }
      if (o.y > H + 60) obstacles.splice(i, 1);
    }

    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx * dt * 60; pt.y += pt.vy * dt * 60; pt.vy += 0.35 * dt * 60 * 0.02;
      pt.life -= pt.decay * dt * 60;
      if (pt.life <= 0) particles.splice(p, 1);
    }
    for (var u = popups.length - 1; u >= 0; u--) {
      popups[u].y -= 0.7 * dt * 60;
      popups[u].life -= 0.02 * dt * 60;
      if (popups[u].life <= 0) popups.splice(u, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - 2.6 * dt);
  }

  function ambient(dt) {
    tclock += dt;
    for (var p = particles.length - 1; p >= 0; p--) {
      var pt = particles[p];
      pt.x += pt.vx * dt * 60; pt.y += pt.vy * dt * 60;
      pt.life -= pt.decay * dt * 60;
      if (pt.life <= 0) particles.splice(p, 1);
    }
    if (shake > 0) shake = Math.max(0, shake - 2.6 * dt);
  }

  /* ---------- Cute Child-Friendly Rendering ---------- */
  function drawCuteGuy(x, y, r, color) {
    ctx.save();
    // Drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.9, r * 0.85, r * 0.3, 0, 0, 6.2832);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + r * 0.25, r * 0.72, r * 0.82, 0, 0, 6.2832);
    ctx.fill();

    // Head
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.35, r * 0.55, 0, 6.2832);
    ctx.fill();

    // Big Eyes
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - r * 0.2, y - r * 0.42, r * 0.18, 0, 6.2832);
    ctx.arc(x + r * 0.2, y - r * 0.42, r * 0.18, 0, 6.2832);
    ctx.fill();

    // Pupils
    ctx.fillStyle = '#1b382b';
    ctx.beginPath();
    ctx.arc(x - r * 0.18, y - r * 0.42, r * 0.09, 0, 6.2832);
    ctx.arc(x + r * 0.22, y - r * 0.42, r * 0.09, 0, 6.2832);
    ctx.fill();

    // Cheeks
    ctx.fillStyle = 'rgba(255,140,160,0.65)';
    ctx.beginPath();
    ctx.arc(x - r * 0.32, y - r * 0.3, r * 0.1, 0, 6.2832);
    ctx.arc(x + r * 0.32, y - r * 0.3, r * 0.1, 0, 6.2832);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#1b382b';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(x, y - r * 0.28, r * 0.15, 0.1, 3.04);
    ctx.stroke();

    ctx.restore();
  }

  function drawCrowd() {
    var n = Math.min(46, Math.max(1, Math.round(crowd)));
    var w = crowdWidth();
    if (dots.length !== n) {
      dots = [];
      for (var i = 0; i < n; i++) {
        dots.push({ ox: rand(-1, 1) * w * 0.42, oy: rand(-1, 1) * 13, ph: Math.random() * 6.28 });
      }
    }
    for (var j = 0; j < dots.length; j++) {
      var d = dots[j];
      var bob = Math.sin(tclock * 6 + d.ph) * 2.5;
      drawCuteGuy(crowdX + d.ox, crowdY + d.oy + bob, 10, '#4cd97b');
    }

    // Number Badge above mob
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '700 16px Fredoka, sans-serif';

    var label = String(Math.round(crowd));
    var tw = ctx.measureText(label).width;

    ctx.fillStyle = 'rgba(27,56,43,0.85)';
    roundRect(crowdX - tw / 2 - 10, crowdY - 48, tw + 20, 24, 12);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, crowdX, crowdY - 31);
    ctx.restore();
  }

  function drawGate(o) {
    var y = o.y;
    var ox = o.moveOffset || 0;
    for (var i = 0; i < o.segs.length; i++) {
      var s = o.segs[i];
      ctx.save();

      var g = ctx.createLinearGradient(0, y - 4, 0, y + 36);
      g.addColorStop(0, shade(s.color, 0.15));
      g.addColorStop(1, shade(s.color, -0.15));
      ctx.fillStyle = g;
      roundRect(s.x0 + ox + 3, y, s.x1 - s.x0 - 6, 34, 10);
      ctx.fill();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      roundRect(s.x0 + ox + 3, y, s.x1 - s.x0 - 6, 34, 10);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.font = '700 17px Fredoka, sans-serif';
      var label = s.op === 'x' ? ('× ' + s.val) : s.op === '/' ? ('÷ ' + s.val) : (s.op + ' ' + s.val);
      ctx.fillText(label, (s.x0 + s.x1) / 2 + ox, y + 23);
      ctx.restore();
    }
  }

  function drawToll(o) {
    var y = o.y;
    ctx.save();
    var g = ctx.createLinearGradient(0, y - 4, 0, y + 36);
    g.addColorStop(0, '#ffa726');
    g.addColorStop(1, '#fb8c00');
    ctx.fillStyle = g;
    roundRect(8, y, W - 16, 34, 10);
    ctx.fill();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    roundRect(8, y, W - 16, 34, 10);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = '700 16px Fredoka, sans-serif';
    ctx.fillText('⭐ Need ' + o.req + ' Troops', W / 2, y + 23);
    ctx.restore();
  }

  function render() {
    var vw = canvas.width, vh = canvas.height;
    var chaos = Math.min(1, distance / 5000);

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    var g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, shade('#26634c', -chaos * 0.3));
    g.addColorStop(0.5, shade('#1e4d3b', -chaos * 0.25));
    g.addColorStop(1, shade('#0f2b20', -chaos * 0.15));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    ctx.setTransform(scale, 0, 0, scale, (Math.random() - 0.5) * shake * 8 * scale, offY + (Math.random() - 0.5) * shake * 8 * scale);

    // Lane Markers
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 20]);
    ctx.lineDashOffset = -tclock * 70;
    ctx.beginPath(); ctx.moveTo(W * 0.18, 0); ctx.lineTo(W * 0.18, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W * 0.82, 0); ctx.lineTo(W * 0.82, H); ctx.stroke();
    ctx.restore();

    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.y < -60 || o.y > H + 60) continue;
      if (o.type === 'gate') drawGate(o); else drawToll(o);
    }

    if (alive) drawCrowd();

    for (var p = 0; p < particles.length; p++) {
      var pt = particles[p];
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = 'rgb(' + pt.color + ')';
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r * pt.life, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = '700 18px Fredoka, sans-serif';
    for (var u = 0; u < popups.length; u++) {
      ctx.globalAlpha = Math.max(0, popups[u].life);
      ctx.fillStyle = 'rgb(' + popups[u].color + ')';
      ctx.fillText(popups[u].text, popups[u].x, popups[u].y);
    }
    ctx.globalAlpha = 1;

    // Floating Level Up Toast Banner
    if (levelToast && levelToast.life > 0) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, levelToast.life * 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255, 235, 59, 0.94)';
      roundRect(W / 2 - 110, H * 0.32, 220, 50, 20);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.5;
      roundRect(W / 2 - 110, H * 0.32, 220, 50, 20);
      ctx.stroke();

      ctx.fillStyle = '#0b381a';
      ctx.font = '700 24px Fredoka, sans-serif';
      ctx.fillText(levelToast.text, W / 2, H * 0.32 + 34);
      ctx.restore();
    }

    if (state === STATE_PLAY) {
      // Level Badge (Top Left Pill)
      ctx.save();
      ctx.fillStyle = 'rgba(255, 235, 59, 0.95)';
      roundRect(14, 20, 96, 30, 15);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      roundRect(14, 20, 96, 30, 15);
      ctx.stroke();

      ctx.fillStyle = '#0b381a';
      ctx.font = '700 13.5px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('LVL ' + currentLevel + ' 🌟', 62, 40);
      ctx.restore();

      // Score Header (Centered)
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 42px Fredoka, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(score), W / 2, 54);
      ctx.font = '600 14px Fredoka, sans-serif';
      ctx.globalAlpha = 0.85;
      ctx.fillText(Math.floor(distance) + ' m · Peak ' + peak + ' Troops', W / 2, 74);
      ctx.globalAlpha = 1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* ---------- Game Loop ---------- */
  var last = 0;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (!last) last = ts;
    var dt = Math.min(0.05, (ts - last) / 1000);
    last = ts;
    if (state === STATE_PLAY) step(dt);
    else ambient(dt);
    render();
  }

  /* ---------- UI Controls & State Handlers ---------- */
  var titleEl = document.getElementById('title');
  var overEl = document.getElementById('over');
  var overCard = document.getElementById('overCard');
  var overTitle = document.getElementById('overTitle');
  var finalEl = document.getElementById('finalScore');
  var tierLine = document.getElementById('tierLine');
  var bestLine = document.getElementById('bestLine');
  var mobileControls = document.getElementById('mobileControls');
  var overShownAt = 0;

  var LINES = [
    'Great Try! 🎉',
    'Super Effort! ⭐',
    'Almost Made It! 🚀',
    'Keep Going! 🎈'
  ];

  function startGame() {
    try { initAudio(); } catch (err) {}
    reset();
    state = STATE_PLAY;
    if (titleEl) titleEl.classList.add('hidden');
    if (overEl) overEl.classList.add('hidden');
    if (mobileControls) mobileControls.classList.remove('hidden');
    last = 0;
  }

  function gameOver() {
    state = STATE_OVER;
    if (score > best) {
      best = score;
      try { localStorage.setItem('mob_best', String(best)); } catch (e) {}
      bestLine.textContent = '🏆 New Best Record!';
    } else {
      bestLine.textContent = '🏆 Best Record: ' + best;
    }
    overTitle.textContent = LINES[(Math.random() * LINES.length) | 0];
    finalEl.textContent = score;
    tierLine.textContent = 'Level ' + currentLevel + ' Reached · ' + Math.floor(distance) + ' m Marched · Peak ' + peak + ' Troops';
    if (overEl) overEl.classList.remove('hidden');
    if (mobileControls) mobileControls.classList.add('hidden');

    if (overCard) {
      overCard.classList.remove('fade');
      void overCard.offsetWidth;
      overCard.classList.add('fade');
    }
    overShownAt = Date.now();
    pointerActive = false;
  }

  var startBtn = document.getElementById('startBtn');
  var againBtn = document.getElementById('againBtn');

  var triggerStart = function (e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (state !== STATE_PLAY) startGame();
  };

  if (startBtn) {
    startBtn.addEventListener('click', triggerStart);
    startBtn.addEventListener('pointerdown', triggerStart);
  }

  if (titleEl) {
    titleEl.addEventListener('click', triggerStart);
    titleEl.addEventListener('pointerdown', triggerStart);
  }

  if (againBtn) {
    againBtn.addEventListener('click', triggerStart);
    againBtn.addEventListener('pointerdown', triggerStart);
  }

  if (overEl) {
    overEl.addEventListener('pointerdown', function () {
      if (state === STATE_OVER && Date.now() - overShownAt > 300) startGame();
    });
  }

  /* Mute button setup */
  var muteBtn = document.getElementById('mute');
  function paintMute() {
    if (!muteBtn) return;
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Turn sound on' : 'Turn sound off');
  }

  if (muteBtn) {
    muteBtn.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    muteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      muted = !muted;
      try { localStorage.setItem('mob_muted', muted ? '1' : '0'); } catch (err) {}
      paintMute();
      if (!muted) { try { initAudio(); sfx.gain(); } catch (err) {} }
    });
    paintMute();
  }

  /* Touch steering buttons */
  var leftBtn = document.getElementById('leftBtn');
  var rightBtn = document.getElementById('rightBtn');

  if (leftBtn && rightBtn) {
    var bindTouch = function (btn, dir) {
      var start = function (e) { e.preventDefault(); e.stopPropagation(); touchDir = dir; };
      var end = function (e) { e.preventDefault(); e.stopPropagation(); if (touchDir === dir) touchDir = 0; };
      btn.addEventListener('pointerdown', start);
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      btn.addEventListener('mouseleave', end);
    };
    bindTouch(leftBtn, -1);
    bindTouch(rightBtn, 1);
  }

  /* Canvas Touch Drag Input */
  function toWorldX(e) {
    var r = canvas.getBoundingClientRect();
    return (e.clientX - r.left) / r.width * W;
  }

  canvas.addEventListener('pointerdown', function (e) {
    if (state !== STATE_PLAY) {
      startGame();
      return;
    }
    pointerActive = true; tx = toWorldX(e);
    if (canvas.setPointerCapture) { try { canvas.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
  });

  canvas.addEventListener('pointermove', function (e) {
    if (!pointerActive) return;
    tx = toWorldX(e); e.preventDefault();
  });

  function release() { pointerActive = false; }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('pointerleave', release);

  /* Keyboard controls */
  var KEYS = { ArrowLeft: -1, a: -1, ArrowRight: 1, d: 1 };
  window.addEventListener('keydown', function (e) {
    if (state !== STATE_PLAY) {
      startGame();
    }
    if (KEYS[e.key] !== undefined) { kInput = KEYS[e.key]; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) {
    if (KEYS[e.key] !== undefined && Math.sign(kInput) === KEYS[e.key]) kInput = 0;
  });

  document.addEventListener('visibilitychange', function () { last = 0; });
  window.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* Boot Game */
  resize();
  reset();
  bestLine.textContent = '🏆 Best Record: ' + best;
  requestAnimationFrame(loop);
})();
