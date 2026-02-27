// military.js — Global military base markers with branch-colored diamond icons

const Military = (() => {
  let entities = [];
  let visible = true;
  let baseData = [];
  const iconCache = {};

  const BRANCH_COLORS = {
    army: '#8b5cf6',
    navy: '#3b82f6',
    air_force: '#06b6d4',
    marines: '#ef4444',
    space_force: '#a855f7',
    joint: '#f59e0b',
    intelligence: '#ec4899',
    foreign_military: '#6b7280',
  };

  async function init(viewer) {
    try {
      const resp = await fetch('data/military-bases.json');
      baseData = await resp.json();
      renderBases(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      console.warn('[Military] Failed to load:', err.message);
    }
  }

  function renderBases(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    baseData.forEach(base => {
      const color = BRANCH_COLORS[base.branch] || '#6b7280';

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(base.lon, base.lat),
        billboard: {
          image: createBaseIcon(color),
          width: 20,
          height: 20,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
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
          disableDepthTestDistance: 0,
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 5e6, 0.4),
        },
        properties: {
          type: 'military',
          id: base.id,
          name: base.name,
          lat: base.lat,
          lon: base.lon,
          country: base.country,
          operator: base.operator,
          branch: base.branch,
          branchColor: color,
          baseType: base.type,
          status: base.status,
          notes: base.notes,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function createBaseIcon(color) {
    if (iconCache[color]) return iconCache[color];

    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');

    // Outer diamond (rotated square)
    ctx.beginPath();
    ctx.moveTo(12, 2);    // top
    ctx.lineTo(22, 12);   // right
    ctx.lineTo(12, 22);   // bottom
    ctx.lineTo(2, 12);    // left
    ctx.closePath();

    ctx.fillStyle = color + '44'; // semi-transparent fill
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Inner diamond
    ctx.beginPath();
    ctx.moveTo(12, 6);    // top
    ctx.lineTo(18, 12);   // right
    ctx.lineTo(12, 18);   // bottom
    ctx.lineTo(6, 12);    // left
    ctx.closePath();
    ctx.fillStyle = color + '88';
    ctx.fill();

    const dataUrl = canvas.toDataURL();
    iconCache[color] = dataUrl;
    return dataUrl;
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

  function updateStats() {
    const el = document.getElementById('stat-military');
    if (el) el.textContent = `${baseData.length} mil bases`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return { init, setVisible, isVisible, getCount, getBaseById, setLabelsVisible };
})();
