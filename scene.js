(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('stars');
  const ctx = canvas.getContext('2d', { alpha: false });
  const body = document.body;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const tau = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const lerp = (a, b, amount) => a + (b - a) * amount;
  const ease = t => t * t * (3 - 2 * t);

  let seed = 913239;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  }

  function lightSprite(inner, middle) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 48;
    const g = sprite.getContext('2d');
    const gradient = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(.13, middle);
    gradient.addColorStop(.36, middle.slice(0, 7) + '38');
    gradient.addColorStop(1, middle.slice(0, 7) + '00');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 48, 48);
    return sprite;
  }

  const gold = lightSprite('#fff8da', '#ffc76d');
  const white = lightSprite('#ffffff', '#f8e7b6');
  const ice = lightSprite('#f4f4ff', '#a8b4ff');
  const palettes = [
    ['#112b26', '#1e4938', '#2e6549', '#508267', '#759676', '#a5a97d', '#d9ba80'],
    ['#5d3e32', '#7a5238', '#996945', '#be8c5c', '#dba36b', '#f4c386', '#ffe1ab'],
    ['#7a81ae', '#9199b7', '#a1aed3', '#bac5ec', '#c8b6b4', '#d8bdab', '#f3d9b1']
  ].map(palette => palette.map(color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16))));
  const colors = ['#9f2234', '#c33f45', '#d5a960', '#4b9478', '#e6ca9b'];
  const ballSprites = new Map(colors.map(color => [color, ballSprite(color)]));

  let width, height, axis, baseCenter, center, baseUnit, unit, skyWidth, skyHeight, compact, background, skyBackground;
  let mode = 'tree', spread = 0, wreath = 0, heart = 0, tree = 1;
  let treeMix, wreathMix, heartMix, orbitSin, orbitCos;
  let spin = .12, desiredSpin = .12, tilt = .07, desiredTilt = .07;
  let zoom = 1, desiredZoom = 1;
  let clock = 0, lastFrame = 0;
  let detail = 2, intervalAverage = 16.7, drawAverage = 0, lastDetailUpdate = 0;
  const dust = palettes[0].map(() => []), lights = [], garland = [], ornaments = [], stars = [], ground = [], hits = [];
  const skyMix = new Float32Array(9);

  function heartX(angle) { return 16 * Math.sin(angle) ** 3 * .065; }
  function heartY(angle) {
    return (13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) * .065;
  }

  // Equal distances on the outline keep the photos and lights from bunching up at the points.
  const heartLengths = [0];
  for (let i = 1; i <= 192; i++) {
    const a = (i - 1) * tau / 192, b = i * tau / 192;
    heartLengths.push(heartLengths[i - 1] + Math.hypot(heartX(b) - heartX(a), heartY(b) - heartY(a)));
  }
  const heartAngles = [];
  for (let i = 0, segment = 1; i <= 256; i++) {
    const distance = heartLengths.at(-1) * i / 256;
    while (heartLengths[segment] < distance) segment++;
    const fraction = (distance - heartLengths[segment - 1]) / (heartLengths[segment] - heartLengths[segment - 1]);
    heartAngles.push((segment - 1 + fraction) * tau / 192);
  }

  function point(x, y, z) {
    const azimuth = random() * tau;
    const elevation = random() * 2 - 1;
    const radius = .25 + Math.cbrt(random()) * 2;
    const ring = Math.sqrt(1 - elevation * elevation) * radius;
    const phase = random() * tau;
    const p = { x, y, z, sx: Math.cos(azimuth) * ring, sy: elevation * radius,
      sz: Math.sin(azimuth) * ring, phase, sinPhase: Math.sin(phase), cosPhase: Math.cos(phase),
      delay: Math.floor(random() * skyMix.length), px: 0, py: 0, depth: 0, scale: 1 };
    placeOnShapes(p, p.phase);
    return p;
  }

  function placeOnShapes(p, angle, edge = false) {
    const randomDepth = clamp(p.sz * .6, -1, 1);
    const wreathRadius = edge ? .84 : .73 + p.sx * .083;
    p.wx = Math.cos(angle) * wreathRadius;
    p.wy = Math.sin(angle) * wreathRadius;
    p.wz = randomDepth * .14;
    const fill = edge ? .985 : .12 + .88 * Math.sqrt(clamp((p.sy + 2.25) / 4.5, 0, 1));
    const pathIndex = ((angle % tau) / tau) * 256;
    const left = Math.floor(pathIndex);
    const outline = lerp(heartAngles[left], heartAngles[left + 1], pathIndex - left);
    p.hx = heartX(outline) * fill;
    p.hy = heartY(outline) * fill + .15;
    p.hz = randomDepth * .15;
  }

  function radiusAt(y) {
    return .66 * Math.pow(clamp((1.05 - y) / 2.02, 0, 1), .87);
  }

  function ballSprite(color) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 80;
    const g = sprite.getContext('2d');
    g.setTransform(30, 0, 0, 30, 40, 42);
    const tone = g.createRadialGradient(-.36, -.47, .01, -.05, -.04, 1.09);
    tone.addColorStop(0, '#fff5e2');
    tone.addColorStop(.17, color);
    tone.addColorStop(.65, color);
    tone.addColorStop(.91, '#2b1921');
    tone.addColorStop(1, '#896544');
    g.fillStyle = tone;
    g.beginPath();
    g.arc(0, 0, 1, 0, tau);
    g.fill();
    g.lineWidth = .033;
    g.strokeStyle = '#ffd4a380';
    g.stroke();
    g.fillStyle = '#fff5da91';
    g.beginPath();
    g.ellipse(-.34, -.50, .22, .11, -.52, 0, tau);
    g.fill();
    g.fillStyle = '#cfa876';
    g.fillRect(-.22, -1.24, .44, .29);
    g.fillStyle = '#ffe3b3';
    g.fillRect(-.21, -1.2, .42, .063);
    return sprite;
  }

  function initialize() {
    for (let layer = 0; layer < 19; layer++) {
      const y = -.94 + layer * .102;
      const branches = Math.round(28 - layer * .9);
      for (let branch = 0; branch < branches; branch++) {
        const angle = (branch + random() * .65) / branches * tau + layer * 1.43;
        const branchLength = radiusAt(y) * (.77 + random() * .3);
        for (let n = 0; n < 27; n++) {
          const reach = .15 + Math.pow(random(), .47) * .91;
          const r = reach * branchLength;
          const a = angle + (random() - .5) * (.24 + (1 - reach) * .38);
          const py = y + (1 - reach) * .14 - reach * reach * .047 + (random() - .5) * .052;
          const p = point(Math.cos(a) * r, py, Math.sin(a) * r);
          p.size = .35 + random() * 1.05;
          p.color = Math.floor(Math.pow(random(), 1.4) * dust.length);
          p.detail = (n + branch) % 4;
          if (random() > .95) lights.push(p);
          else dust[p.color].push(p);
        }
      }
    }
    for (let i = 0; i <= 495; i++) {
      const t = i / 495;
      const y = -.92 + t * 1.89;
      const a = t * tau * 5.9;
      const r = radiusAt(y) * 1.02 + .012;
      const p = point(Math.cos(a) * r, y + Math.sin(a * 2) * .019, Math.sin(a) * r);
      placeOnShapes(p, tau * t, true);
      p.wx *= .89 + .13 * Math.sin(tau * 12 * t);
      p.wy *= .89 + .13 * Math.sin(tau * 12 * t);
      p.size = .6 + random() * .95;
      garland.push(p);
    }
    for (let i = 0; i < 67; i++) {
      const y = -.86 + Math.pow(random(), 1.25) * 1.7;
      const a = i * 2.399963 + random() * .3;
      const r = radiusAt(y) * (1 + random() * .08);
      const p = point(r * Math.cos(a), y, r * Math.sin(a));
      p.size = .019 + random() * .018;
      p.color = colors[i % colors.length];
      p.type = i % 12 === 0 ? 'ribbon' : i % 7 === 0 ? 'gift' : 'ball';
      ornaments.push(p);
    }
    for (let i = 0; i < 660; i++) {
      stars.push({ x: random(), y: random(), size: random(), bright: random(), phase: random() * tau });
    }
    for (let i = 0; i < 660; i++) {
      const a = random() * tau;
      const r = Math.pow(random(), .62) * .95;
      ground.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, size: random(), phase: random() * tau });
    }
  }

  const topper = point(0, 1.168, 0);
  const floor = point(0, -1.075, 0);
  const projection = {};
  let cos, sin, cosTilt, sinTilt;

  function project(x, y, z, into) {
    const rotatedX = x * cos + z * sin;
    const rotatedZ = z * cos - x * sin;
    const py = y * cosTilt - rotatedZ * sinTilt;
    const pz = rotatedZ * cosTilt + y * sinTilt;
    const scale = 4.9 / (4.9 - pz);
    into.px = axis + rotatedX * unit * scale;
    into.py = center - py * unit * scale;
    into.depth = pz;
    into.scale = scale;
    return into;
  }

  function travel(p) {
    if (tree > .999) return project(p.x, p.y, p.z, p);
    const mixing = skyMix[p.delay];
    const orbit = mixing ? orbitSin * p.cosPhase + orbitCos * p.sinPhase : 0;
    const x = lerp(p.x * treeMix + p.wx * wreathMix + p.hx * heartMix, p.sx + orbit, mixing);
    const y = lerp(p.y * treeMix + p.wy * wreathMix + p.hy * heartMix, p.sy + orbit * .55, mixing);
    const z = lerp(p.z * treeMix + p.wz * wreathMix + p.hz * heartMix, p.sz, mixing);
    project(x, y, z, p);
    if (mixing) {
      p.px += ((p.px - axis) * (skyWidth - 1) + width * .5 - axis) * mixing;
      p.py += ((p.py - center) * (skyHeight - 1) + height * .5 - center) * mixing;
    }
    return p;
  }

  function glow(sprite, x, y, radius, opacity) {
    ctx.globalAlpha = clamp(opacity, 0, 1);
    ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
  }

  function sparkle(x, y, size, opacity) {
    ctx.globalAlpha = clamp(opacity, 0, 1);
    ctx.fillStyle = '#fff0c3';
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.quadraticCurveTo(x + size * .08, y - size * .11, x + size * .76, y);
    ctx.quadraticCurveTo(x + size * .08, y + size * .11, x, y + size);
    ctx.quadraticCurveTo(x - size * .08, y + size * .11, x - size * .76, y);
    ctx.quadraticCurveTo(x - size * .08, y - size * .11, x, y - size);
    ctx.fill();
  }

  function setResolution() {
    const limit = compact ? [1, 1.30, 1.50] : [1, 1.32, 1.65];
    const dpr = Math.min(devicePixelRatio || 1, limit[detail], Math.sqrt(3200000 / Math.max(1, width * height)));
    const pixelsWide = Math.max(1, Math.round(width * dpr));
    const pixelsHigh = Math.max(1, Math.round(height * dpr));
    if (pixelsWide !== canvas.width || pixelsHigh !== canvas.height) {
      canvas.width = pixelsWide;
      canvas.height = pixelsHigh;
    }
    ctx.setTransform(pixelsWide / Math.max(1, width), 0, 0, pixelsHigh / Math.max(1, height), 0, 0);
  }

  function resize() {
    const firstLayout = width === undefined;
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    compact = width <= 675 && height >= width;
    if (firstLayout && compact) detail = 1;
    setResolution();
    axis = width * (compact ? .5 : .60);
    baseCenter = height * (compact ? (height < 660 ? .61 : .596) : .485);
    center = baseCenter;
    baseUnit = Math.max(1, Math.min(height * (compact ? (height < 660 ? .157 : .188) : .312), width * (compact ? .39 : .27)));
    unit = baseUnit * zoom;
    skyWidth = width / (baseUnit * 4.05);
    skyHeight = height / (baseUnit * 3.5);
    body.style.setProperty('--axis', axis + 'px');
    background = ctx.createRadialGradient(axis, center, 0, axis, center, Math.max(width, height) * .73);
    background.addColorStop(0, '#18201b');
    background.addColorStop(.46, '#0a1014');
    background.addColorStop(1, '#06070b');
    skyBackground = ctx.createRadialGradient(width * .49, height * .49, 0, width * .49, height * .49, Math.max(width, height) * .67);
    skyBackground.addColorStop(0, '#192139');
    skyBackground.addColorStop(.54, '#111629');
    skyBackground.addColorStop(1, '#070911');
    if (dialog.open) fitPhoto();
  }

  function renderBackground() {
    ctx.globalAlpha = 1;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = spread * .9;
    ctx.fillStyle = skyBackground;
    ctx.fillRect(0, 0, width, height);

    const parallax = Math.sin(spin) * 35;
    const step = detail === 0 ? 2 : 1;
    for (let i = 0; i < stars.length; i += step) {
      const s = stars[i];
      const twinkle = .71 + .29 * Math.sin(clock * (1 + s.size) + s.phase);
      const x = (s.x * width + parallax * (s.size - .5) + width) % width;
      const y = s.y * height;
      const visibility = s.bright * twinkle * (s.size > .8 ? .24 : .38) * (.44 + spread * .85);
      ctx.globalAlpha = visibility;
      ctx.fillStyle = s.bright > .56 ? '#f8d9a0' : '#c8c8ec';
      const size = .4 + s.size * 1.17;
      ctx.fillRect(x, y, size, size);
      if (s.size > .94) {
        glow(s.bright > .48 ? gold : ice, x, y, 3 + 8 * spread, visibility * 1.75);
      }
      if (s.size > .976 && spread > .4) sparkle(x, y, 3 + s.bright * 4, visibility * .78);
    }
  }

  function renderGround() {
    if (tree < .04) return;
    project(floor.x, floor.y, floor.z, floor);
    const opacity = tree ** 2;
    ctx.save();
    ctx.translate(floor.px, floor.py);
    ctx.scale(1, .22);
    glow(gold, 0, 0, unit * .94, .31 * opacity);
    ctx.restore();
    const step = detail === 0 ? 3 : detail === 1 ? 2 : 1;
    for (let i = 0; i < ground.length; i += step) {
      const dot = ground[i];
      const q = project(dot.x, -1.037, dot.z, projection);
      ctx.globalAlpha = opacity * dot.size * (.26 + .18 * Math.sin(dot.phase + clock * 1.25));
      ctx.fillStyle = dot.size > .83 ? '#ffda8b' : '#9a723d';
      ctx.fillRect(q.px, q.py, .55 + dot.size, .55 + dot.size);
    }
  }

  function renderParticles() {
    const density = detail + 2;
    const sizeScale = (compact ? .94 : 1.12) * Math.sqrt(zoom);
    const [foliage, heartDust, skyDust] = palettes;
    const greenAmount = 1 - heart - spread;
    for (let i = 0; i < dust.length; i++) {
      const paths = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
      for (const p of dust[i]) {
        if (p.detail >= density) continue;
        travel(p);
        const { px: x, py: y } = p;
        if (x < -2 || x > width + 2 || y < -2 || y > height + 2) continue;
        const depth = clamp(Math.floor((p.depth + .52) * 4), 0, 3);
        const size = p.size * p.scale * sizeScale;
        paths[depth].rect(x - size / 2, y - size / 2, size, size);
      }
      const color = foliage[i].map((channel, c) => Math.round(channel * greenAmount + heartDust[i][c] * heart + skyDust[i][c] * spread));
      ctx.fillStyle = `rgb(${color.join(',')})`;
      for (let j = 0; j < paths.length; j++) {
        ctx.globalAlpha = (.29 + j * .16) * (.91 + .33 * wreath - .18 * spread);
        ctx.fill(paths[j]);
      }
    }
    const step = detail === 0 ? 2 : 1;
    for (let i = 0; i < lights.length; i += step) {
      const p = travel(lights[i]);
      const { px: x, py: y } = p;
      if (x < -18 || x > width + 18 || y < -18 || y > height + 18) continue;
      const depth = clamp(.65 + p.depth * .48, .18, 1);
      const size = p.size * p.scale * sizeScale;
      const flash = .69 + Math.sin(clock * 1.9 + p.phase) * .29;
      glow(p.color % 4 === 0 && spread > .5 ? ice : gold, x, y, size * (3.4 + spread * 3), flash * depth);
      if (i % 17 === 0 && p.size > .8) sparkle(x, y, size * (3 + 2.4 * spread), flash * depth * .67);
    }
  }

  function renderGarland() {
    let previous;
    const ridge = new Path2D();
    for (let i = 0; i < garland.length; i++) {
      const p = garland[i];
      travel(p);
      const depth = clamp(.54 + p.depth * 1.08, .18, 1);
      const twinkle = .76 + Math.sin(clock * 2.7 + p.phase) * .24;
      if (previous && tree > .89 && p.depth > -.025 && previous.depth > -.025) {
        ridge.moveTo(previous.px, previous.py);
        ridge.lineTo(p.px, p.py);
      }
      if (detail > 0 || i % 2 === 0) {
        const r = (2.9 + p.size * 2.35 + spread * 2.8) * p.scale * Math.sqrt(zoom);
        glow(i % 11 === 0 ? white : gold, p.px, p.py, r, depth * twinkle * .91);
      }
      previous = p;
    }
    if (tree > .89) {
      const opacity = 1 - (1 - tree) * 8;
      ctx.globalAlpha = opacity * .23;
      ctx.strokeStyle = '#d39658';
      ctx.lineWidth = 4 * zoom;
      ctx.stroke(ridge);
      ctx.globalAlpha = opacity * .81;
      ctx.strokeStyle = '#ffe0a2';
      ctx.lineWidth = 1.04 * zoom;
      ctx.stroke(ridge);
    }
  }

  function renderOrnaments() {
    for (const p of ornaments) travel(p);
    ornaments.sort((a, b) => a.depth - b.depth);
    for (const p of ornaments) {
      const r = Math.max(1.7, p.size * unit * p.scale);
      const x = p.px, y = p.py;
      if (spread > .58 || heart > .58) {
        const twinkle = .66 + .34 * Math.sin(clock * 2 + p.phase);
        glow(gold, x, y, r * (heart > .58 ? 2.35 : 3.1), twinkle * .8);
        if (p.type !== 'ball') sparkle(x, y, r * .88, twinkle * .58);
        continue;
      }
      if (p.depth < -.08 - wreath * .16) continue;
      if (p.type === 'ball') {
        ctx.globalAlpha = clamp(.71 + p.depth * .53, .36, 1) * (tree + wreath);
        ctx.drawImage(ballSprites.get(p.color), x - r * 4 / 3, y - r * 1.4, r * 8 / 3, r * 8 / 3);
        continue;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = clamp(.68 + p.depth * .55, .35, 1) * (tree + wreath);
      if (p.type === 'ribbon') {
        ctx.fillStyle = '#b82038';
        ctx.strokeStyle = '#efb27d';
        ctx.lineWidth = .55;
        ctx.beginPath();
        ctx.moveTo(-r * .18, 0);
        ctx.bezierCurveTo(-r * 2.13, -r * 1.75, -r * 2.55, r * .68, -r * .24, r * .18);
        ctx.bezierCurveTo(r * 2.48, r * .63, r * 2.2, -r * 1.65, r * .18, -.12 * r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillRect(-r * .8, 0, r * .62, r * 1.18);
        ctx.fillRect(r * .27, 0, r * .61, r * 1.14);
        ctx.fillStyle = '#edb767';
        ctx.fillRect(-r * .23, -r * .2, r * .46, r * .52);
      } else {
        ctx.rotate(Math.sin(p.phase + spin) * .28);
        ctx.fillStyle = p.color;
        ctx.fillRect(-r, -r * .94, r * 2, r * 1.88);
        ctx.fillStyle = '#17101166';
        ctx.fillRect(r * .43, -r * .94, r * .57, r * 1.88);
        ctx.fillStyle = '#ffedd16e';
        ctx.fillRect(-r, -r * .94, r * 2, r * .27);
        ctx.fillStyle = '#e4bd7c';
        ctx.fillRect(-r * .15, -r, r * .3, r * 2);
        ctx.fillRect(-r * 1.05, -r * .53, r * 2.1, r * .22);
      }
      ctx.restore();
    }
  }

  function renderTopper() {
    if (tree < .06) return;
    const p = travel(topper);
    const r = Math.max(10, unit * .075);
    const opacity = tree ** 1.85;
    glow(gold, p.px, p.py, r * 3.3, opacity * .98);
    glow(white, p.px, p.py, r * 2.1, opacity * .92);
    ctx.globalAlpha = opacity * .20;
    ctx.strokeStyle = '#ffe4b1';
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.arc(p.px, p.py, r * 1.46, 0, tau);
    ctx.stroke();
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rad = i % 2 === 0 ? r : r * .46;
      ctx.lineTo(p.px + Math.cos(a) * rad, p.py + Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fillStyle = '#fff3c4';
    ctx.fill();
    ctx.strokeStyle = '#fff9e6';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.globalAlpha = opacity * .55;
    ctx.fillStyle = '#dfa366';
    ctx.beginPath();
    ctx.moveTo(p.px, p.py - r);
    ctx.lineTo(p.px + r * .13, p.py - r * .08);
    ctx.lineTo(p.px + r * .95, p.py - r * .31);
    ctx.lineTo(p.px, p.py + r * .03);
    ctx.closePath();
    ctx.fill();
    sparkle(p.px, p.py, r * 1.52, opacity * .64);
  }

  function renderWreathBow() {
    if (wreath < .03) return;
    const p = project(0, .77, .16, projection);
    ctx.save();
    ctx.translate(p.px, p.py);
    ctx.scale(unit * .095, unit * .095);
    ctx.globalAlpha = wreath;
    const silk = ctx.createLinearGradient(0, -1, 0, 1.5);
    silk.addColorStop(0, '#f47780');
    silk.addColorStop(.35, '#c6384f');
    silk.addColorStop(1, '#7b132b');
    ctx.fillStyle = silk;
    ctx.strokeStyle = '#e3a46f';
    ctx.lineWidth = .045;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.beginPath();
      ctx.moveTo(0, -.12);
      ctx.bezierCurveTo(.84, -.88, 2.12, -1.31, 2.02, -.16);
      ctx.bezierCurveTo(1.96, .67, .72, .41, .18, .14);
      ctx.bezierCurveTo(.55, .55, .78, .99, .99, 1.85);
      ctx.lineTo(.55, 1.61);
      ctx.lineTo(.24, 1.92);
      ctx.quadraticCurveTo(.18, .66, 0, .28);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = '#bd3148';
    ctx.beginPath();
    ctx.ellipse(0, 0, .28, .41, .14, 0, tau);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  let photos = [], photoPoints = [], activePhoto = null, transition = null, photoEpoch = 0;
  const dialog = $('photo-dialog');
  const frame = dialog.querySelector('.photo-frame');
  const fullPhoto = $('full-photo');
  const album = $('album');
  const photoStorage = 'starlit-tree/photos-v1';

  function photoOrb(img) {
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 116;
    const g = sprite.getContext('2d');
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    g.beginPath();
    g.arc(58, 58, 55, 0, tau);
    g.clip();
    g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 3, 3, 110, 110);
    const rim = g.createRadialGradient(43, 39, 31, 58, 58, 56);
    rim.addColorStop(0, '#ffefc400');
    rim.addColorStop(.78, '#d4a05718');
    rim.addColorStop(.94, '#ac693d68');
    rim.addColorStop(1, '#ffeabce8');
    g.fillStyle = rim;
    g.fillRect(0, 0, 116, 116);
    g.beginPath();
    g.arc(58, 58, 48, 3.45, 4.60);
    g.strokeStyle = '#fff5d79e';
    g.lineCap = 'round';
    g.lineWidth = 2.1;
    g.stroke();
    return sprite;
  }

  function renderPhotos() {
    hits.length = 0;
    for (const p of photoPoints) {
      travel(p);
      const depth = p.scale;
      const limit = Math.min(width, height);
      p.r = lerp(Math.max(5, unit * .044), clamp(limit * p.size, 10, 31) * Math.sqrt(zoom), spread) * depth;
    }
    photoPoints.sort((a, b) => a.depth - b.depth);
    for (const p of photoPoints) {
      if (p.depth < -.08 && tree > .63) continue;
      const { px: x, py: y, r } = p;
      if (x < -r || x > width + r || y < -r || y > height + r) continue;
      const highlighted = hoveredPhoto === p || gestureTargets.includes(p);
      const glowSize = r * (highlighted ? 3 : 2.13);
      glow(gold, x, y, glowSize, highlighted ? .84 : .54 + .11 * Math.sin(clock * 1.7 + p.phase));
      const photo = p.photo;
      if (!photo.orb && photo.img.complete && photo.img.naturalWidth) photo.orb = photoOrb(photo.img);
      ctx.globalAlpha = .96;
      if (photo.orb) ctx.drawImage(photo.orb, x - r, y - r, r * 2, r * 2);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, tau);
      ctx.globalAlpha = highlighted ? 1 : .88;
      ctx.strokeStyle = highlighted ? '#fff6d8' : '#e8c485b5';
      ctx.lineWidth = highlighted ? 2 : .95;
      ctx.stroke();
      sparkle(x - r * .68, y - r * .68, Math.max(2.2, r * .24), .83);
      hits.push(p);
    }
  }

  function updateDetail(now, interval) {
    if (interval > 2 && interval < 100) intervalAverage += (interval - intervalAverage) * .07;
    if (now - lastDetailUpdate < 2600) return;
    lastDetailUpdate = now;
    const previous = detail;
    if (intervalAverage > 24 || drawAverage > 14) detail = Math.max(0, detail - 1);
    else if (intervalAverage < 18.5 && drawAverage < 6) detail = Math.min(2, detail + 1);
    if (detail !== previous) setResolution();
  }

  function frameLoop(now) {
    const started = performance.now();
    const interval = now - (lastFrame || now);
    const dt = Math.min(interval / 1000, .045);
    lastFrame = now;
    updateDetail(now, interval);
    const reduced = motion.matches;
    if (!reduced) clock += dt;
    const easing = reduced ? 1 : 1 - Math.exp(-dt * 4.9);
    spread = lerp(spread, mode === 'sky' ? 1 : 0, easing);
    wreath = lerp(wreath, mode === 'wreath' ? 1 : 0, easing);
    heart = lerp(heart, mode === 'heart' ? 1 : 0, easing);
    tree = clamp(1 - spread - wreath - heart, 0, 1);
    const local = 1 - spread;
    wreathMix = local > .001 ? wreath / local : 0;
    heartMix = local > .001 ? heart / local : 0;
    treeMix = 1 - wreathMix - heartMix;
    for (let i = 0; i < skyMix.length; i++) {
      const delay = i * .028;
      skyMix[i] = ease(clamp((spread - delay) / (1 - delay), 0, 1));
    }
    orbitSin = reduced ? 0 : .052 * Math.sin(clock * .48);
    orbitCos = reduced ? 0 : .052 * Math.cos(clock * .48);
    const follow = reduced ? 1 : 1 - Math.exp(-dt * 9);
    zoom = lerp(zoom, desiredZoom, follow);
    unit = baseUnit * zoom;
    center = baseCenter + Math.max(0, zoom - 1) * baseUnit * .20 * tree;
    if (!drag && !dialog.open && !handMoving && !reduced) desiredSpin += dt * .23;
    spin = lerp(spin, desiredSpin, follow);
    tilt = lerp(tilt, desiredTilt, easing);
    const flat = wreath + heart;
    const angle = Math.atan2(Math.sin(spin), Math.cos(spin)) * (1 - flat) + Math.sin(spin) * .48 * flat;
    cos = Math.cos(angle);
    sin = Math.sin(angle);
    cosTilt = Math.cos(tilt);
    sinTilt = Math.sin(tilt);
    renderBackground();
    renderGround();
    renderParticles();
    renderGarland();
    renderOrnaments();
    renderWreathBow();
    renderPhotos();
    renderTopper();
    ctx.globalAlpha = 1;
    drawAverage += (performance.now() - started - drawAverage) * .08;
    requestAnimationFrame(frameLoop);
  }

  const shapeButtons = [...document.querySelectorAll('[data-shape]')];
  const modeHints = {
    tree: '拖动旋转 · 点击树身散开', sky: '拖动星海 · 点亮照片光球',
    wreath: '拖动花环 · 点亮照片光球', heart: '拖动爱心 · 点亮照片光球'
  };

  function setMode(next) {
    if (mode === next) return;
    mode = next;
    body.dataset.mode = mode;
    shapeButtons.forEach(button => button.setAttribute('aria-pressed', button.dataset.shape === mode));
    $('scene-hint').textContent = modeHints[mode];
    if (mode !== 'sky') desiredTilt = .07;
  }

  let toastTimer;
  function toast(message) {
    const element = $('toast');
    element.textContent = message;
    element.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('visible'), 2500);
  }

  function setPhotos(sources, sample = false) {
    photos = sources.map((src, index) => {
      const img = new Image();
      img.src = src;
      return { img, src, name: `${sample ? '冬日示例' : '照片'} ${index + 1}` };
    });
    const count = photos.length ? Math.max(18, photos.length) : 0;
    photoPoints = Array.from({ length: count }, (_, i) => {
      const y = -.89 + (i / count) * 1.62;
      const a = i * 2.399963;
      const r = radiusAt(y) * 1.06 + .022;
      const p = point(Math.cos(a) * r, y, Math.sin(a) * r);
      placeOnShapes(p, tau * i / count + .10, true);
      const orbitRadius = .48 + Math.sqrt((i + 1) / count) * 1.37;
      p.sx = Math.cos(a) * orbitRadius;
      p.sy = Math.sin(a) * orbitRadius * .83;
      p.sz = Math.sin(i * 1.49) * 1.12;
      p.size = .018 + (i % 7) * .0024;
      p.photo = photos[i % photos.length];
      return p;
    });
    album.replaceChildren(...photos.map(photo => {
      const button = document.createElement('button');
      button.type = 'button';
      button.title = photo.name;
      button.setAttribute('aria-label', '打开' + photo.name);
      const preview = photo.img.cloneNode();
      preview.alt = '';
      button.append(preview);
      button.onclick = () => {
        const rect = button.getBoundingClientRect();
        openPhoto({ photo, px: rect.x + rect.width / 2, py: rect.y + rect.height / 2, r: rect.width / 2 });
      };
      return button;
    }));
  }

  function fitPhoto() {
    const img = activePhoto?.photo.img;
    if (!img?.naturalWidth) return;
    const ratio = Math.min((width - 67) / img.naturalWidth, (height * .76) / img.naturalHeight,
      Math.min(width * .65, 800) / img.naturalWidth * (compact ? 1.4 : 1));
    frame.style.setProperty('--photo-width', Math.round(img.naturalWidth * ratio) + 'px');
    frame.style.setProperty('--photo-height', Math.round(img.naturalHeight * ratio) + 'px');
  }

  function photoTransform(origin) {
    const rect = frame.getBoundingClientRect();
    const dx = origin.px - (rect.x + rect.width / 2);
    const dy = origin.py - (rect.y + rect.height / 2);
    const scale = clamp(origin.r * 2 / Math.max(rect.width, rect.height), .04, .25);
    return `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-14deg)`;
  }

  async function openPhoto(origin) {
    if (dialog.open || $('camera-help').open) return;
    const epoch = ++photoEpoch;
    try { await origin.photo.img.decode(); }
    catch { if (epoch === photoEpoch) toast('这张照片暂时无法打开'); return; }
    if (epoch !== photoEpoch || dialog.open || $('camera-help').open) return;
    activePhoto = { ...origin, source: origin };
    fullPhoto.src = origin.photo.src;
    fullPhoto.alt = origin.photo.name;
    fitPhoto();
    dialog.showModal();
    const from = photoTransform(activePhoto);
    transition = frame.animate([{ transform: from, opacity: .03 }, { transform: 'none', opacity: 1 }],
      { duration: motion.matches ? 1 : 630, easing: 'cubic-bezier(.18,.84,.2,1)' });
  }

  function closePhoto() {
    if (!dialog.open) { photoEpoch++; return; }
    if (dialog.dataset.closing) return;
    dialog.dataset.closing = 'true';
    const initial = getComputedStyle(frame);
    const from = { transform: initial.transform, opacity: initial.opacity };
    transition?.cancel();
    const to = photoTransform(activePhoto.source);
    transition = frame.animate([from, { transform: to, opacity: 0 }],
      { duration: motion.matches ? 1 : 390, fill: 'forwards', easing: 'cubic-bezier(.42,0,.35,1)' });
    transition.onfinish = () => {
      dialog.close();
      transition.cancel();
      activePhoto = null;
      delete dialog.dataset.closing;
    };
  }

  function nearestPhoto(x, y, extra = 5) {
    let best = null, distance = Infinity;
    for (const hit of hits) {
      const d = Math.hypot(hit.px - x, hit.py - y);
      if (d <= hit.r + extra && d < distance) { best = hit; distance = d; }
    }
    return best;
  }

  let drag = null, hoveredPhoto = null, gestureTargets = [], handMoving = false;
  canvas.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button !== 0) return;
    drag = { id: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (drag?.id === e.pointerId) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 5) drag.moved = true;
      if (drag.moved) {
        desiredSpin += (e.clientX - drag.x) * .007;
        desiredTilt = clamp(desiredTilt + (e.clientY - drag.y) * .003, -.7, .7);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
    }
    hoveredPhoto = nearestPhoto(e.clientX, e.clientY);
    canvas.style.cursor = hoveredPhoto ? 'pointer' : '';
  });
  canvas.addEventListener('pointerleave', () => { hoveredPhoto = null; canvas.style.cursor = ''; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('lostpointercapture', () => { drag = null; });
  canvas.addEventListener('pointerup', e => {
    if (drag?.id !== e.pointerId) return;
    const moved = drag.moved;
    drag = null;
    if (moved) return;
    const p = nearestPhoto(e.clientX, e.clientY, compact ? 9 : 5);
    if (p) { openPhoto(p); return; }
    const y = (center - e.clientY) / unit;
    if (mode === 'tree' && y > -1.12 && y < 1.28 && Math.abs(e.clientX - axis) < unit * (radiusAt(y) + .16)) setMode('sky');
  });
  dialog.addEventListener('cancel', e => { e.preventDefault(); closePhoto(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) closePhoto(); });
  $('close-photo').onclick = closePhoto;
  shapeButtons.forEach(button => { button.onclick = () => setMode(button.dataset.shape); });

  function convertPhoto(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const size = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
          const copy = document.createElement('canvas');
          copy.width = Math.max(1, Math.round(img.naturalWidth * size));
          copy.height = Math.max(1, Math.round(img.naturalHeight * size));
          const paint = copy.getContext('2d');
          paint.fillStyle = '#17130f';
          paint.fillRect(0, 0, copy.width, copy.height);
          paint.drawImage(img, 0, 0, copy.width, copy.height);
          resolve(copy.toDataURL('image/jpeg', .82));
        } catch { resolve(null); }
        finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  $('add-photos').onclick = () => $('photo-files').click();
  let uploadEpoch = 0;
  $('photo-files').onchange = async e => {
    const selected = Array.from(e.target.files);
    e.target.value = '';
    if (!selected.length) return;
    const epoch = ++uploadEpoch;
    const results = (await Promise.all(selected.slice(0, 16).map(convertPhoto))).filter(Boolean);
    if (epoch !== uploadEpoch) return;
    if (!results.length) { toast('无法读取照片，请尝试 JPG、PNG 或 WebP'); return; }
    setPhotos(results);
    let saved = true;
    try { localStorage.setItem(photoStorage, JSON.stringify(results)); } catch { saved = false; }
    setMode('sky');
    toast(`已放入 ${results.length} 张照片${saved ? '' : '，本次浏览有效'}`);
  };

  let stored;
  try { stored = JSON.parse(localStorage.getItem(photoStorage)); } catch { stored = null; }
  const custom = Array.isArray(stored) ? stored.filter(s => typeof s === 'string' && s.startsWith('data:image/jpeg;base64,')).slice(0, 16) : [];
  initialize();
  setPhotos(custom.length ? custom : [1, 2, 3, 4].map(i => `photos/winter-${i}.jpg`), custom.length === 0);
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frameLoop);

  window.starlitScene = {
    setMode, nearestPhoto, openPhoto, closePhoto, toast,
    photoOpen: () => dialog.open,
    zoomLevel: () => desiredZoom,
    setZoom(level) {
      if (Number.isFinite(level)) desiredZoom = clamp(level, .64, 1.30);
      return desiredZoom;
    },
    turn(dx, dy) {
      desiredSpin += clamp(dx * 5.5, -.19, .19);
      desiredTilt = clamp(desiredTilt + dy * 1.15, -.63, .63);
    },
    track(active, targets = []) { handMoving = active; gestureTargets = targets; }
  };
})();
