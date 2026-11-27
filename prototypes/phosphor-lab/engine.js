(function installPhosphorEngine() {
  'use strict';

  const TAU = Math.PI * 2;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const LAYERS = 14;
  const INKS = 7;

  function makeNoise(seed) {
    const perm = new Uint8Array(512);
    let bits = (Math.trunc(seed) || 1) >>> 0;
    const next = () => {
      bits = (Math.imul(bits, 1664525) + 1013904223) >>> 0;
      return bits / 4294967296;
    };
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i; i--) {
      const j = Math.floor(next() * (i + 1));
      [perm[i], perm[j]] = [perm[j], perm[i]];
    }
    perm.set(perm.subarray(0, 256), 256);
    function field(x, y, z) {
      const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
      const a = perm[ix & 255] + (iy & 255), b = perm[(ix + 1) & 255] + (iy & 255);
      const c = perm[a] + (iz & 255), d = perm[a + 1] + (iz & 255);
      const e = perm[b] + (iz & 255), f = perm[b + 1] + (iz & 255);
      return lerp(lerp(lerp(perm[c], perm[e], u), lerp(perm[d], perm[f], u), v),
        lerp(lerp(perm[c + 1], perm[e + 1], u), lerp(perm[d + 1], perm[f + 1], u), v), w) / 127.5 - 1;
    }
    return { field, phase: next() * TAU };
  }

  // Fourth-order Runge–Kutta. The two wings share one continuous trajectory.
  function lorenz(seed) {
    let x = 0.12 + (seed % 7919) * 0.00003, y = 0.5, z = 1;
    const points = [], h = 0.011;
    const velocity = (a, b, c) => [10 * (b - a), a * (28 - c) - b, a * b - 8 * c / 3];
    for (let i = 0; i < 6500; i++) {
      const a = velocity(x, y, z);
      const b = velocity(x + a[0] * h / 2, y + a[1] * h / 2, z + a[2] * h / 2);
      const c = velocity(x + b[0] * h / 2, y + b[1] * h / 2, z + b[2] * h / 2);
      const d = velocity(x + c[0] * h, y + c[1] * h, z + c[2] * h);
      x += h * (a[0] + 2 * b[0] + 2 * c[0] + d[0]) / 6;
      y += h * (a[1] + 2 * b[1] + 2 * c[1] + d[1]) / 6;
      z += h * (a[2] + 2 * b[2] + 2 * c[2] + d[2]) / 6;
      if (i >= 450) points.push([x / 14.5, (z - 25) / 18.5, y / 63]);
    }
    return points;
  }

  function buffer() {
    const el = document.createElement('canvas');
    return { el, ctx: el.getContext('2d') };
  }

  function resize(surface, w, h) {
    if (surface.el.width !== w) surface.el.width = w;
    if (surface.el.height !== h) surface.el.height = h;
  }

  function palette(hex) {
    const n = parseInt(hex.slice(1), 16);
    const rgb = [n >> 16, (n >> 8) & 255, n & 255];
    const base = [6, 14, 13];
    const mix = weight => 'rgb(' + rgb.map((channel, i) => Math.round(lerp(base[i], channel, weight))).join(',') + ')';
    return {
      ink: Array.from({ length: INKS }, (_, k) => {
        const value = (k + 1) / INKS;
        const highlight = 0.35 * value ** 7;
        return 'rgb(' + rgb.map((channel, i) => Math.round(lerp(base[i],
          lerp(channel, 255, highlight), value ** 0.94))).join(',') + ')';
      }),
      fill: mix(0.021),
      rib: mix(0.17),
    };
  }

  function newPaths() {
    return Array.from({ length: LAYERS }, () => ({
      surface: new Path2D(), wires: Array.from({ length: INKS }, () => new Path2D()), ribs: new Path2D(),
    }));
  }

  function create(canvas) {
    const context = canvas.getContext('2d', { alpha: false });
    const signal = buffer(), history = buffer(), display = buffer(), halo = buffer(), sample = buffer();
    const mask = buffer(), backdrop = buffer();
    let currentSeed, noise, attractor, currentColor, inks;
    let lastKey = '', backgroundKey = '', maskKey = '', lastTime = NaN, destroyed = false;
    let width = 1, height = 1, dpr = 1, size = 1, xGain = 1, yGain = 1;
    let lastFrame = '', backingWidth = 0, backingHeight = 0;
    const rings = [], centers = [];
    let az = 0, bz = 1, ax = 0, bx = 1, ay = 0, by = 1;

    function camera(roll, pitch, yaw) {
      az = Math.sin(roll); bz = Math.cos(roll);
      ax = Math.sin(pitch); bx = Math.cos(pitch);
      ay = Math.sin(yaw); by = Math.cos(yaw);
    }

    function rotate(x, y, z, target) {
      const xx = by * x + ay * z, zz = -ay * x + by * z;
      const yy = bx * y - ax * zz;
      target[0] = bz * xx - az * yy;
      target[1] = az * xx + bz * yy;
      target[2] = ax * y + bx * zz;
      return target;
    }

    function project(x, y, z, target) {
      rotate(x, y, z, target);
      const f = size / (1 - target[2] * 0.072);
      target[0] = width * 0.5 + target[0] * f * xGain;
      target[1] = height * 0.477 - target[1] * f * yGain;
      return target;
    }

    function tube(state, time, small) {
      const { shape, complexity, scale, noise: amplitude } = state;
      const phase = noise.phase, t = time * 0.4, divisions = small ? 116 : 208;
      const count = Math.round((small ? 23 : 45) + complexity * (small ? 0.65 : 1.8));
      const harmonic = shape === 'harmonic', rose = shape === 'rose';
      const pulses = Math.round(complexity * 0.48) + 1;
      const petals = 2 * Math.round(complexity / 4) + 1;
      if (harmonic) camera(-0.15, -0.09 + 0.12 * Math.sin(t * 0.24), 0.20 + 0.28 * Math.sin(t * 0.22));
      else if (rose) camera(0.18 + t * 0.07, 0.35 + 0.17 * Math.sin(t * 0.3), 0.18 * Math.sin(t * 0.26));
      else camera(-1.33 + 0.34 * Math.sin(t * 0.19), -0.53 + 0.17 * Math.sin(t * 0.37), -0.28 + 0.22 * Math.sin(t * 0.29));

      for (let i = 0; i < divisions; i++) {
        const a = TAU * i / divisions;
        let x, y, z;
        if (harmonic) {
          x = 1.12 * Math.sin(2 * a + 0.42 + 0.28 * Math.sin(t * 0.34));
          y = 0.88 * Math.sin(pulses * a + 0.3);
          z = 0.62 * Math.cos(a + 0.23 * Math.sin(t * 0.45));
        } else if (rose) {
          const r = 1.22 * Math.cos(petals * a + 0.12 * Math.cos(t * 0.4));
          x = r * Math.cos(a); y = r * Math.sin(a);
          z = 0.23 * Math.sin(petals * a) + 0.10 * Math.cos(2 * a + t * 0.23);
        } else {
          const beat = 3 * a + 0.17 * Math.sin(t * 0.32);
          const r = 0.84 + (0.40 + 0.06 * Math.cos(t * 0.4)) * Math.cos(beat);
          x = r * Math.cos(2 * a); y = r * Math.sin(2 * a); z = 0.62 * Math.sin(beat);
        }
        const f = 0.80 * scale;
        const p = centers[i] || (centers[i] = []);
        p[0] = x + 0.34 * amplitude * noise.field(x * f, y * f + 1.2, z * f + t * 0.27);
        p[1] = y + 0.30 * amplitude * noise.field(y * f, z * f + 4.9, x * f + t * 0.25);
        p[2] = z + 0.38 * amplitude * noise.field(z * f, x * f - 2.1, y * f + t * 0.21);
      }

      const normal = [], coord = [];
      for (let i = 0; i < divisions; i++) {
        const a = i * TAU / divisions, p = centers[i], prev = centers[(i + divisions - 1) % divisions], next = centers[(i + 1) % divisions];
        let tx = next[0] - prev[0], ty = next[1] - prev[1], tz = next[2] - prev[2];
        const l = Math.hypot(tx, ty, tz) || 1; tx /= l; ty /= l; tz /= l;
        const flat = Math.hypot(tx, ty) || 1, nx = -ty / flat, ny = tx / flat;
        const b0 = -tz * ny, b1 = tz * nx, b2 = tx * ny - ty * nx;
        const ring = rings[i] || (rings[i] = { data: new Float32Array(4 * 72), left: 0, right: 0, depth: 0 });
        const radius = (rose ? 0.092 : harmonic ? 0.149 : 0.221) * (1 + 0.20 * Math.cos(3 * a - t * 0.28));
        const twist = a * 2 + (0.20 + 0.06 * complexity) * Math.sin(pulses * a - t * 0.61) + t * 0.1;
        const tangent = rotate(tx, ty, tz, normal);
        const sx = tangent[1] * yGain, sy = tangent[0] * xGain;
        let min = Infinity, max = -Infinity;
        ring.depth = rotate(p[0], p[1], p[2], normal)[2];
        const localLight = clamp(0.75 + ring.depth * 0.23 + 0.08 * Math.sin(2 * a - t * 0.63 + phase), 0.34, 1.04);
        for (let j = 0; j < count; j++) {
          const angle = TAU * j / count + twist;
          const c = Math.cos(angle), s = Math.sin(angle);
          const vx = nx * c + b0 * s, vy = ny * c + b1 * s, vz = b2 * s;
          project(p[0] + radius * vx, p[1] + radius * vy, p[2] + radius * vz, coord);
          rotate(vx, vy, vz, normal);
          const reflection = Math.max(0, -0.38 * normal[0] + 0.50 * normal[1] + 0.78 * normal[2]);
          const light = (0.36 + normal[2] * 0.30 + 0.50 * reflection ** 3) * localLight;
          const k = j * 4;
          ring.data[k] = coord[0]; ring.data[k + 1] = coord[1]; ring.data[k + 2] = normal[2];
          ring.data[k + 3] = clamp(Math.round(light * (INKS - 1) + (j % 11 === 0 ? 1 : 0)), 0, INKS - 1);
          const side = coord[0] * sx + coord[1] * sy;
          if (side < min) { min = side; ring.left = k; }
          if (side > max) { max = side; ring.right = k; }
        }
      }

      const layers = newPaths();
      for (let i = 0; i < divisions; i++) {
        const a = rings[i], b = rings[(i + 1) % divisions], v = a.data, w = b.data;
        const band = layers[clamp(Math.floor((a.depth + 1.5) * LAYERS / 3), 0, LAYERS - 1)];
        const fill = band.surface;
        fill.moveTo(v[a.left], v[a.left + 1]); fill.lineTo(w[b.left], w[b.left + 1]);
        fill.lineTo(w[b.right], w[b.right + 1]); fill.lineTo(v[a.right], v[a.right + 1]); fill.closePath();
        for (let j = 0; j < count; j++) {
          const k = j * 4;
          if (v[k + 2] + w[k + 2] < -0.13) continue;
          const path = band.wires[v[k + 3]];
          path.moveTo(v[k], v[k + 1]); path.lineTo(w[k], w[k + 1]);
          if (i % 19 === 0) {
            const n = (j + 1) % count * 4;
            band.ribs.moveTo(v[k], v[k + 1]); band.ribs.lineTo(v[n], v[n + 1]);
          }
        }
      }
      const ctx = signal.ctx;
      ctx.lineCap = 'round';
      const stroke = (small ? 0.43 : Math.max(0.74, Math.min(width, height) / 630)) *
        (0.82 + Math.sqrt(state.pitch) * 0.105) * (state.screen === 'scope' ? 1 : 1.25);
      for (const band of layers) {
        ctx.fillStyle = inks.fill;
        ctx.fill(band.surface);
        ctx.lineWidth = stroke * 0.52; ctx.strokeStyle = inks.rib; ctx.stroke(band.ribs);
        for (let k = 0; k < INKS; k++) {
          ctx.lineWidth = stroke * (k >= INKS - 2 ? 1.19 : 1);
          ctx.strokeStyle = inks.ink[k];
          ctx.stroke(band.wires[k]);
        }
      }
    }

    function wave(state, time, small) {
      const t = time * 0.65, amount = small ? 32 : Math.round(46 + state.complexity * 2.6), segments = small ? 96 : 156;
      camera(-0.11, 0.58 + 0.05 * Math.sin(t * 0.17), 0.25 + 0.12 * Math.cos(t * 0.14));
      const ctx = signal.ctx, coord = [];
      let back = new Float32Array((segments + 1) * 2), front = new Float32Array(back.length);
      ctx.lineCap = 'round';
      ctx.lineWidth = (small ? 0.69 : Math.max(1.23, Math.min(width, height) / 490)) *
        (0.78 + 0.14 * Math.sqrt(state.pitch));
      // Project the far edge first. The next strip masks any lines hidden by its crest.
      for (let row = 0; row < amount; row++) {
        const v = 1 - row / (amount - 1) * 2, extent = 1 - 0.12 * v ** 4;
        for (let i = 0; i <= segments; i++) {
          const u = (i / segments * 2 - 1) * extent;
          const r = Math.hypot(u + 0.14, v - 0.16);
          const z = 0.50 * Math.cos(r * (5.0 + state.complexity * 0.62) - t) * Math.exp(-1.6 * r * r) +
            0.14 * Math.sin(u * 3.2 + v * 2.1 - t * 0.40) +
            0.30 * state.noise * noise.field(u * state.scale, v * state.scale, t * 0.22);
          project(u * 1.36, v * 0.28 + z, -v * 0.86, coord);
          front[2 * i] = coord[0]; front[2 * i + 1] = coord[1];
        }
        ctx.beginPath();
        ctx.moveTo(front[0], front[1]);
        for (let i = 2; i < front.length; i += 2) ctx.lineTo(front[i], front[i + 1]);
        if (row) {
          for (let i = back.length - 2; i >= 0; i -= 2) ctx.lineTo(back[i], back[i + 1]);
          ctx.closePath(); ctx.fillStyle = inks.fill; ctx.fill();
          ctx.beginPath();
          for (let i = 0; i <= segments; i += small ? 15 : 12) {
            ctx.moveTo(back[i * 2], back[i * 2 + 1]); ctx.lineTo(front[i * 2], front[i * 2 + 1]);
          }
          ctx.strokeStyle = inks.rib; ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(front[0], front[1]);
        for (let i = 2; i < front.length; i += 2) ctx.lineTo(front[i], front[i + 1]);
        const light = 0.46 + 0.34 * (0.5 + 0.5 * Math.sin(row / amount * 2.9 + t * 0.18)) + (row % 8 === 0 ? 0.13 : 0);
        ctx.strokeStyle = inks.ink[Math.min(INKS - 1, Math.floor(light * INKS))];
        ctx.stroke();
        const previous = back; back = front; front = previous;
      }
    }

    function butterfly(state, time, small) {
      if (!attractor) attractor = lorenz(currentSeed);
      camera(0.07, -0.16, 0.22 * Math.sin(time * 0.15));
      const total = Math.min(attractor.length, 1800 + Math.round(state.complexity * 340));
      const paths = Array.from({ length: INKS }, () => new Path2D()), stride = small ? 2 : 1;
      const coord = [];
      let prevX, prevY;
      for (let i = 0; i < total; i += stride) {
        const p = attractor[i], n = noise.field(p[0] * state.scale, p[1] * state.scale, time * 0.10);
        project(p[0] + n * state.noise * 0.20, p[1] + n * state.noise * 0.25, p[2], coord);
        const pulse = Math.max(0, Math.cos(i / 117 - time * 1.6));
        const k = clamp(Math.round(2.0 + coord[2] * 2.2 + pulse * 2.3 + i / total), 0, INKS - 1);
        if (i) { paths[k].moveTo(prevX, prevY); paths[k].lineTo(coord[0], coord[1]); }
        prevX = coord[0]; prevY = coord[1];
      }
      for (let i = 0; i < INKS; i++) {
        signal.ctx.lineWidth = (small ? 0.45 : 0.78) * (0.78 + 0.14 * Math.sqrt(state.pitch));
        signal.ctx.strokeStyle = inks.ink[i]; signal.ctx.stroke(paths[i]);
      }
    }

    function drawBackdrop(state, small) {
      const ctx = backdrop.ctx;
      const key = [width, height, dpr, state.screen, state.scan, currentColor].join('|');
      if (key === backgroundKey) return;
      backgroundKey = key;
      resize(backdrop, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wash = ctx.createRadialGradient(width * 0.49, height * 0.44, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.68);
      wash.addColorStop(0, '#101b18'); wash.addColorStop(0.58, '#0c1512'); wash.addColorStop(1, '#080e0c');
      ctx.fillStyle = wash; ctx.fillRect(0, 0, width, height);
      if (small) return;
      const gap = Math.max(30, Math.min(72, Math.round(Math.min(width, height) / 8)));
      const left = width / 2 % gap, top = height / 2 % gap;
      ctx.lineWidth = 0.6;
      ctx.strokeStyle = 'rgba(148,184,161,' + (0.065 + state.scan * 0.055) + ')';
      ctx.beginPath();
      for (let x = left; x < width; x += gap) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
      for (let y = top; y < height; y += gap) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(170,198,179,0.22)';
      for (let x = left; x < width; x += gap) for (let y = top; y < height; y += gap) {
        ctx.fillRect(x - 1, y, 2.5, 0.65); ctx.fillRect(x, y - 1, 0.65, 2.5);
      }
      ctx.fillStyle = 'rgba(176,200,185,0.25)';
      for (let x = left; x < width; x += gap / 5) ctx.fillRect(x, height / 2 - 1.3, 0.7, 2.6);
      for (let y = top; y < height; y += gap / 5) ctx.fillRect(width / 2 - 1.3, y, 2.6, 0.7);
    }

    function screenImage(state, small) {
      const ctx = display.ctx, w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      if (state.screen === 'scope') { ctx.drawImage(history.el, 0, 0); return; }
      const dot = state.screen === 'matrix';
      const px = Math.max(1, Math.round((small ? 0.44 : 1) * dpr * (1 + state.pitch * (dot ? 0.75 : 0.49))));
      const py = dot ? px : Math.max(1, Math.round(px * 1.26));
      resize(sample, Math.ceil(w / px), Math.ceil(h / py));
      sample.ctx.clearRect(0, 0, sample.el.width, sample.el.height);
      sample.ctx.imageSmoothingEnabled = true;
      sample.ctx.imageSmoothingQuality = 'medium';
      sample.ctx.drawImage(history.el, 0, 0, sample.el.width, sample.el.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(sample.el, 0, 0, sample.el.width * px, sample.el.height * py);
      const key = [px, py, dot, state.scan].join('|');
      if (key !== maskKey) {
        maskKey = key;
        resize(mask, px, py);
        const tile = mask.ctx;
        tile.clearRect(0, 0, px, py);
        if (dot) {
          tile.fillStyle = '#000'; tile.fillRect(0, 0, px, py);
          tile.globalCompositeOperation = 'destination-out';
          tile.beginPath(); tile.arc(px / 2, py / 2, Math.max(0.75, px * (0.47 - state.scan * 0.07)), 0, TAU);
          tile.fill(); tile.globalCompositeOperation = 'source-over';
        } else {
          tile.fillStyle = 'rgba(0,0,0,' + (0.38 + 0.58 * state.scan) + ')';
          tile.fillRect(0, py - Math.max(1, py * (0.10 + 0.34 * state.scan)), px, Math.max(1, py * 0.47));
        }
      }
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = ctx.createPattern(mask.el, 'repeat');
      ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over';
    }

    function render(state, seconds) {
      if (destroyed || !context || !Number.isFinite(seconds)) return;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0 && rect.height > 0)) return;
      width = rect.width; height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2, 2100 / width, 1550 / height);
      const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
      const small = width < 230 || height < 130;
      if (backingWidth !== w || backingHeight !== h || canvas.width !== w || canvas.height !== h) {
        backingWidth = canvas.width = w; backingHeight = canvas.height = h;
        for (const s of [signal, history, display]) resize(s, w, h);
        resize(halo, Math.max(1, Math.round(w / 8)), Math.max(1, Math.round(h / 8)));
        reset();
      }
      const frame = [seconds, width, height, state.shape, state.screen, state.seed, state.color, state.complexity,
        state.noise, state.scale, state.trail, state.glow, state.pitch, state.scan].join('|');
      if (frame === lastFrame) return;
      lastFrame = frame;
      if (currentSeed !== state.seed) { currentSeed = state.seed; noise = makeNoise(currentSeed); attractor = null; }
      if (currentColor !== state.color) { currentColor = state.color; inks = palette(currentColor); }
      const sig = signal.ctx;
      sig.setTransform(1, 0, 0, 1, 0, 0); sig.clearRect(0, 0, w, h);
      sig.setTransform(dpr, 0, 0, dpr, 0, 0);
      const key = [state.shape, state.screen, state.seed, state.color].join('|');
      const dt = seconds - lastTime;
      const continuous = key === lastKey && dt >= 0 && dt < 0.28;
      const wide = clamp((width / height - 1) * 1.4, 0, 1);
      xGain = 1 + 0.19 * wide;
      yGain = 1 - 0.10 * wide;
      const headroom = 1 + state.noise * 0.16;
      size = Math.min(width * (small ? 0.263 : 0.255), height * (small ? 0.272 : 0.273)) / headroom;
      if (state.shape === 'wave') {
        size *= 1.09; yGain *= 1.10;
        wave(state, seconds, small);
      }
      else if (state.shape === 'attractor') butterfly(state, seconds, small);
      else tube(state, seconds, small);
      drawBackdrop(state, small);
      const ph = history.ctx;
      if (state.trail > 0 && continuous && dt > 0) {
        ph.globalCompositeOperation = 'destination-out';
        const decay = 0.010 + Math.pow(state.trail, 2.3) * 0.42;
        ph.fillStyle = 'rgba(0,0,0,' + (1 - Math.exp(-dt / decay)) + ')';
        ph.fillRect(0, 0, w, h); ph.globalCompositeOperation = 'source-over';
      } else ph.clearRect(0, 0, w, h);
      ph.drawImage(signal.el, 0, 0);
      screenImage(state, small);
      context.drawImage(backdrop.el, 0, 0);
      context.globalCompositeOperation = 'screen';
      if (state.glow > 0) {
        const blur = halo.ctx;
        blur.clearRect(0, 0, halo.el.width, halo.el.height);
        blur.imageSmoothingQuality = 'medium';
        blur.drawImage(display.el, 0, 0, halo.el.width, halo.el.height);
        context.imageSmoothingEnabled = true;
        context.globalAlpha = 0.95 * state.glow; context.drawImage(halo.el, 0, 0, w, h);
        context.globalAlpha = 1;
      }
      context.drawImage(display.el, 0, 0);
      if (state.screen !== 'scope') {
        // Recover beam luminance lost when averaging narrow filaments into phosphor cells.
        context.globalAlpha = state.screen === 'raster' ? 0.85 : 0.35;
        context.drawImage(display.el, 0, 0); context.globalAlpha = 1;
      }
      context.globalCompositeOperation = 'source-over';
      if (state.screen === 'scope' && state.scan > 0 && !small) {
        context.fillStyle = 'rgba(2,9,5,' + (state.scan * 0.10) + ')';
        const line = Math.max(2, Math.round(dpr * 2));
        for (let y = 0; y < h; y += line) context.fillRect(0, y, w, 0.7);
      }
      lastTime = seconds; lastKey = key;
    }

    function reset() { lastTime = NaN; lastFrame = ''; lastKey = ''; backgroundKey = ''; maskKey = ''; }
    function destroy() {
      destroyed = true;
      for (const layer of [signal, history, display, halo, sample, mask, backdrop]) resize(layer, 1, 1);
      rings.length = centers.length = 0;
      attractor = null;
    }
    return { render, reset, destroy };
  }

  window.PhosphorEngine = { create, source: '(' + installPhosphorEngine.toString() + ')();' };
})();
