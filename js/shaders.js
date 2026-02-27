// shaders.js — CRT / Night Vision / FLIR post-processing via CSS
// No canvas, no rAF loop — all GPU-composited backgrounds + CSS animations

const Shaders = (() => {
  let overlay;
  let currentMode = 'normal';

  function init() {
    overlay = document.getElementById('shader-overlay');
    generateNoiseTile();
  }

  // Pre-render a small noise texture once, use as repeating CSS background
  function generateNoiseTile() {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = Math.random() * 20;
      data[i]     = 0;      // R
      data[i + 1] = noise;  // G
      data[i + 2] = 0;      // B
      data[i + 3] = noise;  // A
    }
    ctx.putImageData(imageData, 0, 0);
    overlay.style.setProperty('--noise-bg', `url(${c.toDataURL()})`);
  }

  function setMode(mode) {
    currentMode = mode;
    overlay.className = mode === 'normal' ? '' : mode;

    // Show mode indicator
    const indicator = document.getElementById('mode-indicator');
    if (mode === 'normal') {
      indicator.classList.remove('visible');
    } else {
      indicator.textContent = mode.toUpperCase();
      indicator.className = 'visible ' + mode;
      setTimeout(() => indicator.classList.remove('visible'), 2000);
    }
  }

  function getMode() {
    return currentMode;
  }

  return { init, setMode, getMode };
})();
