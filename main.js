let audioCtx, analyser, micStream;
let running = false;
let calibOffset = 110;
let lastBuffer = null;

const canvas = document.getElementById("psdCanvas");
const ctx = canvas.getContext("2d");

// 1/3オクターブバンドの中心周波数と補正値
const CENTER_FREQUENCIES = [
  25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 
  1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500
];
const A_CORRECTION = [-17,-14,-11,-9,-7,-5,-4,-3,-2,-1,0,0,0,0,0,0,0,0.5,1,2,3,4,4,3,1,0,-2,-5];

function resizeCanvas() {
  canvas.width = canvas.clientWidth;
  canvas.height = canvas.clientHeight;
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

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

async function startAudio() {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 16384; 
    src.connect(analyser);

    running = true;
    document.getElementById("startStopBtn").textContent = "Stop";
    requestAnimationFrame(updateLoop);
  } catch (e) {
    console.error("Microphone access denied", e);
  }
}

function stopAudio() {
  running = false;
  document.getElementById("startStopBtn").textContent = "Start";
  if (micStream) micStream.getTracks().forEach(t => t.stop());
}

// ------------------------------
// Main Loop
// ------------------------------
function updateLoop() {
  if (!running) return;

  const buffer = new Float32Array(analyser.frequencyBinCount);
  analyser.getFloatFrequencyData(buffer);
  
  // 各種パラメータ計算
  const results = calculateAcousticParameters(buffer, analyser.context.sampleRate);
  
  // UI更新
  document.getElementById("dbaValue").textContent = results.dBA.toFixed(1);
  document.getElementById("LoudnessValue").textContent = results.loudness.toFixed(2);
  document.getElementById("sharpnessValue").textContent = results.sharpness.toFixed(2);

  // 描画
  drawPSD(buffer, analyser.context.sampleRate);
  
  requestAnimationFrame(updateLoop);
}

// ------------------------------
// Acoustic Calculation
// ------------------------------
function calculateAcousticParameters(buffer, sampleRate) {
  const binHz = sampleRate / (buffer.length * 2);
  let bandsEnergy = new Array(CENTER_FREQUENCIES.length).fill(0);
  let totalEnergyA = 0;

  for (let i = 0; i < buffer.length; i++) {
    let freq = i * binHz;
    if (freq < 20 || freq > 20000) continue;

    let dbRaw = buffer[i] + calibOffset;
    let energy = Math.pow(10, dbRaw / 10);

    // dBA計算用
    let dbA = dbRaw + Aweight(freq);
    totalEnergyA += Math.pow(10, dbA / 10);

    // 1/3オクターブバンド集約
    for (let j = 0; j < CENTER_FREQUENCIES.length; j++) {
      let lower = CENTER_FREQUENCIES[j] / 1.122;
      let upper = CENTER_FREQUENCIES[j] * 1.122;
      if (freq >= lower && freq < upper) {
        bandsEnergy[j] += energy;
        break;
      }
    }
  }

  // 比ラウドネスとマスキング
  let nSpec = new Array(CENTER_FREQUENCIES.length).fill(0);
  for (let i = 0; i < CENTER_FREQUENCIES.length; i++) {
    if (bandsEnergy[i] > 0) {
      let avgDb = 10 * Math.log10(bandsEnergy[i]);
      let correctedLevel = avgDb + A_CORRECTION[i];
      // Zwicker簡略式
      nSpec[i] = 0.063 * Math.pow(10, 0.023 * correctedLevel);
    }
  }

  // 高域スロープ処理
  const s = 0.85;
  for (let i = 1; i < nSpec.length; i++) {
    nSpec[i] = Math.max(nSpec[i], nSpec[i - 1] * s);
  }

  const totalSone = nSpec.reduce((sum, val) => sum + val, 0);

  // シャープネス (Aures法)
  let sharpness = 0;
  if (totalSone > 0) {
    let weightedSum = 0;
    for (let i = 0; i < nSpec.length; i++) {
      let z = hzToBark(CENTER_FREQUENCIES[i]);
      let gz = (z <= 15) ? 1.0 : Math.exp(0.171 * (z - 15));
      weightedSum += nSpec[i] * gz * z;
    }
    sharpness = 0.11 * (weightedSum / totalSone);
  }

  return {
    loudness: totalSone,
    sharpness: sharpness,
    dBA: 10 * Math.log10(totalEnergyA + 1e-12)
  };
}

// ------------------------------
// Drawing & Utils
// ------------------------------
function drawPSD(buffer, sampleRate) {
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, W, H);
  drawGrid(W, H);

  const binHz = sampleRate / (buffer.length * 2);
  ctx.strokeStyle = "#00FF00";
  ctx.lineWidth = 2;
  ctx.beginPath();

  let first = true;
  for (let i = 0; i < buffer.length; i++) {
    const f = i * binHz;
    if (f < 20 || f > 20000) continue;
    const db = buffer[i] + calibOffset;
    const x = freqToX(f, W);
    const y = dBToY(db, H);
    if (first) { ctx.moveTo(x, y); first = false; }
    else { ctx.lineTo(x, y); }
  }
  ctx.stroke();
}

function freqToX(f, W) { return W * (Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20)); }
function dBToY(dB, H) { return H * (100 - dB) / 100; } // 表示レンジを0-100dBに調整

function drawGrid(W, H) {
  ctx.strokeStyle = "#333";
  // 周波数グリッドとdBグリッドの描画 (省略せず既存のdrawGridロジックを維持)
  // ... (既存のdrawGridの内容をここに)
}

function Aweight(f) {
  const f2 = f*f;
  const num = 12200*12200 * f2*f2;
  const den = (f2 + 20.6*20.6) * Math.sqrt((f2 + 107.7*107.7)*(f2 + 737.9*737.9)) * (f2 + 12200*12200);
  return 2.0 + 20*Math.log10(num/den);
}

function hzToBark(f) {
  return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan(Math.pow(f / 7500, 2));
}