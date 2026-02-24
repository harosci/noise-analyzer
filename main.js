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
  // const { loudness, sharpness } = calcLoudnessSharpness(barkEnergy);
  // アロー関数で包んで実行する
  
const timerId = setInterval(() => {
    const res = calculateAcousticParameters(analyser);
    document.getElementById("dbaValue").textContent = dBA.toFixed(1);
    document.getElementById("LoudnessValue").textContent = res.loudness.toFixed(2);
    document.getElementById("sharpnessValue").textContent = res.sharpness.toFixed(2);
  }, 100);

  // document.getElementById("loudnessValue").textContent = loudness.toFixed(2);
  // document.getElementById("sharpnessValue").textContent = sharpness.toFixed(2);
  // dBA
  // const dBA = calc_dBA(buffer, binHz);
  // document.getElementById("dbaValue").textContent = dBA.toFixed(1);
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
// Bark scale
// ------------------------------
function bark(f) {
  return 13 * Math.atan(0.00076 * f) +
         3.5 * Math.atan(Math.pow(f/7500, 2));
}

/* // ------------------------------
// Loudness (sone) + Sharpness (acum)
// ------------------------------
function calcLoudnessSharpness(barkEnergy) {
  const barkDB = barkEnergy.map(v => 10 * Math.log10(v + 1e-12));

  const Nspec = barkDB.map(L => Math.pow(Math.max(0, L - 40), 0.23));

  const loudness = Nspec.reduce((a,b)=>a+b, 0);

  let num = 0, den = 0;
  for (let z=0; z<24; z++) {
    const g = (z <= 15) ? 1 : (1 + 0.15*(z-15));
    num += Nspec[z] * g * z;
    den += Nspec[z];
  }
  const sharpness = num / den;

  return { loudness, sharpness };
} */

// ------------------------------
// Loudness, Sharpness (new)
// ------------------------------
// 1. 定数定義
const CENTER_FREQUENCIES = [
    25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 
    1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500
];
// 等感度補正 a_i (dB)
const A_CORRECTION = [-17,-14,-11,-9,-7,-5,-4,-3,-2,-1,0,0,0,0,0,0,0,0.5,1,2,3,4,4,3,1,0,-2,-5];
// 周波数(Hz)からBarkスケールへの変換関数
function hzToBark(f) {
    return 13 * Math.atan(0.00076 * f) + 3.5 * Math.atan(Math.pow(f / 7500, 2));
}
/**
 * AnalyserNodeから音響パラメータを計算する
 */
function calculateAcousticParameters(analyser) {
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray); // FFT結果(dB)を取得

    const sampleRate = analyser.context.sampleRate;
    const binHz = sampleRate / (bufferLength * 2);

    let bandsEnergy = new Array(28).fill(0);

    // --- STEP 1: FFTビンを1/3オクターブバンドに統合 ---
    for (let i = 0; i < bufferLength; i++) {
        let freq = i * binHz;
        if (freq < 20) continue;

        for (let j = 0; j < CENTER_FREQUENCIES.length; j++) {
            let lower = CENTER_FREQUENCIES[j] / Math.pow(2, 1/6);
            let upper = CENTER_FREQUENCIES[j] * Math.pow(2, 1/6);
            if (freq >= lower && freq < upper) {
                // dBをリニアなエネルギーに変換して加算
                let db = (dataArray[i] / 255) * 100; // 100dBを最大値と仮定
                bandsEnergy[j] += Math.pow(10, db / 10);
                break;
            }
        }
    }

    // --- STEP 2: 比ラウドネス N' の計算 ---
    let nSpec = new Array(28).fill(0);
    for (let i = 0; i < 28; i++) {
        if (bandsEnergy[i] > 0) {
            let avgDb = 10 * Math.log10(bandsEnergy[i]);
            let correctedLevel = avgDb + A_CORRECTION[i];
            // 比ラウドネス (Zwicker近似式)
            nSpec[i] = 0.063 * Math.pow(10, 0.023 * correctedLevel);
        }
    }

    // --- STEP 3: マスキング処理 (高域スロープ) ---
    const s = 0.85; 
    for (let i = 1; i < 28; i++) {
        if (nSpec[i] < nSpec[i - 1] * s) {
            nSpec[i] = nSpec[i - 1] * s;
        }
    }

    // --- STEP 4: 総ラウドネス (Loudness) の算出 ---
    const totalSone = nSpec.reduce((sum, val) => sum + val, 0);

    // --- STEP 5: シャープネス (Sharpness - Aures法) の算出 ---
    let sharpness = 0;
    if (totalSone > 0) {
        let weightedSum = 0;
        for (let i = 0; i < 28; i++) {
            let z = hzToBark(CENTER_FREQUENCIES[i]);
            // Auresの重み関数 g(z)
            // 高域(zが大きい)ほど重くなる指数関数
            let gz = 0.11 * z * (Math.exp(0.171 * z) / totalSone);
            weightedSum += nSpec[i] * gz * 0.33; // 0.33は1/3 oct幅の調整
        }
        sharpness = weightedSum;
    }

    return {
        loudness: totalSone, // 単位: sone
        sharpness: sharpness // 単位: acum
    };
}
