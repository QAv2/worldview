// traffic.js — Ambient flow lines along major highways (F8)

const Traffic = (() => {
  let viewer = null;
  let polylines = null;
  let particles = null;
  let segments = [];
  let particleData = []; // { point, segIdx, progress, direction }
  let animInterval = null;
  let visible = true;
  let count = 0;

  const COLOR = Cesium.Color.fromCssColorString('#10b981');
  const LINE_ALPHA = 0.15;
  const PARTICLE_ALPHA = 0.85;
  const PARTICLE_SIZE = 3;
  const SPEED = 0.012; // progress increment per tick (0→1 loop)

  async function init(v) {
    viewer = v;
    try {
      const resp = await fetch('data/roads.json');
      segments = await resp.json();
      count = segments.length;
      console.log(`[Traffic] Loaded ${count} road segments`);
      buildCollections();
      startAnimation();
      updateStats();
    } catch (err) {
      console.warn('[Traffic] Failed to load roads:', err.message);
    }
  }

  function buildCollections() {
    // Polyline collection for road lines
    polylines = viewer.scene.primitives.add(new Cesium.PolylineCollection());
    // Point collection for flowing particles
    particles = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());

    const lineColor = COLOR.withAlpha(LINE_ALPHA);

    segments.forEach((seg, idx) => {
      if (seg.length < 2) return;

      // Build Cartesian positions for this segment
      const positions = [];
      for (let i = 0; i < seg.length; i++) {
        positions.push(Cesium.Cartesian3.fromDegrees(seg[i][0], seg[i][1], 100));
      }

      // Add polyline
      polylines.add({
        positions: positions,
        width: 1,
        material: Cesium.Material.fromType('Color', { color: lineColor }),
        show: visible,
      });

      // Add 2 particles per segment (forward + reverse)
      const p1 = particles.add({
        position: positions[0],
        pixelSize: PARTICLE_SIZE,
        color: COLOR.withAlpha(PARTICLE_ALPHA),
        disableDepthTestDistance: 0,
        show: visible,
      });
      particleData.push({ point: p1, segIdx: idx, progress: 0, direction: 1 });

      const p2 = particles.add({
        position: positions[positions.length - 1],
        pixelSize: PARTICLE_SIZE,
        color: COLOR.withAlpha(PARTICLE_ALPHA),
        disableDepthTestDistance: 0,
        show: visible,
      });
      particleData.push({ point: p2, segIdx: idx, progress: 1, direction: -1 });
    });
  }

  function interpolatePosition(seg, t) {
    // t is 0→1 along the segment
    const totalPts = seg.length;
    if (totalPts < 2) return Cesium.Cartesian3.fromDegrees(seg[0][0], seg[0][1], 100);

    const fIdx = t * (totalPts - 1);
    const i = Math.floor(fIdx);
    const frac = fIdx - i;

    if (i >= totalPts - 1) {
      return Cesium.Cartesian3.fromDegrees(seg[totalPts - 1][0], seg[totalPts - 1][1], 100);
    }

    const lon = seg[i][0] + (seg[i + 1][0] - seg[i][0]) * frac;
    const lat = seg[i][1] + (seg[i + 1][1] - seg[i][1]) * frac;
    return Cesium.Cartesian3.fromDegrees(lon, lat, 100);
  }

  function startAnimation() {
    animInterval = setInterval(() => {
      if (!visible) return;
      for (const pd of particleData) {
        pd.progress += SPEED * pd.direction;
        // Wrap around
        if (pd.progress > 1) pd.progress -= 1;
        if (pd.progress < 0) pd.progress += 1;
        pd.point.position = interpolatePosition(segments[pd.segIdx], pd.progress);
      }
      Globe.requestRender();
    }, 100);
  }

  function setVisible(v) {
    visible = v;
    if (polylines) {
      for (let i = 0; i < polylines.length; i++) {
        polylines.get(i).show = v;
      }
    }
    if (particles) {
      for (let i = 0; i < particles.length; i++) {
        particles.get(i).show = v;
      }
    }
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return count; }

  function setLabelsVisible() {
    // No-op — roads have no labels
  }

  function updateStats() {
    const el = document.getElementById('stat-traffic');
    if (el) el.textContent = `${count} roads`;
  }

  return { init, setVisible, isVisible, getCount, setLabelsVisible };
})();
