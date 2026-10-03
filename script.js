const canvas = document.getElementById('heroChart');
const ctx = canvas.getContext('2d');

let priceSeries = [];
let tick = 0;

function setDemoData() {
  const base = 50000 + Math.sin(tick / 8) * 1200 + Math.random() * 420;
  const nextValue = Math.max(48000, base);
  priceSeries.push(nextValue);
  if (priceSeries.length > 120) priceSeries.shift();
  tick += 1;
}

function resizeCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * ratio);
  canvas.height = Math.floor(rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawChart();
}

function drawChart() {
  if (!canvas) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0d131d');
  bg.addColorStop(1, '#090d13');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.065)';
  ctx.lineWidth = 1;
  for (let y = 0; y <= h; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let x = 0; x <= w; x += 42) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  if (priceSeries.length > 2) {
    const min = Math.min(...priceSeries);
    const max = Math.max(...priceSeries);
    const range = max - min || 1;

    const points = priceSeries.map((value, index) => {
      const x = (index / (priceSeries.length - 1)) * w;
      const y = h - ((value - min) / range) * (h - 50) - 20;
      return { x, y };
    });

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(141,156,255,0.55)');
    gradient.addColorStop(1, 'rgba(57,209,139,0.7)');

    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineWidth = 2.8;
    ctx.shadowBlur = 18;
    ctx.shadowColor = 'rgba(141,156,255,0.4)';
    ctx.strokeStyle = gradient;
    ctx.stroke();
    ctx.shadowBlur = 0;

    const area = ctx.createLinearGradient(0, 0, 0, h);
    area.addColorStop(0, 'rgba(141,156,255,0.35)');
    area.addColorStop(1, 'rgba(141,156,255,0.02)');
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = area;
    ctx.fill();

    const last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#38d89d';
    ctx.fill();

    ctx.fillStyle = '#edf3fb';
    ctx.font = 'bold 11px IBM Plex Mono';
    ctx.textAlign = 'center';
    ctx.fillText(String(Math.round(last.y)), last.x, last.y - 15);
  } else {
    const t = Date.now() / 700;
    ctx.beginPath();
    ctx.moveTo(0, h - 70);
    for (let x = 0; x <= w; x += 24) {
      const y = h - 70 - Math.sin((x / w) * Math.PI * 3 + t) * 60;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(141,156,255,0.82)';
    ctx.lineWidth = 2.4;
    ctx.shadowBlur = 14;
    ctx.shadowColor = 'rgba(141,156,255,0.3)';
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  ctx.fillStyle = 'rgba(11,16,22,0.88)';
  ctx.fillRect(w - 214, 18, 186, 72);
  ctx.strokeStyle = 'rgba(141,156,255,0.22)';
  ctx.strokeRect(w - 214, 18, 186, 72);

  ctx.fillStyle = '#edf3fb';
  ctx.font = '700 12px IBM Plex Mono';
  ctx.fillText('IDMarks LIVE', w - 196, 42);

  const status = priceSeries.length > 3 ? 'SYNCED' : 'READY';
  const statusColor = priceSeries.length > 3 ? '#38d89d' : '#f7c45d';
  ctx.fillStyle = statusColor;
  ctx.fillText(status, w - 196, 60);

  ctx.fillStyle = 'rgba(237,243,251,0.6)';
  ctx.font = '10px IBM Plex Mono';
  ctx.fillText('demo analytics', w - 196, 75);
}

function tickChart() {
  setDemoData();
  drawChart();
}

window.addEventListener('resize', resizeCanvas);
window.addEventListener('load', () => {
  resizeCanvas();
  setDemoData();
  setInterval(tickChart, 600);
});
