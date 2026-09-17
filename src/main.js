import { bodyAt, speedToKmh } from './solver.mjs';
const $ = id => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d', { alpha: false });
const fieldCanvas = document.createElement('canvas'), fieldCtx = fieldCanvas.getContext('2d');
const descriptions = {
  airfoil: 'NACA 0018 section',
  venturi: 'Contraction and diffuser',
  coanda: 'Slot jet beside curved wall',
  cylinder: 'Circular obstacle',
  plate: 'Inclined flat plate',
  empty: 'No-slip channel'
};
let worker, generation = 0, pending = false, paused = false, failed = false;
let width = 0, height = 0, solid, image, frame, view = 'flow', previousSteps = 0, dirty = true, config;
let requestedConfig = null, latticeSpeed = 0.055, metres = 0.01, seconds = 0.0001, outlineDirty = true;
const outline = document.createElement('canvas'), outlineCtx = outline.getContext('2d');
function speedLabel(value) { return $('units').value === 'kmh' ? `${speedToKmh(value, metres, seconds).toFixed(2)} km/h` : `${value.toFixed(3)} lu/ts`; }
function speedControl() {
  const factor = $('units').value === 'kmh' ? speedToKmh(1, metres, seconds) : 1;
  $('speed').max = 0.09 * factor; $('speed').step = 0.001 * factor; $('speed').value = latticeSpeed * factor;
  $('speedValue').textContent = speedLabel(latticeSpeed); dirty = true;
}
const particles = new Float32Array(1600 * 2);
function readControls() {
  const c = { width: Number($('quality').value), shape: $('shape').value, speed: latticeSpeed, viscosity: Number($('viscosity').value), angle: Number($('angle').value), heat: Number($('heat').value), source: $('source').value, fanX: Number($('fanX').value), fanY: Number($('fanY').value), direction: Number($('direction').value) };
  $('speedValue').textContent = speedLabel(c.speed);
  for (const id of ['fanX', 'fanY', 'direction']) { $(id).disabled = c.source !== 'fan'; $(id + 'Value').textContent = id === 'direction' ? c[id] + '°' : Math.round(c[id] * 100) + '%'; }
  $('viscosityValue').textContent = c.viscosity.toFixed(3) + ' lu²/ts';
  $('angleValue').textContent = c.angle + '°'; $('heatValue').textContent = c.heat + ' °C';
  $('angle').disabled = !['airfoil', 'plate'].includes(c.shape); $('experiment').textContent = descriptions[c.shape];
  return c;
}
function fail(message) { failed = true; pending = false; $('status').textContent = 'error: ' + message; }
function reset() {
  config = readControls(); requestedConfig = null; outlineDirty = true; generation++; failed = false; pending = true; frame = null; previousSteps = 0;
  $('status').textContent = 'init'; $('metrics').textContent = 'init';
  $('probe').textContent = '';
  worker?.terminate();
  try {
    worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    worker.onerror = () => fail('WebAssembly load failed. Serve over HTTP, not file://');
    worker.onmessage = ({ data }) => {
      if (data.id !== generation) return;
      if (data.type === 'error') { fail(data.message); return; }
      if (data.type === 'geometry') { outlineDirty ||= config.angle !== data.config.angle; solid = data.solid; config = data.config; return; }
      if (data.type === 'ready') {
        ({ width, height, solid } = data);
        fieldCanvas.width = width; fieldCanvas.height = height; image = fieldCtx.createImageData(width, height);
        outline.width = width * 3; outline.height = height * 3;
        for (let p = 0; p < particles.length; p += 2) spawn(p, true);
        $('status').textContent = 'ready · C++/WASM · float64';
        outlineDirty = true;
        pending = true;
        worker.postMessage({ type: 'step', id: generation, budget: 12 });
        return;
      }
      pending = false; frame = data; dirty = true; $('status').textContent = paused ? 'paused' : 'ready · C++/WASM · float64';
    };
    worker.postMessage({ type: 'init', id: generation, config });
  } catch { fail('Worker unavailable. Serve this folder over HTTP in a modern browser.'); }
}
function spawn(p, throughout = false) {
  for (let attempt = 0; attempt < 40; attempt++) {
    particles[p] = throughout ? 1 + Math.random() * (width - 3) : 1 + Math.random() * 3;
    particles[p + 1] = config.shape === 'coanda' ? height * (0.325 + Math.random() * 0.07) : 2 + Math.random() * (height - 4);
    if (config.source === 'fan') {
      const a = config.direction * Math.PI / 180, spread = (Math.random() - 0.5) * height * 0.16;
      particles[p] = Math.max(1, Math.min(width - 2, config.fanX * (width - 1) - Math.sin(a) * spread));
      particles[p + 1] = Math.max(1, Math.min(height - 2, config.fanY * (height - 1) + Math.cos(a) * spread));
    }
    if (!solid[(particles[p] | 0) + (particles[p + 1] | 0) * width]) return;
  }
}
const stops = [[15, 28, 62], [30, 107, 159], [59, 186, 177], [238, 213, 116], [225, 88, 69]];
const palette = new Uint8Array(256 * 3), bodyColor = [188, 200, 205], background = [12, 21, 29];
for (let i = 0; i < 256; i++) {
  const t = i / 255 * 4, a = Math.min(3, Math.floor(t)), f = t - a;
  for (let c = 0; c < 3; c++) palette[i * 3 + c] = stops[a][c] + (stops[a + 1][c] - stops[a][c]) * f;
}
function sample(f, x, y, c) {
  const ix = x | 0, iy = y | 0, j = (ix + iy * width) * 4, fx = x - ix, fy = y - iy;
  const a = f[j + c], b = f[j + 4 + c], c1 = f[j + width * 4 + c], d = f[j + width * 4 + 4 + c];
  return a + fx * (b - a) + fy * (c1 - a) + fx * fy * (a - b - c1 + d);
}
function render() {
  const f = frame.fields, pixels = image.data;
  const speedMax = Math.max(0.01, config.speed * 3), pressureMax = Math.max(0.0002, 2 * config.speed ** 2);
  const tMin = Math.min(20, config.heat), tMax = Math.max(21, config.heat), tRange = tMax - tMin;
  for (let i = 0; i < solid.length; i++) {
    const j = i * 4;
    let value = Math.hypot(f[j], f[j + 1]) / speedMax;
    if (view === 'pressure') value = 0.5 + f[j + 2] / (2 * pressureMax);
    if (view === 'temperature') value = (f[j + 3] - tMin) / tRange;
    const color = (Math.max(0, Math.min(1, value)) * 255 | 0) * 3;
    for (let c = 0; c < 3; c++) pixels[j + c] = view === 'natural' ? background[c] : palette[color + c];
    pixels[j + 3] = 255;
  }
  fieldCtx.putImageData(image, 0, 0); ctx.drawImage(fieldCanvas, 0, 0, canvas.width, canvas.height);
  const elapsed = frame.steps - previousSteps, sx = canvas.width / width, sy = canvas.height / height;
  if ($('tracers').checked) {
    ctx.beginPath(); ctx.strokeStyle = view === 'natural' ? '#dceaf080' : '#ffffff70'; ctx.lineWidth = Math.max(0.7, canvas.width / 1500);
    for (let p = 0; p < particles.length; p += 2) {
      let x = particles[p], y = particles[p + 1];
      const startX = x, startY = y;
      let alive = true;
      // Sub-cell integration prevents tracers crossing thin obstacles.
      for (let t = 0; t < elapsed; t++) {
        const ix = x | 0, iy = y | 0;
        if (ix < 1 || ix >= width - 1 || iy < 1 || iy >= height - 1 || solid[ix + iy * width]) { alive = false; break; }
        x += sample(f, x, y, 0); y += sample(f, x, y, 1);
      }
      if (!alive || x >= width - 1 || y >= height - 1 || x < 1 || y < 1 || solid[(x | 0) + (y | 0) * width]) { spawn(p); continue; }
      particles[p] = x; particles[p + 1] = y;
      const j = ((x | 0) + (y | 0) * width) * 4;
      ctx.moveTo((elapsed ? startX : x - f[j] * 18) * sx, (elapsed ? startY : y - f[j + 1] * 18) * sy); ctx.lineTo(x * sx, y * sy);
    }
    ctx.stroke();
  }
  previousSteps = frame.steps;
  if (outlineDirty) {
    outline.width = Math.min(1800, Math.max(width * 2, canvas.width)); outline.height = outline.width / 2;
    const mask = outlineCtx.createImageData(outline.width, outline.height);
    for (let y = 0; y < outline.height; y++) for (let x = 0; x < outline.width; x++) {
      let coverage = 0;
      for (const dx of [0.25, 0.75]) for (const dy of [0.25, 0.75]) {
        const X = (x + dx) / outline.height, Y = (y + dy) / outline.height;
        if (Y < 0.5 / height || Y > 1 - 1.5 / height || bodyAt(X, Y, config.shape, config.angle)) coverage++;
      }
      const j = (x + y * outline.width) * 4;
      mask.data[j] = bodyColor[0]; mask.data[j + 1] = bodyColor[1]; mask.data[j + 2] = bodyColor[2]; mask.data[j + 3] = coverage * 63.75;
    }
    outlineCtx.putImageData(mask, 0, 0); outlineDirty = false;
  }
  ctx.drawImage(outline, 0, 0, canvas.width, canvas.height);
  if (config.source === 'fan') {
    ctx.save(); ctx.translate(config.fanX * (width - 1) * sx, config.fanY * (height - 1) * sy); ctx.rotate(config.direction * Math.PI / 180);
    const size = canvas.height * 0.07;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(0, size); ctx.moveTo(0, 0); ctx.lineTo(size, 0); ctx.lineTo(size * 0.6, -size * 0.3); ctx.moveTo(size, 0); ctx.lineTo(size * 0.6, size * 0.3); ctx.stroke(); ctx.restore();
  }
  $('metrics').textContent = `${width} × ${height} · t ${frame.steps} ts · Re ${frame.reynolds.toFixed(1)} · max Ma ${(frame.maxSpeed * Math.sqrt(3)).toFixed(3)}`;
  $('legendBar').style.background = view === 'natural' ? '#91a8b5' : 'linear-gradient(90deg, rgb(15,28,62), rgb(30,107,159), rgb(59,186,177), rgb(238,213,116), rgb(225,88,69))';
  $('legendLabel').textContent = { flow: 'Speed', natural: 'Visible smoke', temperature: 'Temperature', pressure: 'Gauge pressure' }[view];
  $('legendRange').textContent = { flow: `0 — ${speedLabel(speedMax)}`, natural: 'Air itself is invisible', temperature: `${tMin} — ${tMax} °C`, pressure: `±${pressureMax.toFixed(4)} ρ₀·lu²/ts²` }[view];
  dirty = false;
}
function tick() {
  if (frame && dirty) render();
  if (worker && frame && !pending && !failed && !document.hidden) {
    if (requestedConfig) { pending = true; worker.postMessage({ type: 'update', id: generation, config: requestedConfig }); requestedConfig = null; }
    else if (!paused) { pending = true; worker.postMessage({ type: 'step', id: generation, budget: Number($('playback').value) * 12 }); }
  }
  requestAnimationFrame(tick);
}
new ResizeObserver(() => {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr)); dirty = true; outlineDirty = true;
}).observe(canvas);
for (const id of ['shape', 'quality']) $(id).addEventListener('change', reset);
for (const id of ['speed', 'viscosity', 'angle', 'heat', 'source', 'fanX', 'fanY', 'direction']) $(id).addEventListener('input', () => {
  if (id === 'speed') latticeSpeed = Math.max(0, Math.min(0.09, Number($('speed').value) / ($('units').value === 'kmh' ? speedToKmh(1, metres, seconds) : 1)));
  requestedConfig = readControls();
});
$('units').onchange = speedControl;
for (const id of ['metres', 'seconds']) $(id).addEventListener('input', () => {
  if (!$('metres').checkValidity() || !$('seconds').checkValidity() || !Number($('metres').value) || !Number($('seconds').value)) { $('scaleNote').textContent = 'Enter positive scales within the allowed range.'; return; }
  metres = Number($('metres').value); seconds = Number($('seconds').value); speedControl();
  $('scaleNote').textContent = `1 lu/ts = ${speedToKmh(1, metres, seconds).toPrecision(5)} km/h. Chosen scale, not calibrated air.`;
});
$('playback').oninput = () => { $('playbackValue').textContent = $('playback').value + '×'; };
$('reset').onclick = reset;
$('pause').onclick = () => { paused = !paused; $('pause').textContent = paused ? 'Resume' : 'Pause'; $('pause').setAttribute('aria-pressed', String(paused)); if (!failed) $('status').textContent = paused ? 'paused' : 'ready · C++/WASM · float64'; };
$('tracers').onchange = () => { dirty = true; };
document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => {
  view = button.dataset.view; dirty = true;
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  $('viewNote').textContent = { flow: 'Tracers follow velocity. Colors show speed.', natural: 'Invisible air with optional smoke.', temperature: 'Heat advection and diffusion.', pressure: 'Static pressure relative to outlet.' }[view];
});
let probeX = 1, probeY = 1;
function probe(x, y) {
  if (!frame) return;
  x = probeX = Math.max(0, Math.min(width - 1, x)); y = probeY = Math.max(0, Math.min(height - 1, y));
  const i = x + y * width, j = i * 4, f = frame.fields;
  $('probe').textContent = solid[i] ? `Solid · ${f[j + 3].toFixed(1)}°C` : `(${x},${y}) · |u|=${speedLabel(Math.hypot(f[j], f[j + 1]))} · Δp=${f[j + 2].toFixed(5)} · T=${f[j + 3].toFixed(1)}°C`;
}
canvas.addEventListener('pointermove', event => {
  const r = canvas.getBoundingClientRect();
  probe(Math.floor((event.clientX - r.left) / r.width * width), Math.floor((event.clientY - r.top) / r.height * height));
});
canvas.addEventListener('keydown', event => {
  const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
  if (!move) return;
  event.preventDefault(); probe(probeX + move[0], probeY + move[1]);
});
reset(); requestAnimationFrame(tick);