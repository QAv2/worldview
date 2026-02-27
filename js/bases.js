// bases.js — Underground base locations with markers and correlation analysis

const Bases = (() => {
  let entities = [];
  let visible = true;
  let baseData = [];
  let correlationRadius = 150; // km
  let correlationEntities = [];

  async function init(viewer) {
    try {
      const resp = await fetch('data/bases.json');
      baseData = await resp.json();
      renderBases(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      console.warn('[Bases] Failed to load:', err.message);
    }
  }

  function renderBases(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    const tierColors = {
      documented: '#34d399',
      credible: '#fbbf24',
      inference: '#fb923c',
      speculative: '#f87171',
    };

    baseData.forEach(base => {
      const color = tierColors[base.evidence_tier] || '#c084fc';

      // Triangle/chevron marker via SVG billboard
      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat),
        billboard: {
          image: createBaseIcon(color),
          width: 20,
          height: 20,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: base.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.TOP,
          pixelOffset: new Cesium.Cartesian2(0, 14),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 5e6, 0.4),
        },
        properties: {
          type: 'base',
          id: base.id,
          name: base.name,
          lat: base.lat,
          lon: base.lon,
          depth_estimate: base.depth_estimate,
          source: base.source,
          evidence_tier: base.evidence_tier,
          facility_type: base.type,
          notes: base.notes,
          connections: base.connections,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function createBaseIcon(color) {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');

    // Downward-pointing chevron / triangle
    ctx.beginPath();
    ctx.moveTo(12, 22);   // bottom point
    ctx.lineTo(2, 6);     // top left
    ctx.lineTo(22, 6);    // top right
    ctx.closePath();

    ctx.fillStyle = color + '44'; // semi-transparent fill
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner triangle
    ctx.beginPath();
    ctx.moveTo(12, 17);
    ctx.lineTo(6, 8);
    ctx.lineTo(18, 8);
    ctx.closePath();
    ctx.fillStyle = color + '88';
    ctx.fill();

    return canvas.toDataURL();
  }

  // Show earthquake-DUMB correlation when a base is selected
  function showCorrelation(viewer, baseId) {
    clearCorrelation(viewer);

    const base = baseData.find(b => b.id === baseId);
    if (!base) return [];

    const nearby = Earthquakes.getNearby(base.lat, base.lon, correlationRadius);

    // Draw correlation radius circle
    const circle = viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat),
      ellipse: {
        semiMajorAxis: correlationRadius * 1000,
        semiMinorAxis: correlationRadius * 1000,
        material: Cesium.Color.fromCssColorString('#f87171').withAlpha(0.08),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#f87171').withAlpha(0.3),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      },
    });
    correlationEntities.push(circle);

    // Highlight nearby earthquakes with connecting lines
    nearby.forEach(quake => {
      const qlon = quake.geometry.coordinates[0];
      const qlat = quake.geometry.coordinates[1];

      const line = viewer.entities.add({
        polyline: {
          positions: [
            Cesium.Cartesian3.fromDegrees(base.lon, base.lat, 0),
            Cesium.Cartesian3.fromDegrees(qlon, qlat, 0),
          ],
          width: 1,
          material: Cesium.Color.fromCssColorString('#f87171').withAlpha(0.3),
          clampToGround: true,
        },
      });
      correlationEntities.push(line);
    });

    return nearby;
  }

  function clearCorrelation(viewer) {
    correlationEntities.forEach(e => viewer.entities.remove(e));
    correlationEntities = [];
  }

  function setCorrelationRadius(km) {
    correlationRadius = km;
  }

  function getBaseById(id) {
    return baseData.find(b => b.id === id);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return baseData.length; }
  function getData() { return baseData; }

  function updateStats() {
    const el = document.getElementById('stat-bases');
    if (el) el.textContent = `${baseData.length} bases`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return {
    init, setVisible, isVisible, getCount, getData, getBaseById,
    showCorrelation, clearCorrelation, setCorrelationRadius, setLabelsVisible,
  };
})();
