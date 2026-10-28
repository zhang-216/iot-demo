const MAX_POINTS = 60;

const state = {
  readings: [],
  connected: false,
};

const els = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  topic: document.getElementById('topic'),
  broker: document.getElementById('broker'),
  current: document.getElementById('current'),
  max: document.getElementById('max'),
  min: document.getElementById('min'),
  avg: document.getElementById('avg'),
  count: document.getElementById('count'),
  chart: document.getElementById('chart'),
  empty: document.getElementById('empty'),
  rows: document.getElementById('rows'),
};

function setStatus(stateName, text) {
  els.status.dataset.state = stateName;
  els.statusText.textContent = text;
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
}

function addReading(reading) {
  state.readings.push(reading);
  if (state.readings.length > MAX_POINTS) state.readings.shift();
  render();
}

function render() {
  const temps = state.readings.map((r) => r.temperature);
  const hasData = temps.length > 0;
  const last = temps[temps.length - 1];

  els.current.innerHTML = hasData
    ? `${last.toFixed(1)}<small>°C</small>`
    : '--<small>°C</small>';
  els.max.textContent = hasData ? `${Math.max(...temps).toFixed(1)} °C` : '--';
  els.min.textContent = hasData ? `${Math.min(...temps).toFixed(1)} °C` : '--';
  els.avg.textContent = hasData
    ? `${(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)} °C`
    : '--';
  els.count.textContent = temps.length;

  els.empty.hidden = hasData;

  renderRows();
  drawChart();
}

function renderRows() {
  const recent = state.readings.slice(-12).reverse();
  els.rows.innerHTML = recent
    .map(
      (r) =>
        `<tr><td>${formatTime(r.timestamp)}</td><td>${r.temperature.toFixed(2)}</td></tr>`
    )
    .join('');
}

function drawChart() {
  const canvas = els.chart;
  const wrap = canvas.parentElement;
  const rect = wrap.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const W = rect.width;
  const H = rect.height;
  const pad = { top: 18, right: 18, bottom: 30, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const temps = state.readings.map((r) => r.temperature);

  if (temps.length === 0) {
    drawPlaceholderAxis(ctx, W, H, pad);
    return;
  }

  let min = Math.min(...temps);
  let max = Math.max(...temps);
  if (max - min < 8) {
    const mid = (max + min) / 2;
    min = mid - 4;
    max = mid + 4;
  }
  const rangePad = (max - min) * 0.15;
  min = Math.floor(min - rangePad);
  max = Math.ceil(max + rangePad);

  const yOf = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH;
  const xOf = (i) => pad.left + (i / (MAX_POINTS - 1)) * plotW;

  ctx.font = '11px "Segoe UI", "PingFang SC", sans-serif';
  ctx.textBaseline = 'middle';

  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const value = min + ((max - min) * i) / gridCount;
    const y = yOf(value);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();

    ctx.fillStyle = '#8095ab';
    ctx.textAlign = 'right';
    ctx.fillText(`${value.toFixed(1)}°`, pad.left - 10, y);
  }

  const points = temps.map((v, i) => ({ x: xOf(i), y: yOf(v), v }));

  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, 'rgba(45, 212, 191, 0.32)');
  gradient.addColorStop(1, 'rgba(45, 212, 191, 0.02)');

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    ctx.bezierCurveTo(midX, prev.y, midX, curr.y, curr.x, curr.y);
  }

  ctx.save();
  ctx.lineTo(points[points.length - 1].x, pad.top + plotH);
  ctx.lineTo(points[0].x, pad.top + plotH);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const midX = (prev.x + curr.x) / 2;
    ctx.bezierCurveTo(midX, prev.y, midX, curr.y, curr.x, curr.y);
  }
  ctx.strokeStyle = '#2dd4bf';
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  const last = points[points.length - 1];
  ctx.beginPath();
  ctx.arc(last.x, last.y, 7, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(45, 212, 191, 0.18)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(last.x, last.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#2dd4bf';
  ctx.fill();

  ctx.fillStyle = '#8095ab';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelIdx = [0, Math.floor((points.length - 1) / 2), points.length - 1];
  const shown = new Set();
  for (const idx of labelIdx) {
    if (shown.has(idx)) continue;
    shown.add(idx);
    ctx.fillText(formatTime(state.readings[idx].timestamp), points[idx].x, H - pad.bottom + 12);
  }
}

function drawPlaceholderAxis(ctx, W, H, pad) {
  ctx.font = '11px "Segoe UI", "PingFang SC", sans-serif';
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + ((H - pad.top - pad.bottom) * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
  }
}

async function loadInitial() {
  try {
    const res = await fetch('/api/readings');
    const data = await res.json();

    els.topic.textContent = data.topic;
    els.broker.textContent = data.broker;
    state.readings = Array.isArray(data.readings) ? data.readings : [];
    state.connected = data.connected;

    setStatus(
      data.connected ? 'connected' : 'disconnected',
      data.connected ? 'MQTT 已连接' : 'MQTT 未连接'
    );
    render();
  } catch (err) {
    console.error('加载历史数据失败:', err);
    setStatus('disconnected', '无法获取数据');
  }
}

function connectStream() {
  const source = new EventSource('/events');

  source.addEventListener('status', (event) => {
    const data = JSON.parse(event.data);
    state.connected = data.connected;
    els.topic.textContent = data.topic;
    els.broker.textContent = data.broker;
    setStatus(
      data.connected ? 'connected' : 'disconnected',
      data.connected ? 'MQTT 已连接' : 'MQTT 未连接'
    );
  });

  source.addEventListener('reading', (event) => {
    addReading(JSON.parse(event.data));
  });

  source.onerror = () => {
    setStatus('connecting', '重连中…');
  };
}

window.addEventListener('resize', drawChart);

loadInitial();
connectStream();
