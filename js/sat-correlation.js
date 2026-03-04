// sat-correlation.js — Satellite-to-event correlation lines
// Reads manifest.correlation_passes[], draws polylines from satellite position
// to event ground point during pass windows. Toggle with K key.

const SatCorrelation = (() => {
  let viewer = null;
  let visible = false;
  let lines = null;         // PolylineCollection
  let labels = null;        // LabelCollection
  let correlations = [];    // from manifest
  let currentEpoch = null;
  let labelsVisible = true;

  const LINE_COLOR = Cesium.Color.fromCssColorString('rgba(168, 85, 247, 0.7)');  // Purple
  const LINE_WIDTH = 2;
  const SAT_ALT = 800000;  // Default orbit altitude (800km) if not computed

  function init(v) {
    viewer = v;
    lines = new Cesium.PolylineCollection();
    labels = new Cesium.LabelCollection({ scene: viewer.scene });
    viewer.scene.primitives.add(lines);
    viewer.scene.primitives.add(labels);
    lines.show = false;
    labels.show = false;
  }

  // ── Data Loading ───────────────────────────────────────────────────────

  function loadCorrelations(manifest) {
    correlations = manifest.correlation_passes || [];
    console.log(`[SatCorrelation] Loaded ${correlations.length} correlation passes`);
  }

  // ── Time Control ───────────────────────────────────────────────────────

  function setTime(epochMs) {
    currentEpoch = epochMs;
    if (!visible || correlations.length === 0) return;

    lines.removeAll();
    labels.removeAll();

    for (const pass of correlations) {
      if (epochMs < pass.pass_start_ms || epochMs > pass.pass_end_ms) continue;

      // Calculate satellite position at current time
      // Use existing Satellites module if available for TLE propagation
      let satLat, satLon, satAlt;

      if (typeof Satellites !== 'undefined' && Satellites.propagateNorad) {
        const pos = Satellites.propagateNorad(pass.norad_id, epochMs);
        if (pos) {
          satLat = pos.lat;
          satLon = pos.lon;
          satAlt = pos.alt;
        }
      }

      // Fallback: use peak position from manifest
      if (satLat === undefined) {
        satLat = pass.peak_lat || 0;
        satLon = pass.peak_lon || 0;
        satAlt = SAT_ALT;
      }

      // Ground target (from manifest or use peak position)
      const groundLat = pass.target_lat || pass.peak_lat || 0;
      const groundLon = pass.target_lon || pass.peak_lon || 0;

      const satPos = Cesium.Cartesian3.fromDegrees(satLon, satLat, satAlt);
      const groundPos = Cesium.Cartesian3.fromDegrees(groundLon, groundLat, 0);

      lines.add({
        positions: [satPos, groundPos],
        width: LINE_WIDTH,
        material: Cesium.Material.fromType('Color', { color: LINE_COLOR }),
      });

      if (labelsVisible) {
        labels.add({
          position: satPos,
          text: pass.name || `NORAD ${pass.norad_id}`,
          font: '10px monospace',
          fillColor: LINE_COLOR,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(8, -8),
          scale: 0.9,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    }

    viewer.scene.requestRender();
  }

  // ── Visibility ─────────────────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    lines.show = v;
    labels.show = v && labelsVisible;
    if (v && currentEpoch) setTime(currentEpoch);
    if (viewer) viewer.scene.requestRender();
  }

  function isVisible() { return visible; }

  function setLabelsVisible(v) {
    labelsVisible = v;
    labels.show = visible && v;
    if (viewer) viewer.scene.requestRender();
  }

  function getCount() {
    if (!visible) return 0;
    return lines.length;
  }

  return {
    init, loadCorrelations, setTime, setVisible, isVisible,
    setLabelsVisible, getCount,
  };
})();
