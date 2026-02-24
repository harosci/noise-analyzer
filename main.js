let audioCtx, analyser, micStream;
let running = false;
let calibOffset = 110;
let drawTimer = null;
let lastBuffer = null;

const canvas = document.getElementById("psdCanvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", () => {
  resizeCanvas();
  if (!running) {
    drawLastFrame();
  }
});
resizeCanvas();

function drawLastFrame() {
  if (!lastBuffer) return;

  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, W, H);

  drawGrid(W, H);

  const sampleRate = audioCtx ? audioCtx.sampleRate : 48000;
  const binHz = sampleRate / 32768;

  ctx.strokeStyle = "#00FF00";
  ctx.lineWidth = 2;
  ctx.beginPath();

  let first = true;

  for (let i = 0; i < lastBuffer.length; i++) {
    const f = i * binHz;
    if (f < 20 || f > 20000) continue;

    const dB = lastBuffer[i];
    const x = freqToX(f, W);
    const y = dBToY(dB, H);

    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
}

// ------------------------------
// Start / Stop
// ------------------------------
document.getElementById("startStopBtn").onclick = async () => {
  if (!running) startAudio();
  else stopAudio();
};

document.getElementById("calibBtn").onclick = () => {
  document.getElementById("calibDialog").style.display = "block";
  document.getElementById("calibInput").value = calibOffset;
};

document.getElementById("calibOk").onclick = () => {
  calibOffset = parseFloat(document.getElementById("calibInput").value);
  document.getElementById("calibDialog").style.display = "none";
};

document.getElementById("calibCancel").onclick = () => {
  document.getElementById("calibDialog").style.display = "none";
};

// ------------------------------
// Audio Start
// ------------------------------
async function startAudio() {
  audioCtx = new AudioContext();

  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      highpassFilter: false,
      voiceIsolation: false,
      googEchoCancellation: false,
      googNoiseSuppression: false,
      googAutoGainControl: false
    }
  });

  const src = audioCtx.createMediaStreamSource(micStream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 16384;   // 分解能

  src.connect(analyser);

  running = true;
  document.getElementById("startStopBtn").textContent = "Stop";

  drawTimer = setInterval(drawPSD, 100);  // 更新
}

// ------------------------------
// Audio Stop
// ------------------------------
function stopAudio() {
  running = false;
  document.getElementById("startStopBtn").textContent = "Start";

  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
  }
  if (drawTimer) clearInterval(drawTimer);
}

// ------------------------------
// PSD + Loudness + Sharpness
// ------------------------------
function drawPSD() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, W, H);

  drawGrid(W, H);

  const buffer = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(buffer);
  lastBuffer = buffer.slice();

  const sampleRate = audioCtx.sampleRate;
  const binHz = sampleRate / analyser.fftSize;

  ctx.strokeStyle = "#00FF00";
  ctx.lineWidth = 2;
  ctx.beginPath();

  let first = true;

  // Bark band accumulation
  const barkEnergy = new Array(24).fill(0);

  for (let i = 0; i < buffer.length; i++) {
    const f = i * binHz;
    if (f < 20 || f > 20000) continue;

    const A = Aweight(f);
    const dB = buffer[i] + A + calibOffset;

    // PSD line
    const x = freqToX(f, W);
    const y = dBToY(dB, H);

    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }

    // Loudness accumulation
    const z = bark(f);
    const zi = Math.min(23, Math.floor(z));
    barkEnergy[zi] += Math.pow(10, dB / 10);
  }
  ctx.stroke();

  // Loudness & Sharpness
  const { loudness, sharpness } = calcLoudnessSharpness(barkEnergy);

  document.getElementById("loudnessValue").textContent = loudness.toFixed(2);
  document.getElementById("sharpnessValue").textContent = sharpness.toFixed(2);

  // dBA
  const dBA = calc_dBA(buffer, binHz);
  document.getElementById("dbaValue").textContent = dBA.toFixed(1);
}

// ------------------------------
// Frequency → X
// ------------------------------
function freqToX(f, W) {
  return W * (Math.log10(f) - Math.log10(20)) /
             (Math.log10(20000) - Math.log10(20));
}

// ------------------------------
// dB → Y
// ------------------------------
function dBToY(dB, H) {
  return H * (40 - dB) / 80;
}

// ------------------------------
// Grid
// ------------------------------
function drawGrid(W, H) {
  const freqs = [
    20,30,40,50,60,70,80,90,
    100,200,300,400,500,600,700,800,900,
    1000,2000,3000,4000,5000,6000,7000,8000,9000,
    10000,20000
  ];

  for (const f of freqs) {
    const x = freqToX(f, W);
    ctx.strokeStyle = (f===100 || f===1000 || f===10000) ? "#555" : "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  const labels = [
    {f:20, text:"20"},
    {f:100, text:"100"},
    {f:1000, text:"1k"},
    {f:10000, text:"10k"},
    {f:20000, text:"20k"}
  ];

  ctx.fillStyle = "white";
  ctx.font = "12px sans-serif";
  for (const L of labels) {
    const x = freqToX(L.f, W);
    ctx.fillText(L.text, x+2, H-2);
  }

  for (let d=-40; d<=40; d+=2) {
    const y = dBToY(d, H);
    ctx.strokeStyle = (d%20===0) ? "#555" : "#333";
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  const dLabels = [-40,-20,0,20,40];
  for (const d of dLabels) {
    const y = dBToY(d, H);
    ctx.fillText(d.toString(), 2, y-2);
  }
}

// ------------------------------
// A-weighting
// ------------------------------
function Aweight(f) {
  const f2 = f*f;
  const num = 12200*12200 * f2*f2;
  const den = (f2 + 20.6*20.6) *
              Math.sqrt((f2 + 107.7*107.7)*(f2 + 737.9*737.9)) *
              (f2 + 12200*12200);
  return 2.0 + 20*Math.log10(num/den);
}

// ------------------------------
// dBA
// ------------------------------
function calc_dBA(buffer, binHz) {
  let sum = 0;
  for (let i=0; i<buffer.length; i++) {
    const f = i * binHz;
    if (f < 20 || f > 20000) continue;
    const A = Aweight(f);
    const dB = buffer[i] + A + calibOffset;
    sum += Math.pow(10, dB/10);
  }
  return 10 * Math.log10(sum);
}

// ------------------------------
// Bark scale
// ------------------------------
function bark(f) {
  return 13 * Math.atan(0.00076 * f) +
         3.5 * Math.atan(Math.pow(f/7500, 2));
}

// ------------------------------
// Loudness (sone) + Sharpness (acum)
// ------------------------------
function calcLoudnessSharpness(barkEnergy) {
  const barkDB = barkEnergy.map(v => 10 * Math.log10(v + 1e-12));

  const Nspec = barkDB.map(L => Math.pow(Math.max(0, L - 30), 0.23));

  const loudness = Nspec.reduce((a,b)=>a+b, 0);

  let num = 0, den = 0;
  for (let z=0; z<24; z++) {
    const g = (z <= 15) ? 1 : (1 + 0.15*(z-15));
    num += Nspec[z] * g * z;
    den += Nspec[z];
  }
  const sharpness = num / den;

  return { loudness, sharpness };
}