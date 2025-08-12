// main.js
const STORAGE_KEY = 'ruleta-opciones-v2';

const optionInput = document.getElementById('option-input');
const addForm = document.getElementById('add-form');
const fileInput = document.getElementById('file-input');
const fileTrigger = document.getElementById('file-trigger');
const discoverBtn = document.getElementById('discover-btn');
const spinBtn = document.getElementById('spin-btn');
const clearBtn = document.getElementById('clear-btn');
const resultDiv = document.getElementById('result');
const decision = document.getElementById('decision');
const acceptBtn = document.getElementById('accept-btn');
const rejectBtn = document.getElementById('reject-btn');
const availableCount = document.getElementById('available-count');
const doneCount = document.getElementById('done-count');
const doneList = document.getElementById('done-list');
const progressPct = document.getElementById('progress-pct');
const completedMsg = document.getElementById('completed-msg');
const restartBtn = document.getElementById('restart-btn');
const wheelCanvas = document.getElementById('wheel');
const ctx = wheelCanvas.getContext?.('2d');
const confettiCanvas = document.getElementById('confetti');
const confettiCtx = confettiCanvas?.getContext?.('2d');

// Estructura: { available: string[], done: Array<string | {text:string, acceptedAt:string}>, rejects: Record<string, string[]> }
let state = { available: [], done: [], rejects: {} };
let current = null; // opción actualmente mostrada

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? JSON.parse(saved) : { available: [], done: [], rejects: {} };
  // asegurar campos por compatibilidad hacia atrás
  if (!Array.isArray(state.available)) state.available = [];
  if (!Array.isArray(state.done)) state.done = [];
  if (!state.rejects || typeof state.rejects !== 'object') state.rejects = {};
  // migrar done de strings a objetos con marca de tiempo opcional
  state.done = state.done.map(d => typeof d === 'string' ? { text: d, acceptedAt: null } : d);
}

function updateStats() {
  availableCount.textContent = String(state.available.length);
  doneCount.textContent = String(state.done.length);
  const total = state.available.length + state.done.length;
  const pct = total ? Math.round((state.done.length / total) * 100) : 0;
  progressPct.textContent = `${pct}%`;
  // Visibilidad dinámica de UI
  const completed = pct === 100;
  // Mostrar/ocultar contenedor de decisión cuando se completó todo
  decision.style.display = completed ? 'none' : 'flex';
  completedMsg.hidden = !completed;
  restartBtn.hidden = !completed;
  // Botón "Descubre" solo cuando quede 1 disponible
  discoverBtn.hidden = state.available.length !== 1;
  // Deshabilitar botón Girar cuando no hay disponibles
  spinBtn.disabled = state.available.length === 0;
  // render historial
  doneList.innerHTML = '';
  state.done.forEach(item => {
    const li = document.createElement('li');
    const text = typeof item === 'string' ? item : item.text;
    const ts = typeof item === 'string' ? null : item.acceptedAt;
    const when = ts ? new Date(ts).toLocaleString() : '—';
    li.textContent = `${text} · ${when}`;
    doneList.appendChild(li);
  });
  drawWheel();
  if (completed) triggerConfetti();
  renderRejects();
}

function addOption(value) {
  const v = normalize(value);
  if (!v) return;
  // evitar duplicados entre available y done
  const existsDone = state.done.some(d => (typeof d === 'string' ? d : d.text) === v);
  const exists = state.available.includes(v) || existsDone;
  if (!exists) {
    state.available.push(v);
    save();
    updateStats();
  }
}

function removeAll() {
  state = { available: [], done: [], rejects: {} };
  current = null;
  save();
  updateStats();
  resultDiv.textContent = '';
  decision.hidden = true;
  acceptBtn.disabled = true;
  rejectBtn.disabled = true;
}

addForm.onsubmit = e => {
  e.preventDefault();
  addOption(optionInput.value);
  optionInput.value = '';
};

fileTrigger.onclick = () => fileInput.click();

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const lines = text
      .split(/\r?\n/)
      .map(l => normalize(l))
      .filter(Boolean);
    lines.forEach(addOption);
  } catch (err) {
    alert('No se pudo leer el archivo .txt');
  } finally {
    fileInput.value = '';
  }
});

spinBtn.onclick = () => {
  if (state.available.length === 0) {
    resultDiv.textContent = 'No hay opciones disponibles. Agrega o importa un .txt.';
    return;
  }
  startSpin();
};

acceptBtn.onclick = () => {
  if (!current) return;
  // mover de available -> done
  state.available = state.available.filter(x => x !== current);
  state.done.push({ text: current, acceptedAt: new Date().toISOString() });
  save();
  updateStats();
  resultDiv.textContent = `Marcado como hecho: ${current}`;
  current = null;
  decision.hidden = true;
  acceptBtn.disabled = true;
  rejectBtn.disabled = true;
};

rejectBtn.onclick = () => {
  // no mover, simplemente permitir volver a intentar
  if (!current) return;
  // Si solo queda una opción, no se puede rechazar
  if (state.available.length <= 1) {
    resultDiv.textContent = 'No puedes rechazar la única opción disponible.';
    rejectBtn.disabled = true;
    return;
  }
  resultDiv.textContent = 'Rechazado. Vuelve a girar.';
  // registrar rechazo
  const key = current;
  if (!state.rejects[key]) state.rejects[key] = [];
  state.rejects[key].push(new Date().toISOString());
  save();
  updateStats();
  current = null;
  decision.hidden = true;
  acceptBtn.disabled = true;
  rejectBtn.disabled = true;
};

clearBtn.onclick = () => {
  if (confirm('¿Seguro que quieres limpiar todos los datos?')) {
    removeAll();
  }
};

// (Inicialización se mueve al final, después de definir la rueda)

// ==================== Rueda (Canvas) ====================
let angle = 0; // ángulo actual (rad)
let angularVelocity = 0; // rad/s
let spinning = false;
let dragging = false;
let lastDragAngle = 0;
let lastTimestamp = 0;

function getCandidates() {
  if (state.available.length === 0) return [];
  return state.available.slice();
}

function drawWheel() {
  if (!ctx) return;
  const labels = getCandidates();
  const N = Math.max(labels.length, 1);
  const { width, height } = wheelCanvas;
  const r = Math.min(width, height) / 2 - 6;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);
  const colors = ['#93c5fd','#a7f3d0','#fde68a','#fca5a5','#c7d2fe','#f9a8d4','#fdba74'];
  for (let i = 0; i < N; i++) {
    const start = (i / N) * 2 * Math.PI;
    const end = ((i + 1) / N) * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, start, end);
    ctx.closePath();
    ctx.fillStyle = colors[i % colors.length];
    ctx.fill();
    // bordes
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // etiqueta (no mostramos texto real para mantener ocultas las opciones)
    ctx.save();
    ctx.rotate((start + end) / 2);
    ctx.fillStyle = 'rgba(30,41,59,0.4)';
    ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Opción ${i + 1}`, r * 0.62, 0);
    ctx.restore();
  }
  ctx.restore();
}

function step(ts) {
  if (!spinning) return;
  if (!lastTimestamp) lastTimestamp = ts;
  const dt = (ts - lastTimestamp) / 1000; // s
  lastTimestamp = ts;

  // fricción
  const friction = 0.995; // por frame ~60fps
  angle += angularVelocity * dt;
  angularVelocity *= Math.pow(friction, (dt * 60));

  // detener cuando sea muy lento
  if (Math.abs(angularVelocity) < 0.05) {
    spinning = false;
    angularVelocity = 0;
    lastTimestamp = 0;
    snapAndSelect();
    return;
  }
  drawWheel();
  requestAnimationFrame(step);
}

function startSpin(force = null) {
  decision.hidden = true;
  resultDiv.textContent = '';
  if (state.available.length === 0) {
    resultDiv.textContent = 'No hay opciones disponibles. Agrega o carga un .txt.';
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }
  // velocidad inicial aleatoria si no hay fuerza manual
  const sign = Math.random() > 0.5 ? 1 : -1;
  angularVelocity = force ?? (sign * (4 + Math.random() * 4)); // rad/s
  spinning = true;
  lastTimestamp = 0;
  requestAnimationFrame(step);
}

function snapAndSelect() {
  // Normalizar ángulo 0..2PI
  const TAU = Math.PI * 2;
  angle = ((angle % TAU) + TAU) % TAU;

  const labels = getCandidates();
  const N = labels.length;
  if (N === 0) {
    resultDiv.textContent = 'Sin opciones disponibles.';
    acceptBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }

  // Índice en el que apunta el puntero (a la derecha del círculo)
  const slice = TAU / N;
  // El puntero está a 0 rad (eje X positivo). Compensar por la rotación actual.
  // Invertimos sentido para que girar positivo avance segmentos en sentido horario visual.
  const idx = (N - Math.floor((angle) / slice)) % N;
  current = labels[idx];
  resultDiv.textContent = `${current}`; // sin prefijo
  decision.hidden = false;
  acceptBtn.disabled = false;
  rejectBtn.disabled = state.available.length <= 1; // si no hay alternativas, no se puede rechazar
  drawWheel();
}

// Interacciones de arrastre (mouse / touch)
function canvasCenter() {
  const rect = wheelCanvas.getBoundingClientRect();
  return { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
}

function angleFromEvent(ev) {
  const pt = ev.touches?.[0] ?? ev;
  const { cx, cy } = canvasCenter();
  const dx = pt.clientX - cx;
  const dy = pt.clientY - cy;
  return Math.atan2(dy, dx);
}

function onPointerDown(ev) {
  ev.preventDefault();
  dragging = true;
  spinning = false; // detener spin actual
  lastTimestamp = 0;
  lastDragAngle = angleFromEvent(ev) - angle;
}

function onPointerMove(ev) {
  if (!dragging) return;
  const a = angleFromEvent(ev);
  const newAngle = a - lastDragAngle;
  // estimar velocidad angular basada en movimiento reciente
  const da = newAngle - angle;
  angle = newAngle;
  angularVelocity = da * 30; // factor para convertir a rad/s aproximado
  drawWheel();
}

function onPointerUp(ev) {
  if (!dragging) return;
  dragging = false;
  // iniciar spin con la inercia actual
  if (Math.abs(angularVelocity) < 1) {
    // si es muy pequeña, darle un empujón mínimo
    angularVelocity = (angularVelocity >= 0 ? 1 : -1) * 2.5;
  }
  spinning = true;
  lastTimestamp = 0;
  requestAnimationFrame(step);
}

if (wheelCanvas) {
  wheelCanvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  wheelCanvas.addEventListener('touchstart', onPointerDown, { passive: false });
  window.addEventListener('touchmove', onPointerMove, { passive: false });
  window.addEventListener('touchend', onPointerUp);
}

// Inicializar (después de definir la rueda)
load();
updateStats();
acceptBtn.disabled = true;
rejectBtn.disabled = true;
drawWheel();

// Descubrir única opción disponible
if (discoverBtn) {
  discoverBtn.addEventListener('click', () => {
    if (state.available.length === 1) {
      current = state.available[0];
      resultDiv.textContent = `${current}`;
      decision.hidden = false;
      acceptBtn.disabled = false;
      rejectBtn.disabled = true; // no se puede rechazar si no hay alternativas
      drawWheel();
    }
  });
}

// Renderizar rechazos
function renderRejects() {
  const list = document.getElementById('rejects-list');
  if (!list) return;
  list.innerHTML = '';
  const entries = Object.entries(state.rejects || {});
  // ordenar por total de rechazos desc
  entries.sort((a,b) => (b[1]?.length||0) - (a[1]?.length||0));
  if (entries.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Sin rechazos todavía';
    list.appendChild(li);
    return;
  }
  for (const [text, times] of entries) {
    const li = document.createElement('li');
    const count = times.length;
    const when = times.map(t => new Date(t).toLocaleString()).join(', ');
    li.textContent = `${text} · rechazos: ${count}${count ? ' · ' + when : ''}`;
    list.appendChild(li);
  }
}

// Reiniciar (limpia todo)
if (restartBtn) {
  restartBtn.addEventListener('click', () => {
    if (confirm('Esto reiniciará todo el progreso. ¿Continuar?')) {
      removeAll();
    }
  });
}

// ==================== Confeti ====================
let confettiRunning = false;
let confettiParticles = [];

function resizeConfettiCanvas() {
  if (!confettiCanvas) return;
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
resizeConfettiCanvas();
window.addEventListener('resize', resizeConfettiCanvas);

function spawnConfetti(n = 180) {
  const colors = ['#22c55e','#3b82f6','#f59e0b','#ef4444','#a855f7','#06b6d4'];
  confettiParticles = Array.from({ length: n }, () => ({
    x: Math.random() * confettiCanvas.width,
    y: -20 - Math.random() * 200,
    vx: (Math.random() - 0.5) * 4,
    vy: 2 + Math.random() * 4,
    size: 4 + Math.random() * 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI * 2,
    vr: (Math.random() - 0.5) * 0.3
  }));
}

function drawConfetti() {
  if (!confettiCtx) return;
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  for (const p of confettiParticles) {
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rot);
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.size/2, -p.size/2, p.size, p.size);
    confettiCtx.restore();
  }
}

function stepConfetti() {
  if (!confettiRunning) return;
  for (const p of confettiParticles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.02; // gravedad
    p.rot += p.vr;
    if (p.y > confettiCanvas.height + 40) {
      // reciclar arriba
      p.y = -20;
      p.x = Math.random() * confettiCanvas.width;
      p.vy = 2 + Math.random() * 4;
    }
  }
  drawConfetti();
  requestAnimationFrame(stepConfetti);
}

function triggerConfetti() {
  if (!confettiCanvas || confettiRunning) return;
  confettiCanvas.hidden = false;
  confettiRunning = true;
  spawnConfetti();
  drawConfetti();
  stepConfetti();
  // detener tras unos segundos
  setTimeout(() => {
    confettiRunning = false;
    confettiCanvas.hidden = true;
  }, 5000);
}
