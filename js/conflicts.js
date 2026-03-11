// conflicts.js — F9 conflict events layer (Middle East theater 2025-2026)

const Conflicts = (() => {
  let entities = [];
  let visible = true;
  let eventData = [];
  const iconCache = {};

  const TYPE_COLORS = {
    airstrike: '#ef4444',
    missile: '#dc2626',
    naval: '#3b82f6',
    retaliation: '#f97316',
    blockade: '#f59e0b',
    cyber: '#06b6d4',
    nuclear: '#a855f7',
    ground: '#22c55e',
    political: '#8b5cf6',
    economic: '#14b8a6',
  };

  async function init(viewer) {
    try {
      const resp = await fetch('data/conflict-events.json');
      eventData = await resp.json();
      renderEvents(viewer);
      updateStats();
      Globe.requestRender();
    } catch (err) {
      console.warn('[Conflicts] Failed to load:', err.message);
    }
  }

  function renderEvents(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    eventData.forEach(evt => {
      const color = TYPE_COLORS[evt.type] || '#ef4444';

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(evt.lon, evt.lat),
        billboard: {
          image: createEventIcon(evt.type, color),
          width: 22,
          height: 22,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: evt.name,
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
          type: 'conflict',
          id: evt.id,
          name: evt.name,
          lat: evt.lat,
          lon: evt.lon,
          eventType: evt.type,
          date: evt.date,
          operation: evt.operation,
          parties: (evt.parties || []).join(', '),
          target: evt.target,
          casualties: evt.casualties,
          description: evt.description,
          eventSources: (evt.sources || []).join('; '),
          eventColor: color,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function createEventIcon(type, color) {
    const key = type + color;
    if (iconCache[key]) return iconCache[key];

    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 24;
    const ctx = canvas.getContext('2d');
    const cx = 12, cy = 12;

    switch (type) {
      case 'airstrike':
      case 'nuclear':
        // Explosion burst (8-pointed star)
        drawBurst(ctx, cx, cy, 10, 5, 8, color);
        break;
      case 'missile':
        // Explosion burst (6-pointed)
        drawBurst(ctx, cx, cy, 10, 5, 6, color);
        break;
      case 'retaliation':
        // Crosshair / target
        drawCrosshair(ctx, cx, cy, 9, color);
        break;
      case 'naval':
        // Anchor shape
        drawAnchor(ctx, cx, cy, 9, color);
        break;
      case 'blockade':
        // X / block symbol
        drawBlockade(ctx, cx, cy, 9, color);
        break;
      case 'cyber':
        // Lightning bolt
        drawLightning(ctx, cx, cy, 10, color);
        break;
      case 'ground':
        // Tank / chevron arrow
        drawChevron(ctx, cx, cy, 9, color);
        break;
      case 'political':
        // Gavel / circle with star
        drawPolitical(ctx, cx, cy, 9, color);
        break;
      case 'economic':
        // Dollar / chart symbol
        drawEconomic(ctx, cx, cy, 9, color);
        break;
      default:
        drawBurst(ctx, cx, cy, 10, 5, 8, color);
    }

    const dataUrl = canvas.toDataURL();
    iconCache[key] = dataUrl;
    return dataUrl;
  }

  function drawBurst(ctx, cx, cy, outerR, innerR, points, color) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = (i * Math.PI) / points - Math.PI / 2;
      const r = i % 2 === 0 ? outerR : innerR;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color + '66';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawCrosshair(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // Inner ring
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = color + '44';
    ctx.fill();
    ctx.stroke();
    // Cross lines
    ctx.beginPath();
    ctx.moveTo(cx, cy - r - 2); ctx.lineTo(cx, cy - r * 0.5);
    ctx.moveTo(cx, cy + r * 0.5); ctx.lineTo(cx, cy + r + 2);
    ctx.moveTo(cx - r - 2, cy); ctx.lineTo(cx - r * 0.5, cy);
    ctx.moveTo(cx + r * 0.5, cy); ctx.lineTo(cx + r + 2, cy);
    ctx.stroke();
    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function drawAnchor(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    // Ring at top
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.4, r * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    // Vertical shaft
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.15);
    ctx.lineTo(cx, cy + r * 0.7);
    ctx.stroke();
    // Horizontal bar
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.5, cy - r * 0.15);
    ctx.lineTo(cx + r * 0.5, cy - r * 0.15);
    ctx.stroke();
    // Curved flukes
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.7, r * 0.5, Math.PI, 0);
    ctx.stroke();
  }

  function drawBlockade(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillStyle = color + '33';
    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Diagonal line (prohibition)
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.7, cy + r * 0.7);
    ctx.lineTo(cx + r * 0.7, cy - r * 0.7);
    ctx.stroke();
  }

  function drawLightning(ctx, cx, cy, r, color) {
    ctx.fillStyle = color + '88';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 1, cy - r);
    ctx.lineTo(cx - 4, cy);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx - 1, cy + r);
    ctx.lineTo(cx + 4, cy);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawChevron(ctx, cx, cy, r, color) {
    ctx.fillStyle = color + '55';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    // Upward-pointing chevron (ground advance)
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.5, cy + r * 0.3);
    ctx.lineTo(cx + r * 0.5, cy + r);
    ctx.lineTo(cx - r * 0.5, cy + r);
    ctx.lineTo(cx - r * 0.5, cy + r * 0.3);
    ctx.lineTo(cx - r, cy + r * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function drawPolitical(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    // Circle with inner star
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // 5-pointed star
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5 - Math.PI / 2;
      const sr = i % 2 === 0 ? r * 0.55 : r * 0.22;
      const x = cx + sr * Math.cos(angle);
      const y = cy + sr * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawEconomic(ctx, cx, cy, r, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.fillStyle = color + '44';
    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Up-arrow inside (price spike)
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + r * 0.4);
    ctx.lineTo(cx, cy - r * 0.4);
    ctx.moveTo(cx - r * 0.25, cy - r * 0.15);
    ctx.lineTo(cx, cy - r * 0.4);
    ctx.lineTo(cx + r * 0.25, cy - r * 0.15);
    ctx.stroke();
  }

  function getEventById(id) {
    return eventData.find(e => e.id === id);
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return eventData.length; }

  function updateStats() {
    const el = document.getElementById('stat-conflicts');
    if (el) el.textContent = `${eventData.length} events`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  function setTime(epoch) {
    if (!epoch) {
      // LIVE — show all events
      entities.forEach(e => { e.show = visible; });
    } else {
      entities.forEach((e, i) => {
        const evt = eventData[i];
        if (!evt || !evt.date) {
          e.show = visible;
          return;
        }
        const evtTime = new Date(evt.date).getTime();
        e.show = visible && evtTime <= epoch;
      });
    }
    Globe.requestRender();
  }

  return { init, setVisible, isVisible, getCount, getEventById, setLabelsVisible, setTime };
})();
