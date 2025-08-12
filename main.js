// main.js
const STORAGE_KEY = 'ruleta-opciones-v2';

const optionInput = document.getElementById('option-input');
const addForm = document.getElementById('add-form');
const fileInput = document.getElementById('file-input');
const fileTrigger = document.getElementById('file-trigger');
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
const wheelCanvas = document.getElementById('wheel');
const ctx = wheelCanvas.getContext?.('2d');

// Estructura: { available: string[], done: Array<string | {text:string, acceptedAt:string}>, recentRejected: string[] }
let state = { available: [], done: [], recentRejected: [] };
let current = null; // opción actualmente mostrada

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function load() {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? JSON.parse(saved) : { available: [], done: [], recentRejected: [] };
  // asegurar campos por compatibilidad hacia atrás
  if (!Array.isArray(state.available)) state.available = [];
  if (!Array.isArray(state.done)) state.done = [];
  if (!Array.isArray(state.recentRejected)) state.recentRejected = [];
  // migrar done de strings a objetos con marca de tiempo opcional
  state.done = state.done.map(d => typeof d === 'string' ? { text: d, acceptedAt: null } : d);
}

function updateStats() {
  availableCount.textContent = String(state.available.length);
  doneCount.textContent = String(state.done.length);
  const total = state.available.length + state.done.length;
  const pct = total ? Math.round((state.done.length / total) * 100) : 0;
  progressPct.textContent = `${pct}%`;
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
  state = { available: [], done: [], recentRejected: [] };
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
  startSpin();
};

acceptBtn.onclick = () => {
  if (!current) return;
  // mover de available -> done
  state.available = state.available.filter(x => x !== current);
  state.done.push({ text: current, acceptedAt: new Date().toISOString() });
  // quitar de cooldown si estaba
  state.recentRejected = state.recentRejected.filter(x => x !== current);
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
  // agregar a cooldown (no repetir por los próximos 3 giros)
  state.recentRejected = [current, ...state.recentRejected.filter(x => x !== current)].slice(0, 3);
  save();
  resultDiv.textContent = 'Rechazado. Vuelve a girar.';
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
  const pool = state.available.filter(o => !state.recentRejected.includes(o));
  return pool.length > 0 ? pool : state.available.slice();
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
  rejectBtn.disabled = false;
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
