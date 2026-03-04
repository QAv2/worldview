// jamming.js — GPS jamming heatmap layer (F11)
// In replay mode: loads pre-generated 360x180 PNG per frame as SingleTileImageryProvider.
// In live mode (Phase 9): generates canvas from viewport ADS-B NIC query.

const Jamming = (() => {
  let viewer = null;
  let visible = false;
  let currentLayer = null;  // Cesium ImageryLayer
  let currentFrameIdx = -1;
  let replaySlug = null;
  let liveMode = false;
  let liveTimer = null;
  let liveCanvas = null;

  const LIVE_POLL_INTERVAL = 60000; // 60s
  const LIVE_RADIUS_NM = 250;

  // NIC color ramp for live canvas
  const NIC_COLORS = {
    severe:  [255, 30, 0],     // red, NIC 0
    poor:    [255, 120, 0],    // orange, NIC 1-3
    degraded: [255, 200, 0],   // yellow, NIC 4-6
  };

  function init(v) {
    viewer = v;
  }

  // ── Replay Mode ────────────────────────────────────────────────────────

  function setReplaySlug(slug) {
    replaySlug = slug;
    currentFrameIdx = -1;
    removeCurrent();
  }

  async function setTime(epochMs) {
    if (!visible) return;

    // If a replay is active, use pre-generated PNGs
    if (typeof Playback !== 'undefined' && Playback.isReplayActive()) {
      const replay = Playback.getReplay();
      if (!replay) return;

      // Calculate frame index
      const elapsed = epochMs - replay.start_ms;
      const intervalMs = replay.frame_interval_min * 60 * 1000;
      const idx = Math.max(0, Math.min(
        replay.frame_count - 1,
        Math.floor(elapsed / intervalMs)
      ));

      if (idx === currentFrameIdx) return;
      currentFrameIdx = idx;

      const slug = replay.slug;
      const url = `data/replays/${slug}/jamming/${String(idx).padStart(6, '0')}.png`;
      loadTileFromUrl(url);
    }
    // Live mode handled by liveTimer (Phase 9)
  }

  function loadTileFromUrl(url) {
    removeCurrent();

    try {
      const provider = new Cesium.SingleTileImageryProvider({
        url: url,
        rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90),
      });

      currentLayer = viewer.imageryLayers.addImageryProvider(provider);
      currentLayer.alpha = 0.6;
      currentLayer.show = visible;
      viewer.scene.requestRender();
    } catch (err) {
      console.warn('[Jamming] Failed to load tile:', err.message);
    }
  }

  function removeCurrent() {
    if (currentLayer) {
      viewer.imageryLayers.remove(currentLayer);
      currentLayer = null;
    }
  }

  // ── Live Mode (Phase 9) ───────────────────────────────────────────────

  function startLive() {
    if (liveTimer) return;
    liveMode = true;
    liveCanvas = document.createElement('canvas');
    liveCanvas.width = 360;
    liveCanvas.height = 180;
    pollLive();
    liveTimer = setInterval(pollLive, LIVE_POLL_INTERVAL);
  }

  function stopLive() {
    liveMode = false;
    if (liveTimer) {
      clearInterval(liveTimer);
      liveTimer = null;
    }
    removeCurrent();
  }

  async function pollLive() {
    if (!visible || !liveMode) return;

    // Get camera center
    const center = typeof Globe !== 'undefined' && Globe.getCameraCenter
      ? Globe.getCameraCenter()
      : null;
    if (!center) return;

    // Check zoom level — disable at global zoom (radius > 250NM)
    const cam = Globe.getCameraState();
    if (!cam || cam.alt > 3000000) {
      // Too far out, clear heatmap
      removeCurrent();
      return;
    }

    try {
      const url = `/.netlify/functions/proxy?url=https://api.adsb.lol/v2/lat/${center.lat.toFixed(2)}/lon/${center.lon.toFixed(2)}/dist/${LIVE_RADIUS_NM}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const data = await resp.json();

      const aircraft = data.ac || [];
      buildLiveCanvas(aircraft);
    } catch (err) {
      console.warn('[Jamming] Live poll error:', err.message);
    }
  }

  function buildLiveCanvas(aircraft) {
    if (!liveCanvas) return;
    const ctx = liveCanvas.getContext('2d');
    ctx.clearRect(0, 0, 360, 180);
    const imgData = ctx.createImageData(360, 180);
    const pixels = imgData.data;

    // Accumulate NIC per grid cell
    const grid = new Map();
    for (const ac of aircraft) {
      const nic = ac.nic;
      if (nic === undefined || nic === null || nic >= 7) continue;
      const lat = ac.lat, lon = ac.lon;
      if (lat == null || lon == null) continue;
      const x = Math.floor((lon + 180) % 360);
      const y = Math.floor(90 - lat);
      const cx = Math.max(0, Math.min(359, x));
      const cy = Math.max(0, Math.min(179, y));
      const key = cy * 360 + cx;
      if (!grid.has(key)) grid.set(key, { count: 0, nicSum: 0 });
      const cell = grid.get(key);
      cell.count++;
      cell.nicSum += nic;
    }

    for (const [key, cell] of grid) {
      const avgNic = cell.nicSum / cell.count;
      const alpha = Math.min(200, 40 + cell.count * 20);
      let rgb;
      if (avgNic >= 4) rgb = NIC_COLORS.degraded;
      else if (avgNic >= 1) rgb = NIC_COLORS.poor;
      else rgb = NIC_COLORS.severe;

      const idx = key * 4;
      pixels[idx] = rgb[0];
      pixels[idx + 1] = rgb[1];
      pixels[idx + 2] = rgb[2];
      pixels[idx + 3] = alpha;
    }

    ctx.putImageData(imgData, 0, 0);

    // Convert to blob URL and load as tile
    liveCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      loadTileFromUrl(url);
      // Clean up old URL after a bit
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    }, 'image/png');
  }

  // ── Visibility ─────────────────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    if (currentLayer) currentLayer.show = v;

    // Start/stop live mode
    if (v && !Playback.isReplayActive()) {
      startLive();
    } else {
      stopLive();
    }

    if (viewer) viewer.scene.requestRender();
  }

  function isVisible() { return visible; }
  function setLabelsVisible() {} // No labels
  function getCount() { return 0; } // Heatmap, no discrete count

  return {
    init, setTime, setVisible, isVisible, setLabelsVisible, getCount,
    setReplaySlug, startLive, stopLive,
  };
})();
