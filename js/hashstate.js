// hashstate.js — Shareable URL state via hash fragment
// Format: #lat,lon,alt,heading,pitch,roll/layers/base[/mode]

const HashState = (() => {
  let debounceTimer = null;
  let initialized = false;

  function serialize() {
    const cam = Globe.getCameraState();
    if (!cam) return '';

    const camStr = [
      cam.lat.toFixed(4),
      cam.lon.toFixed(4),
      Math.round(cam.alt),
      cam.heading.toFixed(1),
      cam.pitch.toFixed(1),
      cam.roll.toFixed(1),
    ].join(',');

    const modules = [Earthquakes, Satellites, Aircraft, Bases, Military, Intel, Vessels, Traffic];
    const layers = modules.map(m => m.isVisible() ? '1' : '0').join('');

    const base = Globe.getBaseLayerId();
    const mode = Shaders.getMode();

    let hash = `${camStr}/${layers}/${base}`;
    if (mode !== 'normal') hash += `/${mode}`;
    return hash;
  }

  function parse() {
    const hash = window.location.hash.slice(1);
    if (!hash) return null;

    const parts = hash.split('/');
    if (parts.length < 2) return null;

    const camParts = parts[0].split(',').map(Number);
    if (camParts.length < 3 || camParts.some(isNaN)) return null;

    const state = {
      camera: {
        lat: camParts[0],
        lon: camParts[1],
        alt: camParts[2],
        heading: camParts.length > 3 ? camParts[3] : 0,
        pitch: camParts.length > 4 ? camParts[4] : -90,
        roll: camParts.length > 5 ? camParts[5] : 0,
      },
    };

    if (parts[1] && /^[01]{8}$/.test(parts[1])) {
      state.layers = parts[1];
    }

    if (parts[2]) state.base = parts[2];
    if (parts[3]) state.mode = parts[3];

    return state;
  }

  function applyCamera(state) {
    if (!state || !state.camera) return;
    const viewer = Globe.getViewer();
    if (!viewer) return;

    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(
        state.camera.lon, state.camera.lat, state.camera.alt
      ),
      orientation: {
        heading: Cesium.Math.toRadians(state.camera.heading),
        pitch: Cesium.Math.toRadians(state.camera.pitch),
        roll: Cesium.Math.toRadians(state.camera.roll),
      },
    });
  }

  function applySettings(state) {
    if (!state) return;

    if (state.base) {
      Globe.setBaseLayer(state.base);
      document.querySelectorAll('#base-layer-buttons .mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.layerId === state.base);
      });
    }

    if (state.mode) {
      Shaders.setMode(state.mode);
      const modes = ['normal', 'crt', 'nvg', 'flir'];
      document.querySelectorAll('#mode-buttons .mode-btn').forEach((btn, i) => {
        btn.classList.toggle('active', modes[i] === state.mode);
      });
    }
  }

  function applyLayers(state) {
    if (!state || !state.layers) return;
    const modules = [Earthquakes, Satellites, Aircraft, Bases, Military, Intel, Vessels, Traffic];
    const layerIds = ['earthquakes', 'satellites', 'aircraft', 'bases', 'military', 'intel', 'vessels', 'traffic'];

    for (let i = 0; i < 8; i++) {
      const shouldBeVisible = state.layers[i] === '1';
      const isVisible = modules[i].isVisible();
      if (shouldBeVisible !== isVisible) {
        modules[i].setVisible(shouldBeVisible);
        const el = document.getElementById(`toggle-${layerIds[i]}`);
        if (el) el.classList.toggle('off', !shouldBeVisible);
      }
    }
  }

  function update() {
    if (!initialized) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const hash = serialize();
      if (hash) history.replaceState(null, '', '#' + hash);
    }, 500);
  }

  function copyUrl() {
    const hash = serialize();
    if (hash) history.replaceState(null, '', '#' + hash);
    navigator.clipboard.writeText(window.location.href).then(() => {
      const indicator = document.getElementById('mode-indicator');
      indicator.textContent = 'URL COPIED';
      indicator.className = 'visible';
      setTimeout(() => indicator.classList.remove('visible'), 2000);
    });
  }

  function init() {
    const viewer = Globe.getViewer();
    if (!viewer) return;
    viewer.camera.moveEnd.addEventListener(update);
    document.getElementById('share-btn').addEventListener('click', copyUrl);
    initialized = true;
    update();
  }

  return { parse, applyCamera, applySettings, applyLayers, update, copyUrl, init };
})();
