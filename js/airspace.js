// airspace.js — Airspace closure / TFR layer (F12)
// Renders TFR GeoJSON as Cesium Entity polygons, time-filtered.

const Airspace = (() => {
  let viewer = null;
  let visible = false;
  let dataSource = null;
  let tfrs = [];         // Parsed TFR features
  let entities = [];     // Cesium entities
  let currentEpoch = null;

  const FILL_COLOR = Cesium.Color.fromCssColorString('rgba(239, 68, 68, 0.15)');
  const OUTLINE_COLOR = Cesium.Color.fromCssColorString('#ef4444');
  const EXPIRED_FILL = Cesium.Color.fromCssColorString('rgba(100, 100, 100, 0.08)');
  const EXPIRED_OUTLINE = Cesium.Color.fromCssColorString('rgba(100, 100, 100, 0.3)');

  function init(v) {
    viewer = v;
    dataSource = new Cesium.CustomDataSource('airspace');
    viewer.dataSources.add(dataSource);
    dataSource.show = false;
  }

  // ── Data Loading ───────────────────────────────────────────────────────

  async function loadTFR(url) {
    try {
      let fetchUrl = url;
      // Use proxy for external URLs
      if (url.startsWith('http')) {
        fetchUrl = `/.netlify/functions/proxy?url=${encodeURIComponent(url)}`;
      }
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const geojson = await resp.json();

      tfrs = (geojson.features || []).map(f => parseTFR(f)).filter(Boolean);
      console.log(`[Airspace] Loaded ${tfrs.length} TFRs`);
      renderAll();
    } catch (err) {
      console.warn('[Airspace] Failed to load TFR:', err.message);
    }
  }

  async function loadReplayTFR(slug) {
    const url = `data/replays/${slug}/airspace/tfr.json`;
    try {
      const resp = await fetch(url);
      if (!resp.ok) return;
      const geojson = await resp.json();
      tfrs = (geojson.features || []).map(f => parseTFR(f)).filter(Boolean);
      console.log(`[Airspace] Loaded ${tfrs.length} replay TFRs`);
      renderAll();
    } catch (err) {
      console.warn('[Airspace] Failed to load replay TFR:', err.message);
    }
  }

  function parseTFR(feature) {
    if (!feature.geometry) return null;
    const props = feature.properties || {};

    // Extract effective dates if available
    let effectiveStart = null, effectiveEnd = null;
    if (props.effectiveDate || props.effective_date || props.startDate) {
      const s = props.effectiveDate || props.effective_date || props.startDate;
      effectiveStart = new Date(s).getTime();
    }
    if (props.expireDate || props.expire_date || props.endDate) {
      const e = props.expireDate || props.expire_date || props.endDate;
      effectiveEnd = new Date(e).getTime();
    }

    return {
      geometry: feature.geometry,
      name: props.name || props.notamNumber || props.NOTAM || 'TFR',
      description: props.description || props.text || '',
      effectiveStart,
      effectiveEnd,
      properties: props,
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  function renderAll() {
    dataSource.entities.removeAll();
    entities = [];

    for (const tfr of tfrs) {
      const entity = renderTFR(tfr);
      if (entity) entities.push({ entity, tfr });
    }

    if (visible && viewer) viewer.scene.requestRender();
  }

  function renderTFR(tfr) {
    const geom = tfr.geometry;
    if (!geom) return null;

    if (geom.type === 'Polygon') {
      return addPolygon(tfr, geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      // Render first polygon for simplicity
      if (geom.coordinates.length > 0) {
        return addPolygon(tfr, geom.coordinates[0]);
      }
    } else if (geom.type === 'Point') {
      return addCircle(tfr, geom.coordinates);
    }
    return null;
  }

  function addPolygon(tfr, coords) {
    if (!coords || !coords[0]) return null;
    const ring = coords[0];
    const positions = ring.map(c => Cesium.Cartesian3.fromDegrees(c[0], c[1]));

    return dataSource.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(positions),
        material: FILL_COLOR,
        outline: true,
        outlineColor: OUTLINE_COLOR,
        outlineWidth: 2,
        height: 0,
        classificationType: Cesium.ClassificationType.BOTH,
      },
      properties: {
        type: 'airspace',
        name: tfr.name,
        description: tfr.description,
      },
    });
  }

  function addCircle(tfr, coords) {
    // Point TFR — render as circle with default 10nm radius
    const radius = tfr.properties.radius || 18520; // 10nm in meters
    return dataSource.entities.add({
      position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1]),
      ellipse: {
        semiMajorAxis: radius,
        semiMinorAxis: radius,
        material: FILL_COLOR,
        outline: true,
        outlineColor: OUTLINE_COLOR,
        outlineWidth: 2,
        height: 0,
      },
      properties: {
        type: 'airspace',
        name: tfr.name,
        description: tfr.description,
      },
    });
  }

  // ── Time Filtering ─────────────────────────────────────────────────────

  function setTime(epochMs) {
    currentEpoch = epochMs;
    if (!visible) return;

    for (const { entity, tfr } of entities) {
      const active = isTFRActive(tfr, epochMs);
      entity.show = active;
      // Dim expired TFRs instead of hiding completely (optional)
      if (entity.polygon) {
        entity.polygon.material = active ? FILL_COLOR : EXPIRED_FILL;
        entity.polygon.outlineColor = active ? OUTLINE_COLOR : EXPIRED_OUTLINE;
      }
    }
    if (viewer) viewer.scene.requestRender();
  }

  function isTFRActive(tfr, epochMs) {
    // If no dates, always show
    if (!tfr.effectiveStart && !tfr.effectiveEnd) return true;
    if (tfr.effectiveStart && epochMs < tfr.effectiveStart) return false;
    if (tfr.effectiveEnd && epochMs > tfr.effectiveEnd) return false;
    return true;
  }

  // ── Live Mode ──────────────────────────────────────────────────────────

  async function loadLiveTFRs() {
    // Fetch from airframesio GitHub
    await loadTFR('https://raw.githubusercontent.com/airframesio/data/master/json/noaa/tfrs.geojson');
  }

  // ── Visibility ─────────────────────────────────────────────────────────

  function setVisible(v) {
    visible = v;
    dataSource.show = v;
    if (viewer) viewer.scene.requestRender();
  }

  function isVisible() { return visible; }
  function setLabelsVisible() {} // N/A
  function getCount() { return tfrs.length; }

  return {
    init, loadTFR, loadReplayTFR, loadLiveTFRs, setTime,
    setVisible, isVisible, setLabelsVisible, getCount,
  };
})();
