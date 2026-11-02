/*!
 * starfall-sky.js — Starfall Night-Sky Background
 * For "A Court of Cosplay" — Night Court Starfall theme
 * Vanilla JS + HTML5 Canvas 2D, zero dependencies.
 *
 * Usage:
 *   <link rel="stylesheet" href="starfall-sky.css">
 *   <script src="starfall-sky.js"></script>
 *
 * Tunables are all in SFCFG below. The canvas is inserted
 * automatically as the first child of <body> and stays fixed
 * behind all content (z-index: -1, pointer-events: none).
 *
 * Click/tap anywhere on the page (except links, buttons, or
 * elements with data-no-star) to shoot a star through that spot.
 * Every 15 seconds a Starfall event releases a shower of stars.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════════
//  CONFIG — every tunable. Adjust here; do not change code below.
// ═══════════════════════════════════════════════════════════════════
const SFCFG = {

  // ── Background ────────────────────────────────────────────────────
  BG_TOP:           '#0b0f2a',   // gradient top (deep indigo)
  BG_BOTTOM:        '#1c1440',   // gradient bottom (night violet)
  NEBULA_COLOR:     '#3d2b6a',   // corner haze tint
  NEBULA_OPACITY:   0.18,        // 0 to disable

  // ── Starfield ─────────────────────────────────────────────────────
  STAR_COUNT_BASE:  200,         // count at 1920×1080; scales by area
  STAR_COUNT_MIN:   60,          // floor on small/phone screens
  STAR_COUNT_MAX:   360,         // ceiling on large displays
  // Layer distribution [far, mid, near] — must sum to 1
  LAYER_RATIOS:     [0.60, 0.30, 0.10],
  // Star colors — first entry gets 65% of picks (mostly white)
  STAR_COLORS:      ['#f4f1ff', '#f4f1ff', '#f4f1ff', '#f6e7b8', '#cbbcff'],

  // ── Twinkle ───────────────────────────────────────────────────────
  TWINKLE_PERIOD_MIN:   3,       // seconds per full sine cycle
  TWINKLE_PERIOD_MAX:   8,
  TWINKLE_OPACITY_MIN:  0.40,    // fraction of base brightness at trough
  TWINKLE_OPACITY_MAX:  1.00,    // fraction at peak

  // ── Sparkle glints (4-point star flashes on bright near stars) ────
  SPARKLE_RATIO:        0.55,    // fraction of near-layer stars eligible
  SPARKLE_INTERVAL_MIN: 6,       // seconds between glints (per star)
  SPARKLE_INTERVAL_MAX: 15,
  SPARKLE_DURATION:     0.6,     // seconds for one full glint (in + out)

  // ── Cursor parallax ───────────────────────────────────────────────
  PARALLAX_NEAR:    6,           // max parallax offset px, near layer
  PARALLAX_MID:     3,           // mid layer
  PARALLAX_FAR:     1,           // far layer
  PARALLAX_EASE:    0.04,        // lerp factor — lower = dreamier
  CURSOR_RADIUS:    120,         // px — stars brighten within this
  CURSOR_BOOST:     0.20,        // extra opacity fraction near cursor

  // ── Shooting stars (click / tap) ──────────────────────────────────
  SHOOT_MAX:            3,       // max concurrent shooting stars
  SHOOT_TRAIL_MIN:      120,     // trail length px
  SHOOT_TRAIL_MAX:      200,
  SHOOT_ANGLE_MIN:      20,      // degrees below horizontal
  SHOOT_ANGLE_MAX:      40,
  SHOOT_DURATION_MIN:   0.9,     // seconds to cross screen
  SHOOT_DURATION_MAX:   1.3,
  SHOOT_REGROW_RADIUS:  40,      // px — stars within this range flash
  SHOOT_REGROW_DUR:     2.0,     // seconds for regrow boost to decay
  SHOOT_COLOR:          '#57f3de', // blue-green cyan for every shooting star
  SHOOT_CORE_COLOR:     '#d4fffa', // pale cyan-white core
  SHOOT_DUST_RATE:      75,       // particles per second, independent of frame rate
  SHOOT_DUST_MAX:       650,      // bound work during a meteor shower

  // ── Starfall event (periodic meteor shower) ───────────────────────
  STARFALL_INTERVAL:    15,      // seconds between shower starts
  STARFALL_COUNT_MIN:   10,      // shooting stars per event
  STARFALL_COUNT_MAX:   16,
  STARFALL_SPREAD:      4,       // seconds to stagger all launches
  STARFALL_ANGLE_BASE:  30,      // shared travel angle (° below horizontal)
  STARFALL_ANGLE_VAR:   6,       // ± variance per star
  STARFALL_Y_FRAC:      0.66,    // stars pass through upper N of screen
  STARFALL_BOOST:       0.10,    // extra ambient brightness during event
  STARFALL_WASH_IN:     1.5,     // seconds to fade the sky wash in
  STARFALL_WASH_HOLD:   2.5,     // seconds to hold
  STARFALL_WASH_OUT:    2.0,     // seconds to fade out
};


// ═══════════════════════════════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════════════════════════════
const lerp  = (a, b, t)    => a + (b - a) * t;
const clamp = (v, lo, hi)  => Math.max(lo, Math.min(hi, v));
const rand  = (lo, hi)     => lo + Math.random() * (hi - lo);
const randI = (lo, hi)     => Math.floor(rand(lo, hi + 0.999));

function hexRGB(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
}


// ═══════════════════════════════════════════════════════════════════
//  SPRITE FACTORY
//  Pre-renders star glow discs and sparkle glints to offscreen
//  canvases so we never call shadowBlur during the render loop.
// ═══════════════════════════════════════════════════════════════════
function buildSprites() {
  // Max core radius per layer (stars scale within their layer)
  const maxR     = [1.0, 1.6, 2.8];
  const glowMult = [2.5, 3.0, 4.0]; // glow radius = core radius × mult

  // Build one sprite per [layer][colorIndex]
  const byLayer = [[], [], []];
  SFCFG.STAR_COLORS.forEach((hex, ci) => {
    const [r, g, b] = hexRGB(hex);
    for (let layer = 0; layer < 3; layer++) {
      const cr  = maxR[layer];
      const gr  = cr * glowMult[layer];
      const dim = Math.ceil(gr * 2 + 4);
      const cx  = dim / 2;
      const oc  = document.createElement('canvas');
      oc.width = oc.height = dim;
      const octx = oc.getContext('2d');

      // Radial glow halo
      const grd = octx.createRadialGradient(cx, cx, 0, cx, cx, gr);
      grd.addColorStop(0,   `rgba(${r},${g},${b},0.85)`);
      grd.addColorStop(0.3, `rgba(${r},${g},${b},0.30)`);
      grd.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      octx.fillStyle = grd;
      octx.beginPath();
      octx.arc(cx, cx, gr, 0, Math.PI * 2);
      octx.fill();

      // Sharp core
      octx.fillStyle = `rgba(${r},${g},${b},1)`;
      octx.beginPath();
      octx.arc(cx, cx, cr, 0, Math.PI * 2);
      octx.fill();

      byLayer[layer][ci] = oc;
    }
  });

  // Four-point sparkle glint (two crossing gradient lines)
  const ss  = 32;
  const sc  = document.createElement('canvas');
  sc.width  = sc.height = ss;
  const scx = ss / 2;
  const sctx = sc.getContext('2d');
  [0, 90, 45, 135].forEach(deg => {
    const rad = deg * Math.PI / 180;
    const len = ss / 2 - 1;
    const ex  = Math.cos(rad), ey = Math.sin(rad);
    const grd = sctx.createLinearGradient(
      scx - ex * len, scx - ey * len,
      scx + ex * len, scx + ey * len
    );
    grd.addColorStop(0,   'rgba(255,248,240,0)');
    grd.addColorStop(0.5, 'rgba(255,248,240,1)');
    grd.addColorStop(1,   'rgba(255,248,240,0)');
    sctx.save();
    sctx.strokeStyle = grd;
    sctx.lineWidth = 1.5;
    sctx.beginPath();
    sctx.moveTo(scx - ex * len, scx - ey * len);
    sctx.lineTo(scx + ex * len, scx + ey * len);
    sctx.stroke();
    sctx.restore();
  });

  // Shared cyan dust sprite: soft halo and a tiny bright core.
  const dust = document.createElement('canvas'); dust.width = dust.height = 24;
  const dc = dust.getContext('2d');
  const [dr, dg, db] = hexRGB(SFCFG.SHOOT_COLOR);
  const glow = dc.createRadialGradient(12, 12, 0, 12, 12, 12);
  glow.addColorStop(0, SFCFG.SHOOT_CORE_COLOR);
  glow.addColorStop(.12, `rgba(${dr},${dg},${db},.9)`);
  glow.addColorStop(.38, `rgba(${dr},${dg},${db},.2)`);
  glow.addColorStop(1, `rgba(${dr},${dg},${db},0)`);
  dc.fillStyle = glow; dc.fillRect(0, 0, 24, 24);
  return { byLayer, sparkle: sc, dust, maxR };
}


// ═══════════════════════════════════════════════════════════════════
//  CLASS: Star
// ═══════════════════════════════════════════════════════════════════
class Star {
  constructor(W, H, layer, sprites) {
    const C = SFCFG;
    this.layer = layer;
    this.sp    = sprites;
    this.x     = rand(0, W);
    this.y     = rand(0, H);

    // Size and base opacity scale with layer depth
    if (layer === 0) {
      this.radius = rand(0.5, 1.0);
      this.baseOp = rand(0.20, 0.55);
    } else if (layer === 1) {
      this.radius = rand(0.8, 1.5);
      this.baseOp = rand(0.40, 0.75);
    } else {
      this.radius = rand(1.2, 2.5);
      this.baseOp = rand(0.60, 1.00);
    }

    // Color: 65% white, rest spread across palette
    this.ci = Math.random() < 0.65 ? 0 : randI(0, C.STAR_COLORS.length - 1);
    // Scale sprite to this star's radius vs the sprite's max radius
    this.sc = this.radius / sprites.maxR[layer];

    // Twinkle
    this.twPhase = rand(0, Math.PI * 2);
    this.twRate  = (Math.PI * 2) / rand(C.TWINKLE_PERIOD_MIN, C.TWINKLE_PERIOD_MAX);

    // Parallax offset (eased toward target each frame)
    this.ox = 0;
    this.oy = 0;

    // Sparkle state (only near-layer stars, random eligibility)
    this.canSparkle = layer === 2 && Math.random() < C.SPARKLE_RATIO;
    this.sparkling  = false;
    this.sparkT     = 0;    // 0 → 1 → 0 over one glint
    this.sparkDir   = 1;
    this.sparkCD    = this.canSparkle
      ? rand(C.SPARKLE_INTERVAL_MIN, C.SPARKLE_INTERVAL_MAX)
      : Infinity;

    // Per-frame additive brightness boosts
    this.regrowBoost  = 0;  // set by shooting star proximity
    this.cursorBoost  = 0;  // set by mouse proximity
    this.sfBoost      = 0;  // set by Starfall wash

    this.drawOp = this.baseOp;
  }

  update(dt, nmx, nmy, reduced) {
    const C = SFCFG;

    // Twinkle (slow to a crawl under prefers-reduced-motion)
    this.twPhase += this.twRate * dt * (reduced ? 0.04 : 1);
    const tOp = lerp(
      C.TWINKLE_OPACITY_MIN,
      C.TWINKLE_OPACITY_MAX,
      0.5 + 0.5 * Math.sin(this.twPhase)
    );

    // Sparkle countdown and animation
    if (this.canSparkle && !reduced) {
      if (!this.sparkling) {
        this.sparkCD -= dt;
        if (this.sparkCD <= 0) {
          this.sparkling = true;
          this.sparkT    = 0;
          this.sparkDir  = 1;
        }
      } else {
        this.sparkT += this.sparkDir * dt / (C.SPARKLE_DURATION / 2);
        if (this.sparkT >= 1) {
          this.sparkT   = 1;
          this.sparkDir = -1;
        }
        if (this.sparkT <= 0 && this.sparkDir < 0) {
          this.sparkling = false;
          this.sparkT    = 0;
          this.sparkCD   = rand(C.SPARKLE_INTERVAL_MIN, C.SPARKLE_INTERVAL_MAX);
        }
      }
    }

    // Regrow boost decays linearly back to 0
    if (this.regrowBoost > 0)
      this.regrowBoost = Math.max(0, this.regrowBoost - dt / C.SHOOT_REGROW_DUR);

    // Parallax: lerp offset toward (mouseNorm - 0.5) × layerAmount
    const pAmt = [C.PARALLAX_FAR, C.PARALLAX_MID, C.PARALLAX_NEAR][this.layer];
    this.ox   += ((nmx - 0.5) * 2 * pAmt - this.ox) * C.PARALLAX_EASE;
    this.oy   += ((nmy - 0.5) * 2 * pAmt - this.oy) * C.PARALLAX_EASE;

    // Final draw opacity: base × twinkle × boost + starfall ambient lift
    const boost = clamp(this.regrowBoost + this.cursorBoost, 0, 0.8);
    this.drawOp = clamp(
      this.baseOp * tOp * (1 + boost) + this.sfBoost * C.STARFALL_BOOST,
      0, 1
    );
  }

  draw(ctx) {
    const px = this.x + this.ox;
    const py = this.y + this.oy;
    const sp = this.sp.byLayer[this.layer][this.ci];
    if (!sp) return;

    const sw = sp.width  * this.sc;
    const sh = sp.height * this.sc;

    ctx.globalAlpha = this.drawOp;
    ctx.drawImage(sp, px - sw / 2, py - sh / 2, sw, sh);

    // Four-point sparkle glint
    if (this.sparkling && this.sparkT > 0) {
      const gsp = this.sp.sparkle;
      ctx.globalAlpha = this.sparkT * this.drawOp;
      ctx.drawImage(gsp, px - gsp.width / 2, py - gsp.height / 2);
    }

    ctx.globalAlpha = 1;
  }
}


// ═══════════════════════════════════════════════════════════════════
//  CLASS: ShootingStar
//  The path is parameterised through a "through point" so that for
//  click-spawned stars the click coordinates land on the trajectory.
// ═══════════════════════════════════════════════════════════════════
class ShootingStar {
  constructor(throughX, throughY, angleDeg, goRight, trailLen, duration, brightness, cW, cH) {
    const rad = angleDeg * Math.PI / 180;
    this.dx   = (goRight ? 1 : -1) * Math.cos(rad);
    this.dy   = Math.sin(rad);

    this.trail = trailLen;
    this.dur   = duration;
    this.brite = brightness;

    // Total path long enough to fully enter and exit the viewport
    const margin    = trailLen + 80;
    this.totalLen   = Math.sqrt(cW * cW + cH * cH) + margin * 2;
    this.startX     = throughX - this.dx * this.totalLen * 0.5;
    this.startY     = throughY - this.dy * this.totalLen * 0.5;

    this.t    = 0;
    this.done = false;
    this.dustCarry = 0;
  }

  get headX() { return this.startX + this.dx * this.totalLen * this.t; }
  get headY() { return this.startY + this.dy * this.totalLen * this.t; }

  // Opacity envelope: ramp in over first 10%, ramp out over last 12%
  envelope(t) {
    if (t < 0.10) return t / 0.10;
    if (t > 0.88) return (1 - t) / 0.12;
    return 1;
  }

  update(dt, stars, particles) {
    const C  = SFCFG;
    const previousX = this.headX, previousY = this.headY;
    this.t  += dt / this.dur;
    if (this.t >= 1) { this.t = 1; this.done = true; }

    const hx  = this.headX, hy = this.headY;
    const rr2 = C.SHOOT_REGROW_RADIUS * C.SHOOT_REGROW_RADIUS;

    // Flare nearby stars (regrow effect)
    for (const s of stars) {
      const ddx = s.x + s.ox - hx;
      const ddy = s.y + s.oy - hy;
      if (ddx * ddx + ddy * ddy < rr2)
        s.regrowBoost = Math.max(s.regrowBoost, 1);
    }

    // Sample the travelled segment so fast stars leave a continuous dust wake.
    if (this.t > .05 && this.t < .95) {
      this.dustCarry += dt * C.SHOOT_DUST_RATE * this.brite;
      const count = Math.floor(this.dustCarry); this.dustCarry -= count;
      for (let i = 0; i < count && particles.length < C.SHOOT_DUST_MAX; i++) {
        const f = (i + Math.random()) / count, spread = rand(-3, 3);
        const x = lerp(previousX, hx, f) - this.dx * rand(0, 12) - this.dy * spread;
        const y = lerp(previousY, hy, f) - this.dy * rand(0, 12) + this.dx * spread;
        if (x >= -24 && x <= window.innerWidth + 24 && y >= -24 && y <= window.innerHeight + 24)
          particles.push(new Particle(x, y, -this.dx, -this.dy));
      }
    }
  }

  draw(ctx) {
    const op = clamp(this.envelope(this.t) * this.brite, 0, 1);
    if (op < 0.01) return;

    const hx      = this.headX, hy = this.headY;
    const trailPx = this.trail * op;   // trail shrinks as star fades
    const tx      = hx - this.dx * trailPx;
    const ty      = hy - this.dy * trailPx;

    // Skip degenerate gradient (head and tail at same pixel)
    if (trailPx < 1) return;

    const [r, g, b] = hexRGB(SFCFG.SHOOT_COLOR);
    const [hr, hgColor, hb] = hexRGB(SFCFG.SHOOT_CORE_COLOR);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    try {
      // Tapered cyan gradient trail
      const tg = ctx.createLinearGradient(hx, hy, tx, ty);
      tg.addColorStop(0,    `rgba(${hr},${hgColor},${hb},${op})`);
      tg.addColorStop(0.25, `rgba(${r},${g},${b},${(op * 0.75).toFixed(3)})`);
      tg.addColorStop(1,    `rgba(${r},${g},${b},0)`);
      ctx.strokeStyle = tg;
      ctx.lineWidth   = clamp(1.4 * this.brite, 0.8, 2.5);
      ctx.lineCap     = 'round';
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    } catch (_) {}

    try {
      // Bright head glow
      const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, 7);
      hg.addColorStop(0,   `rgba(${hr},${hgColor},${hb},${op})`);
      hg.addColorStop(0.4, `rgba(${r},${g},${b},${(op * 0.6).toFixed(3)})`);
      hg.addColorStop(1,   `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(hx, hy, 7, 0, Math.PI * 2);
      ctx.fill();
    } catch (_) {}

    ctx.restore();
  }
}


// ═══════════════════════════════════════════════════════════════════
//  CLASS: Particle — glittering dust left in a shooting star's wake
// ═══════════════════════════════════════════════════════════════════
class Particle {
  constructor(x, y, driftX = 0, driftY = 0) {
    this.x  = x;
    this.y  = y;
    const spd = rand(3, 14), dir = rand(0, Math.PI * 2);
    this.vx   = Math.cos(dir) * spd + driftX * rand(4, 12);
    this.vy   = Math.sin(dir) * spd + driftY * rand(4, 12);
    this.life = 1;
    this.decay = rand(.32, .55); // dust lingers for roughly 2–3 seconds
    this.r    = rand(.7, 1.7);
    this.done = false;
  }

  update(dt) {
    this.x  += this.vx * dt;
    this.y  += this.vy * dt;
    this.vy += 3 * dt;                         // gentle gravity
    const drag = Math.pow(0.92, dt * 60);       // frame-rate-independent drag
    this.vx   *= drag;
    this.vy   *= drag;
    this.life -= this.decay * dt;
    if (this.life <= 0) { this.life = 0; this.done = true; }
  }

  draw(ctx, sprite) {
    ctx.globalAlpha = Math.pow(this.life, 1.5);
    const size = this.r * 8;
    ctx.drawImage(sprite, this.x - size / 2, this.y - size / 2, size, size);
    ctx.globalAlpha = 1;
  }
}


// ═══════════════════════════════════════════════════════════════════
//  MAIN SKY MODULE
// ═══════════════════════════════════════════════════════════════════
(function StarfallSky() {
  const C = SFCFG;
  let canvas, ctx, dpr = 1;
  let W = 0, H = 0;
  let sprites;
  let stars = [], shooters = [], particles = [];
  // Stars pre-grouped by layer for fast layer-ordered rendering
  let starsByLayer = [[], [], []];
  let paused  = false, rafId = null, lastTs = 0;
  let reduced = false;

  // Mouse: normalized (0–1) and pixel position
  const mouse = { nx: 0.5, ny: 0.5, cx: -9999, cy: -9999 };

  // Starfall wash state
  let sfActive = false, sfWashT = 0;
  let sfWashPhase = 'off'; // 'in' | 'hold' | 'out' | 'off'
  let sfTimer = null;

  // ── Init ───────────────────────────────────────────────────────
  function init() {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.matchMedia('(prefers-reduced-motion: reduce)')
      .addEventListener('change', e => { reduced = e.matches; });

    canvas = document.createElement('canvas');
    canvas.id = 'starfall-canvas';
    document.body.prepend(canvas);
    ctx = canvas.getContext('2d');

    sprites = buildSprites();
    onResize();

    window.addEventListener('resize', onResize);
    document.addEventListener('mousemove',   onMouseMove,  { passive: true });
    document.addEventListener('touchmove',   onTouchMove,  { passive: true });
    document.addEventListener('click',       onClick);
    document.addEventListener('touchstart',  onTouchStart, { passive: true });
    document.addEventListener('visibilitychange', onVisChange);

    scheduleStarfall();
    rafId = requestAnimationFrame(loop);
  }

  // ── Canvas / starfield setup ───────────────────────────────────
  function onResize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W   = window.innerWidth;
    H   = window.innerHeight;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width  = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // reset transform + apply dpr scale
    rebuildStars();
  }

  function rebuildStars() {
    const n = clamp(
      Math.round(C.STAR_COUNT_BASE * (W * H) / (1920 * 1080)),
      C.STAR_COUNT_MIN, C.STAR_COUNT_MAX
    );
    stars = [];
    starsByLayer = [[], [], []];
    C.LAYER_RATIOS.forEach((ratio, layer) => {
      const count = Math.round(n * ratio);
      for (let i = 0; i < count; i++) {
        const s = new Star(W, H, layer, sprites);
        stars.push(s);
        starsByLayer[layer].push(s);
      }
    });
  }

  // ── Input handlers ─────────────────────────────────────────────
  function onMouseMove(e) {
    mouse.nx = e.clientX / W;
    mouse.ny = e.clientY / H;
    mouse.cx = e.clientX;
    mouse.cy = e.clientY;
  }

  function onTouchMove(e) {
    if (!e.touches.length) return;
    const t  = e.touches[0];
    mouse.nx = t.clientX / W;
    mouse.ny = t.clientY / H;
    mouse.cx = t.clientX;
    mouse.cy = t.clientY;
  }

  function onTouchStart(e) {
    if (!e.touches.length || reduced) return;
    const t = e.touches[0];
    spawnShooterAt(t.clientX, t.clientY, e.target);
  }

  function onClick(e) {
    if (reduced) return;
    spawnShooterAt(e.clientX, e.clientY, e.target);
  }

  function spawnShooterAt(cx, cy, target) {
    if (shooters.filter(s => !s.done).length >= C.SHOOT_MAX) return;
    // Do not spawn when user clicked a real interactive element
    if (target?.closest('a, button, input, select, textarea, label, [data-no-star]')) return;

    shooters.push(new ShootingStar(
      cx, cy,
      rand(C.SHOOT_ANGLE_MIN, C.SHOOT_ANGLE_MAX),
      Math.random() < 0.5,
      rand(C.SHOOT_TRAIL_MIN, C.SHOOT_TRAIL_MAX),
      rand(C.SHOOT_DURATION_MIN, C.SHOOT_DURATION_MAX),
      1,
      W, H
    ));
  }

  function onVisChange() {
    paused = document.hidden;
    if (!paused && !rafId) { lastTs = 0; rafId = requestAnimationFrame(loop); }
  }

  // ── Starfall ───────────────────────────────────────────────────
  function scheduleStarfall() {
    clearTimeout(sfTimer);
    sfTimer = setTimeout(triggerStarfall, C.STARFALL_INTERVAL * 1000);
  }

  function triggerStarfall() {
    if (sfActive || document.hidden || reduced) { scheduleStarfall(); return; }

    sfActive      = true;
    sfWashPhase   = 'in';
    sfWashT       = 0;
    scheduleStarfall(); // Schedule from this start, not from the end of the wash.

    const count   = randI(C.STARFALL_COUNT_MIN, C.STARFALL_COUNT_MAX);
    const baseAng = C.STARFALL_ANGLE_BASE + rand(-C.STARFALL_ANGLE_VAR, C.STARFALL_ANGLE_VAR);
    const goRight = Math.random() < 0.5;

    for (let i = 0; i < count; i++) {
      const delay = (i / count) * C.STARFALL_SPREAD * 1000;
      const angle = baseAng + rand(-C.STARFALL_ANGLE_VAR * 0.5, C.STARFALL_ANGLE_VAR * 0.5);
      // "Through" point spread across the upper portion of the screen
      const tx    = rand(W * 0.10, W * 0.90);
      const ty    = rand(H * 0.04, H * C.STARFALL_Y_FRAC);

      setTimeout(() => {
        if (!sfActive) return;
        shooters.push(new ShootingStar(
          tx, ty, angle, goRight,
          rand(C.SHOOT_TRAIL_MIN * 1.2, C.SHOOT_TRAIL_MAX * 1.6),
          rand(C.SHOOT_DURATION_MIN * 0.85, C.SHOOT_DURATION_MAX * 1.15),
          rand(0.25, 1.0),
          W, H
        ));
      }, delay);
    }

    const washInMs   = C.STARFALL_WASH_IN   * 1000;
    const washHoldMs = C.STARFALL_WASH_HOLD  * 1000;
    const washOutMs  = C.STARFALL_WASH_OUT   * 1000;

    setTimeout(() => { sfWashPhase = 'hold'; }, washInMs);
    setTimeout(() => { sfWashPhase = 'out';  }, washInMs + washHoldMs);
    setTimeout(() => {
      sfWashPhase = 'off';
      sfWashT     = 0;
      sfActive    = false;
      sparkleWave();
    }, washInMs + washHoldMs + washOutMs);
  }

  // Wave of sparkle glints across all eligible stars after Starfall ends
  function sparkleWave() {
    starsByLayer[2].filter(s => s.canSparkle).forEach(s => {
      setTimeout(() => {
        s.sparkling = true;
        s.sparkT    = 0;
        s.sparkDir  = 1;
      }, (s.x / W) * 1200); // wave sweeps left → right over 1.2s
    });
  }

  // ── Render frame ───────────────────────────────────────────────
  function draw(dt) {
    // Advance Starfall wash
    const washRates = { in: 1/C.STARFALL_WASH_IN, hold: 0, out: -1/C.STARFALL_WASH_OUT, off: 0 };
    sfWashT = clamp(sfWashT + (washRates[sfWashPhase] ?? 0) * dt, 0, 1);

    // Update star boosts from external sources
    for (const s of stars) {
      s.sfBoost = sfWashT;
      const dx  = s.x + s.ox - mouse.cx;
      const dy  = s.y + s.oy - mouse.cy;
      const d2  = dx * dx + dy * dy;
      const cr  = C.CURSOR_RADIUS;
      s.cursorBoost = d2 < cr * cr
        ? (1 - Math.sqrt(d2) / cr) * C.CURSOR_BOOST
        : 0;
    }

    // Update all objects
    for (const s  of stars)    s.update(dt, mouse.nx, mouse.ny, reduced);
    for (let i = shooters.length - 1; i >= 0; i--) {
      shooters[i].update(dt, stars, particles);
      if (shooters[i].done) shooters.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      particles[i].update(dt);
      if (particles[i].done) particles.splice(i, 1);
    }

    // ── Draw ────────────────────────────────────────────────────

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.BG_TOP);
    bg.addColorStop(1, C.BG_BOTTOM);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Nebula haze (top-right corner)
    if (C.NEBULA_OPACITY > 0) {
      const [nr, ng, nb] = hexRGB(C.NEBULA_COLOR);
      const nr2  = Math.min(W, H) * 0.55;
      const nGrd = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, nr2);
      nGrd.addColorStop(0, `rgba(${nr},${ng},${nb},${C.NEBULA_OPACITY})`);
      nGrd.addColorStop(1, `rgba(${nr},${ng},${nb},0)`);
      ctx.fillStyle = nGrd;
      ctx.fillRect(0, 0, W, H);
    }

    // Starfall violet/gold wash at top of sky
    if (sfWashT > 0) {
      const w = ctx.createLinearGradient(0, 0, 0, H * 0.45);
      w.addColorStop(0,   `rgba(70,30,110,${(sfWashT * 0.16).toFixed(3)})`);
      w.addColorStop(0.5, `rgba(50,20,90,${(sfWashT * 0.07).toFixed(3)})`);
      w.addColorStop(1,   'rgba(40,15,80,0)');
      ctx.fillStyle = w;
      ctx.fillRect(0, 0, W, H * 0.45);
    }

    // Stars: far → mid → near (back to front)
    for (let layer = 0; layer < 3; layer++) {
      for (const s of starsByLayer[layer]) s.draw(ctx);
    }

    // Shooting stars
    for (const sh of shooters) sh.draw(ctx);

    // Dust particles
    for (const p of particles) p.draw(ctx, sprites.dust);
  }

  // ── Animation loop ──────────────────────────────────────────────
  function loop(ts) {
    if (paused) { rafId = null; return; }
    rafId = requestAnimationFrame(loop);
    const dt = lastTs === 0 ? 0 : Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    if (dt > 0) draw(dt);
  }

  // Auto-start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
