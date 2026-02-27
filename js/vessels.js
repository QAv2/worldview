// vessels.js — Naval vessel tracking via aisstream.io WebSocket
// Streams live AIS data, filters for military vessels by MMSI pattern and ship type.

const Vessels = (() => {
  let pointCollection = null;
  let labelCollection = null;
  const pointMap = new Map();   // MMSI -> PointPrimitive
  const labelMap = new Map();   // MMSI -> Label
  const vesselData = new Map(); // MMSI -> vessel object

  let visible = true;
  let labelsVisible = true;
  let ws = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let pruneTimer = null;
  let renderTimer = null;
  let pendingUpdates = new Map();

  // aisstream.io API key — sign up at https://aisstream.io to get one
  const API_KEY = '';
  const WS_URL = 'wss://stream.aisstream.io/v0/stream';
  const STALE_MS = 10 * 60 * 1000; // 10 min
  const PRUNE_INTERVAL = 60000;
  const RENDER_INTERVAL = 2000;    // batch render every 2s
  const MAX_RECONNECT_DELAY = 30000;

  // Cached Cesium objects
  const VESSEL_COLOR = Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.85);
  const VESSEL_OUTLINE = Cesium.Color.fromCssColorString('#3b82f6');
  const VESSEL_LABEL_COLOR = Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.7);
  const LABEL_OFFSET = new Cesium.Cartesian2(0, -8);
  const LABEL_SCALE = new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3);
  const POINT_SCALE = new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.4);

  // Military MMSI prefixes
  const MIL_MMSI_PREFIXES = [
    '3669',       // US Navy
    '232', '233', // UK
    '273',        // Russia
    '412', '413', // China
  ];

  // AIS navigation status codes
  const NAV_STATUS = {
    0: 'Under way using engine', 1: 'At anchor', 2: 'Not under command',
    3: 'Restricted maneuverability', 4: 'Constrained by draught', 5: 'Moored',
    6: 'Aground', 7: 'Engaged in fishing', 8: 'Under way sailing',
    9: 'Reserved (HSC)', 10: 'Reserved (WIG)', 11: 'Towing astern',
    12: 'Pushing/towing', 14: 'AIS-SART', 15: 'Not defined',
  };

  // Country flag from MID (first 3 digits of MMSI)
  const MID_FLAGS = {
    '211': 'DE', '226': 'FR', '227': 'FR', '228': 'FR',
    '230': 'FI', '232': 'GB', '233': 'GB', '234': 'GB', '235': 'GB',
    '244': 'NL', '245': 'NL', '246': 'NL',
    '247': 'IT', '248': 'MT', '257': 'NO', '258': 'NO', '259': 'NO',
    '261': 'PL', '265': 'SE', '266': 'SE',
    '273': 'RU', '274': 'RU',
    '303': 'US', '338': 'US', '366': 'US', '367': 'US', '368': 'US', '369': 'US',
    '316': 'CA', '401': 'AF', '412': 'CN', '413': 'CN', '414': 'CN',
    '431': 'JP', '432': 'JP', '440': 'KR', '441': 'KR',
    '503': 'AU', '512': 'NZ',
  };

  function init(viewer) {
    pointCollection = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT })
    );
    labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection());

    if (!API_KEY) {
      console.warn('[Vessels] No API key — vessel tracking disabled. Get one at https://aisstream.io');
      return;
    }

    connectWebSocket();
    pruneTimer = setInterval(pruneStale, PRUNE_INTERVAL);
    renderTimer = setInterval(flushPendingUpdates, RENDER_INTERVAL);
  }

  function connectWebSocket() {
    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

    try {
      ws = new WebSocket(WS_URL);
    } catch (err) {
      console.warn('[Vessels] WebSocket creation failed:', err.message);
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      console.log('[Vessels] WebSocket connected');
      reconnectDelay = 1000;
      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    };

    ws.onmessage = (event) => {
      try {
        processMessage(JSON.parse(event.data));
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = (event) => {
      console.warn(`[Vessels] WebSocket closed (code ${event.code})`);
      scheduleReconnect();
    };

    ws.onerror = () => { /* onclose fires after this */ };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`[Vessels] Reconnecting in ${reconnectDelay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connectWebSocket();
    }, reconnectDelay);
  }

  function isMilitary(mmsi, shipType) {
    if (shipType === 35) return true;
    const s = String(mmsi);
    return MIL_MMSI_PREFIXES.some(p => s.startsWith(p));
  }

  function getFlag(mmsi) {
    return MID_FLAGS[String(mmsi).slice(0, 3)] || '??';
  }

  function processMessage(msg) {
    if (!msg.MetaData || !msg.Message?.PositionReport) return;

    const meta = msg.MetaData;
    const pos = msg.Message.PositionReport;
    const mmsi = meta.MMSI;

    if (!mmsi || !meta.latitude || !meta.longitude) return;
    if (meta.latitude === 91 || meta.longitude === 181) return; // AIS "not available"

    if (!isMilitary(mmsi, meta.ShipType || pos.ShipType)) return;

    pendingUpdates.set(mmsi, {
      mmsi,
      name: (meta.ShipName || '').trim(),
      callsign: (meta.CallSign || '').trim() || null,
      shipType: meta.ShipType || pos.ShipType || null,
      flag: getFlag(mmsi),
      lat: meta.latitude,
      lon: meta.longitude,
      speed: pos.Sog != null ? pos.Sog : null,
      course: pos.Cog != null ? pos.Cog : null,
      heading: pos.TrueHeading != null && pos.TrueHeading !== 511 ? pos.TrueHeading : null,
      status: pos.NavigationalStatus != null ? pos.NavigationalStatus : null,
      lastUpdate: Date.now(),
    });
  }

  function flushPendingUpdates() {
    if (pendingUpdates.size === 0) return;

    for (const [mmsi, data] of pendingUpdates) {
      vesselData.set(mmsi, data);
    }
    pendingUpdates.clear();

    reconcileRender();
    updateStats();
    Globe.requestRender();
  }

  function reconcileRender() {
    // Update existing / remove departed
    for (const [mmsi, point] of pointMap) {
      const vessel = vesselData.get(mmsi);
      if (vessel) {
        const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 0);
        point.position = pos;
        point.id = makePickData(vessel);
        const label = labelMap.get(mmsi);
        if (label) {
          label.position = pos;
          label.text = vessel.name || String(vessel.mmsi);
          label.id = point.id;
        }
      } else {
        pointCollection.remove(point);
        pointMap.delete(mmsi);
        const label = labelMap.get(mmsi);
        if (label) {
          labelCollection.remove(label);
          labelMap.delete(mmsi);
        }
      }
    }

    // Add new
    for (const [mmsi, vessel] of vesselData) {
      if (pointMap.has(mmsi)) continue;

      const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 0);
      const pickData = makePickData(vessel);

      const point = pointCollection.add({
        position: pos,
        pixelSize: 6,
        color: VESSEL_COLOR,
        outlineColor: VESSEL_OUTLINE,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: POINT_SCALE,
        id: pickData,
        show: visible,
      });
      pointMap.set(mmsi, point);

      const label = labelCollection.add({
        position: pos,
        text: vessel.name || String(vessel.mmsi),
        font: '10px monospace',
        fillColor: VESSEL_LABEL_COLOR,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: LABEL_OFFSET,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: LABEL_SCALE,
        id: pickData,
        show: visible && labelsVisible,
      });
      labelMap.set(mmsi, label);
    }
  }

  function makePickData(v) {
    return {
      type: 'vessel',
      mmsi: v.mmsi,
      name: v.name,
      callsign: v.callsign,
      shipType: v.shipType,
      flag: v.flag,
      lat: v.lat,
      lon: v.lon,
      speed: v.speed,
      course: v.course,
      heading: v.heading,
      status: v.status,
      lastUpdate: v.lastUpdate,
    };
  }

  function pruneStale() {
    const now = Date.now();
    let pruned = 0;
    for (const [mmsi, vessel] of vesselData) {
      if (now - vessel.lastUpdate > STALE_MS) {
        vesselData.delete(mmsi);
        pruned++;
      }
    }
    if (pruned > 0) {
      reconcileRender();
      updateStats();
      Globe.requestRender();
      console.log(`[Vessels] Pruned ${pruned} stale vessels`);
    }
  }

  function setVisible(v) {
    visible = v;
    if (pointCollection) pointCollection.show = v;
    if (labelCollection) labelCollection.show = v && labelsVisible;
    Globe.requestRender();
  }

  function isVisible() { return visible; }

  function setLabelsVisible(show) {
    labelsVisible = show;
    if (labelCollection) labelCollection.show = visible && show;
  }

  function getCount() { return pointMap.size; }

  function getVesselByMMSI(mmsi) {
    return vesselData.get(mmsi) || null;
  }

  function getNavStatusText(code) {
    return NAV_STATUS[code] || 'Unknown';
  }

  function updateStats() {
    const el = document.getElementById('stat-vessels');
    if (el) el.textContent = `${pointMap.size} vessels`;
  }

  return {
    init, setVisible, isVisible, getCount, setLabelsVisible,
    getVesselByMMSI, getNavStatusText,
  };
})();
