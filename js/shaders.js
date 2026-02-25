// shaders.js — CRT / Night Vision / FLIR post-processing via canvas overlay

const Shaders = (() => {
  let canvas, ctx;
  let currentMode = 'normal'; // normal, crt, nvg, flir
  let time = 0;
  let animFrame = null;

  function init() {
    canvas = document.getElementById('shader-overlay');
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
    tick();
  }

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function setMode(mode) {
    currentMode = mode;

    // Show mode indicator
    const indicator = document.getElementById('mode-indicator');
    if (mode === 'normal') {
      indicator.classList.remove('visible');
    } else {
      indicator.textContent = mode.toUpperCase();
      indicator.className = 'visible ' + mode;
      // Auto-hide after 2s
      setTimeout(() => indicator.classList.remove('visible'), 2000);
    }

    // Apply Cesium scene color grading for NVG/FLIR
    const scene = Globe.getViewer()?.scene;
    if (!scene) return;

    if (mode === 'nvg') {
      scene.postProcessStages.ambientOcclusion.enabled = false;
    } else if (mode === 'flir') {
      scene.postProcessStages.ambientOcclusion.enabled = false;
    } else {
      scene.postProcessStages.ambientOcclusion.enabled = false;
    }
  }

  function getMode() {
    return currentMode;
  }

  function tick() {
    time += 0.016;
    if (currentMode !== 'normal') {
      render();
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    animFrame = requestAnimationFrame(tick);
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    switch (currentMode) {
      case 'crt': renderCRT(w, h); break;
      case 'nvg': renderNVG(w, h); break;
      case 'flir': renderFLIR(w, h); break;
    }
  }

  function renderCRT(w, h) {
    // Scanlines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }

    // Flicker
    const flicker = Math.sin(time * 8) * 0.02;
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.abs(flicker)})`;
    ctx.fillRect(0, 0, w, h);

    // Rolling bar (subtle horizontal interference)
    const barY = (time * 100) % (h + 200) - 100;
    const grad = ctx.createLinearGradient(0, barY - 40, 0, barY + 40);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(0.5, 'rgba(0, 0, 0, 0.04)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, barY - 40, w, 80);

    // Vignette
    drawVignette(w, h, 0.4);

    // Green phosphor tint
    ctx.fillStyle = 'rgba(0, 255, 65, 0.03)';
    ctx.fillRect(0, 0, w, h);
  }

  function renderNVG(w, h) {
    // Green overlay
    ctx.fillStyle = 'rgba(0, 255, 65, 0.05)';
    ctx.fillRect(0, 0, w, h);

    // Noise grain
    const imageData = ctx.createImageData(w, h);
    const data = imageData.data;
    // Sparse noise for performance
    for (let i = 0; i < data.length; i += 16) {
      const noise = Math.random() * 15;
      data[i] = 0;           // R
      data[i + 1] = noise;   // G
      data[i + 2] = 0;       // B
      data[i + 3] = noise;   // A
    }
    ctx.putImageData(imageData, 0, 0);

    // Heavy vignette (tube effect)
    drawVignette(w, h, 0.7);

    // Circular tube border
    ctx.beginPath();
    const cx = w / 2, cy = h / 2;
    const radius = Math.min(w, h) * 0.48;
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.closePath();

    // Fill outside circle with dark
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, radius, 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.fill();
    ctx.restore();
  }

  function renderFLIR(w, h) {
    // Warm overlay
    ctx.fillStyle = 'rgba(255, 140, 0, 0.04)';
    ctx.fillRect(0, 0, w, h);

    // Scanlines (wider)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.03)';
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 2);
    }

    // Vignette
    drawVignette(w, h, 0.3);

    // FLIR crosshair markings
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    const cx = w / 2, cy = h / 2;

    // Corner brackets
    const s = 30;
    ctx.beginPath();
    // Top-left
    ctx.moveTo(cx - s, cy - s + 10); ctx.lineTo(cx - s, cy - s); ctx.lineTo(cx - s + 10, cy - s);
    // Top-right
    ctx.moveTo(cx + s - 10, cy - s); ctx.lineTo(cx + s, cy - s); ctx.lineTo(cx + s, cy - s + 10);
    // Bottom-right
    ctx.moveTo(cx + s, cy + s - 10); ctx.lineTo(cx + s, cy + s); ctx.lineTo(cx + s - 10, cy + s);
    // Bottom-left
    ctx.moveTo(cx - s + 10, cy + s); ctx.lineTo(cx - s, cy + s); ctx.lineTo(cx - s, cy + s - 10);
    ctx.stroke();
  }

  function drawVignette(w, h, intensity) {
    const cx = w / 2, cy = h / 2;
    const radius = Math.max(w, h) * 0.7;
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.3, cx, cy, radius);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    grad.addColorStop(1, `rgba(0, 0, 0, ${intensity})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  return { init, setMode, getMode };
})();
