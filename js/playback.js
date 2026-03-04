// playback.js — Replay aircraft + vessel layer (F10)
// Loads pre-processed frame bundles, renders commercial flights as unlabeled points
// and military aircraft as labeled/pickable entities (same as live F3).

const Playback = (() => {
  let viewer = null;
  let visible = false;
  let labelsVisible = true;

  // Replay state
  let currentReplay = null;   // manifest object
  let replaySlug = null;
  let frameIndex = -1;
  let currentEpoch = null;

  // Primitives
  let comPoints = null;       // PointPrimitiveCollection — commercial aircraft (unlabeled, no pick)
  let milPoints = null;       // PointPrimitiveCollection — military aircraft (pickable)
  let milLabels = null;       // LabelCollection
  let vesselPoints = null;    // PointPrimitiveCollection — commercial vessels

  // Frame cache (LRU)
  const CACHE_SIZE = 30;
  const frameCache = new Map();  // frameIdx → frame data

  // NIC color ramp
  const NIC_COLORS = {
    good:    Cesium.Color.fromCssColorString('#34d399'),  // green, NIC >= 7
    degraded: Cesium.Color.fromCssColorString('#fbbf24'), // yellow, 4-6
    poor:    Cesium.Color.fromCssColorString('#fb923c'),  // orange, 1-3
    severe:  Cesium.Color.fromCssColorString('#ef4444'),  // red, 0
    unknown: Cesium.Color.fromCssColorString('#94a3b8'),  // gray, -1
  };

  const MIL_COLOR = Cesium.Color.fromCssColorString('#fb923c');
  const VESSEL_COLOR = Cesium.Color.fromCssColorString('#3b82f6');
  const VESSEL_CARGO_COLOR = Cesium.Color.fromCssColorString('#60a5fa');
  const VESSEL_TANKER_COLOR = Cesium.Color.fromCssColorString('#818cf8');

  function getNicColor(nic) {
    if (nic === -1 || nic === null || nic === undefined) return NIC_COLORS.unknown;
    if (nic >= 7) return NIC_COLORS.good;
    if (nic >= 4) return NIC_COLORS.degraded;
    if (nic >= 1) return NIC_COLORS.poor;
    return NIC_COLORS.severe;
  }

  function getVesselColor(shipType) {
    if (shipType >= 80 && shipType <= 89) return VESSEL_TANKER_COLOR;
    if (shipType >= 70 && shipType <= 79) return VESSEL_CARGO_COLOR;
    return VESSEL_COLOR;
  }

  // ── Init ───────────────────────────────────────────────────────────────

  function init(v) {
    viewer = v;

    comPoints = new Cesium.PointPrimitiveCollection();
    milPoints = new Cesium.PointPrimitiveCollection();
    milLabels = new Cesium.LabelCollection({ scene: viewer.scene });
    vesselPoints = new Cesium.PointPrimitiveCollection();

    viewer.scene.primitives.add(comPoints);
    viewer.scene.primitives.add(milPoints);
    viewer.scene.primitives.add(milLabels);
    viewer.scene.primitives.add(vesselPoints);

    comPoints.show = false;
    milPoints.show = false;
    milLabels.show = false;
    vesselPoints.show = false;
  }

  // ── Replay Loading ─────────────────────────────────────────────────────

  async function loadReplay(slug) {
    try {
      const manifestUrl = `data/replays/${slug}/manifest.json`;
      const resp = await fetch(manifestUrl);
      if (!resp.ok) throw new Error(`Manifest not found: ${resp.status}`);
      const manifest = await resp.json();

      currentReplay = manifest;
      replaySlug = slug;
      frameCache.clear();
      frameIndex = -1;

      console.log(`[Playback] Loaded replay: ${manifest.title} (${manifest.frame_count} frames)`);

      // Enter replay mode on timeline
      if (typeof Timeline !== 'undefined' && Timeline.enterReplayMode) {
        Timeline.enterReplayMode(manifest.start_ms, manifest.end_ms);
      }

      // Load first frame
      setTime(manifest.start_ms);

      setVisible(true);
      return manifest;
    } catch (err) {
      console.error('[Playback] Failed to load replay:', err);
      return null;
    }
  }

  function unloadReplay() {
    currentReplay = null;
    replaySlug = null;
    frameCache.clear();
    frameIndex = -1;
    clearPrimitives();

    if (typeof Timeline !== 'undefined' && Timeline.exitReplayMode) {
      Timeline.exitReplayMode();
    }
  }

  // ── Frame Fetching ─────────────────────────────────────────────────────

  async function fetchFrame(idx) {
    if (frameCache.has(idx)) return frameCache.get(idx);
    if (!replaySlug || !currentReplay) return null;
    if (idx < 0 || idx >= currentReplay.frame_count) return null;

    try {
      const url = `data/replays/${replaySlug}/frames/${String(idx).padStart(6, '0')}.json`;
      const resp = await fetch(url);
      if (!resp.ok) return null;
      const data = await resp.json();

      // LRU eviction
      if (frameCache.size >= CACHE_SIZE) {
        const oldest = frameCache.keys().next().value;
        frameCache.delete(oldest);
      }
      frameCache.set(idx, data);

      return data;
    } catch {
      return null;
    }
  }

  // Prefetch next few frames
  function prefetchAhead(idx) {
    for (let i = 1; i <= 3; i++) {
      const nextIdx = idx + i;
      if (nextIdx < currentReplay.frame_count && !frameCache.has(nextIdx)) {
        fetchFrame(nextIdx);  // fire and forget
      }
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function clearPrimitives() {
    comPoints.removeAll();
    milPoints.removeAll();
    milLabels.removeAll();
    vesselPoints.removeAll();
    if (viewer) viewer.scene.requestRender();
  }

  function renderFrame(frame) {
    if (!frame || !visible) return;

    // Clear and batch-add (O(N), no Map lookups)
    comPoints.removeAll();
    milPoints.removeAll();
    milLabels.removeAll();
    vesselPoints.removeAll();

    const ac = frame.ac || [];
    for (let i = 0; i < ac.length; i++) {
      const a = ac[i];
      const lon = a[0], lat = a[1], alt = a[2], isMil = a[3], nic = a[4];
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt * 0.3048); // ft → m

      if (isMil) {
        // Military: pickable, labeled, larger
        milPoints.add({
          position: pos,
          pixelSize: 5,
          color: MIL_COLOR,
          id: { type: 'aircraft', hex: `mil_${i}`, isMil: true },
        });
      } else {
        // Commercial: unlabeled, no pick data, 3px, NIC-colored
        comPoints.add({
          position: pos,
          pixelSize: 3,
          color: getNicColor(nic),
        });
      }
    }

    // Vessels
    const vessels = frame.vessels || [];
    for (let i = 0; i < vessels.length; i++) {
      const v = vessels[i];
      const lon = v[0], lat = v[1], shipType = v[2], speed = v[3];
      const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

      vesselPoints.add({
        position: pos,
        pixelSize: 4,
        color: getVesselColor(shipType),
      });
    }

    viewer.scene.requestRender();
  }

  // ── Time Control ───────────────────────────────────────────────────────

  async function setTime(epochMs) {
    if (!currentReplay || !visible) return;
    currentEpoch = epochMs;

    // Calculate frame index
    const elapsed = epochMs - currentReplay.start_ms;
    const intervalMs = currentReplay.frame_interval_min * 60 * 1000;
    const idx = Math.max(0, Math.min(
      currentReplay.frame_count - 1,
      Math.floor(elapsed / intervalMs)
    ));

    if (idx === frameIndex) return;  // Same frame, skip
    frameIndex = idx;

    const frame = await fetchFrame(idx);
    renderFrame(frame);
    prefetchAhead(idx);
  }

  // ── Visibility ─────────────────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    comPoints.show = v;
    milPoints.show = v;
    milLabels.show = v && labelsVisible;
    vesselPoints.show = v;
    if (viewer) viewer.scene.requestRender();
  }

  function isVisible() {
    return visible;
  }

  function setLabelsVisible(v) {
    labelsVisible = v;
    milLabels.show = visible && v;
    if (viewer) viewer.scene.requestRender();
  }

  function getCount() {
    if (!visible || !currentReplay) return 0;
    return comPoints.length + milPoints.length + vesselPoints.length;
  }

  function getReplay() {
    return currentReplay;
  }

  function isReplayActive() {
    return currentReplay !== null;
  }

  return {
    init, loadReplay, unloadReplay, setTime, setVisible, isVisible,
    setLabelsVisible, getCount, getReplay, isReplayActive,
  };
})();
