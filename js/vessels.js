// vessels.js — Naval vessel tracking via server-side proxy to aisstream.io
// Browser WebSocket connections are rejected by aisstream.io (Origin header check).
// The Netlify Function at /.netlify/functions/vessels connects server-side,
// collects ~4 seconds of AIS data, filters for military vessels, returns JSON.
// This client polls the function every 30 seconds.

const Vessels = (() => {
  let pointCollection = null;
  let labelCollection = null;
  const pointMap = new Map();   // MMSI -> PointPrimitive
  const labelMap = new Map();   // MMSI -> Label
  const vesselData = new Map(); // MMSI -> vessel object

  let visible = true;
  let labelsVisible = true;
  let pollTimer = null;
  let pruneTimer = null;

  const POLL_URL = '/.netlify/functions/vessels';
  const POLL_INTERVAL = 30000;  // 30s between polls
  const STALE_MS = 10 * 60 * 1000; // 10 min
  const PRUNE_INTERVAL = 60000;

  // Ship type color map — cached Cesium.Color objects
  const TYPE_COLORS = {
    35: { hex: '#ef4444', name: 'Military Ops' },
    55: { hex: '#06b6d4', name: 'Law Enforcement' },
    50: { hex: '#a855f7', name: 'Pilot Vessel' },
    51: { hex: '#f59e0b', name: 'Search & Rescue' },
    52: { hex: '#84cc16', name: 'Tug' },
    53: { hex: '#84cc16', name: 'Port Tender' },
    58: { hex: '#f43f5e', name: 'Medical Transport' },
  };
  const DEFAULT_COLOR_HEX = '#3b82f6';

  // Pre-cache Cesium colors per type
  const typeColorCache = new Map();
  for (const [code, info] of Object.entries(TYPE_COLORS)) {
    typeColorCache.set(Number(code), {
      point: Cesium.Color.fromCssColorString(info.hex).withAlpha(0.85),
      outline: Cesium.Color.fromCssColorString(info.hex),
      label: Cesium.Color.fromCssColorString(info.hex).withAlpha(0.7),
      track: Cesium.Color.fromCssColorString(info.hex).withAlpha(0.4),
    });
  }
  const defaultColors = {
    point: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX).withAlpha(0.85),
    outline: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX),
    label: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX).withAlpha(0.7),
    track: Cesium.Color.fromCssColorString(DEFAULT_COLOR_HEX).withAlpha(0.4),
  };

  function getTypeColors(shipType) {
    return typeColorCache.get(shipType) || defaultColors;
  }

  // Ship type name lookup
  const SHIP_TYPE_NAMES = {
    20: 'Wing in Ground', 21: 'WIG Carrying DG/HS/MP', 29: 'WIG (No info)',
    30: 'Fishing', 31: 'Towing', 32: 'Towing (Large)', 33: 'Dredging/Underwater Ops',
    34: 'Diving Operations', 35: 'Military Operations', 36: 'Sailing', 37: 'Pleasure Craft',
    40: 'High Speed Craft', 41: 'HSC Carrying DG/HS/MP', 49: 'HSC (No info)',
    50: 'Pilot Vessel', 51: 'Search & Rescue', 52: 'Tug', 53: 'Port Tender',
    54: 'Anti-pollution', 55: 'Law Enforcement', 56: 'Spare (Local)', 57: 'Spare (Local)',
    58: 'Medical Transport', 59: 'Noncombatant (RR No.18)',
    60: 'Passenger', 69: 'Passenger (No info)',
    70: 'Cargo', 79: 'Cargo (No info)',
    80: 'Tanker', 89: 'Tanker (No info)',
    90: 'Other', 99: 'Other (No info)',
  };

  function getShipTypeName(code) {
    if (code == null) return 'Unknown';
    return SHIP_TYPE_NAMES[code] || `Type ${code}`;
  }

  // Country code → flag emoji
  function countryToFlag(code) {
    if (!code || code === '??') return '';
    return String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
  }

  // Cached Cesium objects
  const LABEL_OFFSET = new Cesium.Cartesian2(0, -8);
  const LABEL_SCALE = new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3);
  const POINT_SCALE = new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.4);

  // Track history
  const trackHistory = new Map(); // MMSI → [{lon, lat, time}]
  const MAX_TRACK_POINTS = 50;
  let trackDataSource = null;

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

  function getFlag(mmsi) {
    return MID_FLAGS[String(mmsi).slice(0, 3)] || '??';
  }

  function init(viewer) {
    pointCollection = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT })
    );
    labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection());

    // Track history polylines
    trackDataSource = new Cesium.CustomDataSource('vessel-tracks');
    viewer.dataSources.add(trackDataSource);

    // First fetch immediately, then poll
    fetchVessels();
    pollTimer = setInterval(fetchVessels, POLL_INTERVAL);
    pruneTimer = setInterval(pruneStale, PRUNE_INTERVAL);
  }

  async function fetchVessels() {
    try {
      const resp = await fetch(POLL_URL);
      if (!resp.ok) {
        console.warn('[Vessels] Fetch failed:', resp.status);
        return;
      }

      const batch = await resp.json();
      if (!Array.isArray(batch)) {
        console.warn('[Vessels] Unexpected response format');
        return;
      }

      const now = Date.now();
      for (const v of batch) {
        const prev = vesselData.get(v.mmsi);
        vesselData.set(v.mmsi, {
          mmsi: v.mmsi,
          name: v.name || '',
          callsign: v.callsign || null,
          shipType: v.shipType || null,
          flag: getFlag(v.mmsi),
          lat: v.lat,
          lon: v.lon,
          speed: v.speed,
          course: v.course,
          heading: v.heading,
          status: v.status,
          lastUpdate: now,
        });

        // Record track history (only when position changes)
        if (!prev || prev.lat !== v.lat || prev.lon !== v.lon) {
          let track = trackHistory.get(v.mmsi);
          if (!track) {
            track = [];
            trackHistory.set(v.mmsi, track);
          }
          track.push({ lon: v.lon, lat: v.lat, time: now });
          if (track.length > MAX_TRACK_POINTS) track.shift();
        }
      }

      reconcileRender();
      updateStats();
      Globe.requestRender();
      console.log('[Vessels] Polled:', batch.length, 'vessels, total tracked:', vesselData.size);
    } catch (err) {
      console.warn('[Vessels] Poll error:', err.message);
    }
  }

  function makeLabelText(vessel) {
    const flag = countryToFlag(vessel.flag);
    const name = vessel.name || String(vessel.mmsi);
    return flag ? `${flag} ${name}` : name;
  }

  function reconcileRender() {
    // Update existing / remove departed
    for (const [mmsi, point] of pointMap) {
      const vessel = vesselData.get(mmsi);
      if (vessel) {
        const colors = getTypeColors(vessel.shipType);
        const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 100);
        point.position = pos;
        point.color = colors.point;
        point.outlineColor = colors.outline;
        point.id = makePickData(vessel);
        const label = labelMap.get(mmsi);
        if (label) {
          label.position = pos;
          label.text = makeLabelText(vessel);
          label.fillColor = colors.label;
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

      const colors = getTypeColors(vessel.shipType);
      const pos = Cesium.Cartesian3.fromDegrees(vessel.lon, vessel.lat, 100);
      const pickData = makePickData(vessel);

      const point = pointCollection.add({
        position: pos,
        pixelSize: 6,
        color: colors.point,
        outlineColor: colors.outline,
        outlineWidth: 1,
        disableDepthTestDistance: 0,
        scaleByDistance: POINT_SCALE,
        id: pickData,
        show: visible,
      });
      pointMap.set(mmsi, point);

      const label = labelCollection.add({
        position: pos,
        text: makeLabelText(vessel),
        font: '10px monospace',
        fillColor: colors.label,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: LABEL_OFFSET,
        disableDepthTestDistance: 0,
        scaleByDistance: LABEL_SCALE,
        id: pickData,
        show: visible && labelsVisible,
      });
      labelMap.set(mmsi, label);
    }

    // Render track history polylines
    if (trackDataSource) {
      trackDataSource.entities.removeAll();
      for (const [mmsi, track] of trackHistory) {
        if (track.length < 2) continue;
        const vessel = vesselData.get(mmsi);
        if (!vessel) continue;
        const colors = getTypeColors(vessel.shipType);
        const positions = track.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 50));
        trackDataSource.entities.add({
          polyline: {
            positions,
            width: 1.5,
            material: colors.track,
            clampToGround: false,
          },
          show: visible,
        });
      }
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
        trackHistory.delete(mmsi);
        pruned++;
      }
    }
    if (pruned > 0) {
      reconcileRender();
      updateStats();
      Globe.requestRender();
    }
  }

  function setVisible(v) {
    visible = v;
    if (pointCollection) pointCollection.show = v;
    if (labelCollection) labelCollection.show = v && labelsVisible;
    if (trackDataSource) {
      trackDataSource.entities.values.forEach(e => { e.show = v; });
    }
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
    getVesselByMMSI, getNavStatusText, getShipTypeName, countryToFlag,
    getTypeColorHex: (shipType) => (TYPE_COLORS[shipType]?.hex || DEFAULT_COLOR_HEX),
  };
})();
