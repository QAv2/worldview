// aircraft.js — Global aircraft tracking (PointPrimitiveCollection + LOD budget)
// Uses Cesium Primitive API for 10-100x performance over Entity API.
// Full dataset kept in memory; render budget limits visible points by zoom level.
// Military aircraft + tracked aircraft always rendered. Civil spatially sampled.

const Aircraft = (() => {
  // --- Primitive collections (one draw call each, regardless of point count) ---
  let pointCollection = null;
  let labelCollection = null;
  const pointMap = new Map();  // hex → PointPrimitive
  const labelMap = new Map();  // hex → Label

  // --- State ---
  let visible = true;
  let labelsVisible = true;
  let aircraftData = [];       // full dataset from API (~10K)
  let trackedHex = null;
  let trailEntity = null;
  let trailPositions = [];
  let consecutiveFailures = 0;
  let refreshTimer = null;
  let cameraDebounce = null;
  let currentViewer = null;

  // --- Cached Cesium objects (created once, reused across all points) ---
  const MIL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.85);
  const MIL_OUTLINE = Cesium.Color.fromCssColorString('#fb923c');
  const MIL_LABEL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.7);
  const CIVIL_COLOR = Cesium.Color.fromCssColorString('#e2e8f0').withAlpha(0.85);
  const LABEL_OFFSET = new Cesium.Cartesian2(0, -8);
  const LABEL_SCALE = new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3);
  const POINT_SCALE = new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.4);
  const TRAIL_COLOR = Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.5);

  // --- Data sources ---
  const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
  const MIL_URL = 'https://api.adsb.lol/v2/mil';
  const ADSB_REGIONS = [
    { lat: 47.6, lon: -122.3, label: 'US-PNW' },
    { lat: 37.8, lon: -122.4, label: 'US-NorCal' },
    { lat: 34.0, lon: -118.2, label: 'US-SoCal' },
    { lat: 33.4, lon: -112.0, label: 'US-AZ' },
    { lat: 39.7, lon: -104.9, label: 'US-CO' },
    { lat: 44.9, lon: -93.3,  label: 'US-MN' },
    { lat: 39.8, lon: -98.6,  label: 'US-KS' },
    { lat: 29.8, lon: -95.4,  label: 'US-TX' },
    { lat: 41.9, lon: -87.6,  label: 'US-IL' },
    { lat: 33.7, lon: -84.4,  label: 'US-GA' },
    { lat: 40.7, lon: -74.0,  label: 'US-NY' },
    { lat: 42.4, lon: -71.0,  label: 'US-MA' },
    { lat: 25.8, lon: -80.2,  label: 'US-FL' },
    { lat: 38.9, lon: -77.0,  label: 'US-DC' },
    { lat: 51.5, lon: -0.1,   label: 'UK' },
    { lat: 48.9, lon: 2.3,    label: 'France' },
    { lat: 52.5, lon: 13.4,   label: 'Germany' },
    { lat: 41.9, lon: 12.5,   label: 'Italy' },
    { lat: 40.4, lon: -3.7,   label: 'Spain' },
    { lat: 55.8, lon: 37.6,   label: 'Russia-W' },
    { lat: 35.7, lon: 139.7,  label: 'Japan' },
    { lat: 25.0, lon: 55.3,   label: 'UAE' },
    { lat: 1.35, lon: 103.8,  label: 'Singapore' },
    { lat: -33.9, lon: 151.2, label: 'Australia' },
    { lat: -23.5, lon: -46.6, label: 'Brazil' },
  ];
  const ADSB_DIST = 250;

  const REFRESH_MS = 15000;
  const MAX_FAILURES = 5;

  // ========== LOD BUDGET ==========
  // Camera height → max rendered points. Military always shown on top of budget.
  function getRenderBudget(viewer) {
    const height = viewer.camera.positionCartographic.height;
    if (height > 15_000_000) return 800;   // global view
    if (height > 8_000_000)  return 1200;  // hemisphere
    if (height > 5_000_000)  return 2000;  // continental
    if (height > 2_000_000)  return 3000;  // regional
    if (height > 1_000_000)  return 4000;  // country
    return 5000;                            // zoomed in
  }

  // Select subset for rendering: all military + tracked + sampled civil
  function selectForRender(data, budget) {
    if (data.length <= budget) return data;

    const mil = [];
    const civil = [];
    for (const ac of data) {
      if (ac.isMilitary) mil.push(ac);
      else civil.push(ac);
    }

    const result = [...mil];

    // Always include tracked aircraft
    if (trackedHex) {
      const tracked = civil.find(a => a.hex === trackedHex);
      if (tracked) result.push(tracked);
    }

    const civilBudget = Math.max(0, budget - result.length);

    if (civil.length <= civilBudget) {
      // All civil fit
      for (const ac of civil) {
        if (ac.hex !== trackedHex) result.push(ac);
      }
    } else {
      // Spatial grid sampling — one aircraft per grid cell
      // Grid size adapts so we fill the budget with even geographic spread
      const gridSize = Math.max(0.5, Math.sqrt(civil.length / civilBudget) * 0.8);
      // Time-based offset rotates which aircraft gets priority each refresh
      const offset = Math.floor(Date.now() / REFRESH_MS) % civil.length;
      const grid = new Map();

      for (let i = 0; i < civil.length && grid.size < civilBudget; i++) {
        const ac = civil[(offset + i) % civil.length];
        if (ac.hex === trackedHex) continue;
        const key = `${Math.floor(ac.lat / gridSize)},${Math.floor(ac.lon / gridSize)}`;
        if (!grid.has(key)) grid.set(key, ac);
      }
      for (const ac of grid.values()) result.push(ac);
    }

    return result;
  }

  // ========== INIT ==========
  async function init(viewer) {
    currentViewer = viewer;

    // Create primitive collections (1-2 GPU draw calls total)
    pointCollection = viewer.scene.primitives.add(
      new Cesium.PointPrimitiveCollection({ blendOption: Cesium.BlendOption.TRANSLUCENT })
    );
    labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection());

    // Re-render on camera zoom changes (debounced)
    viewer.camera.changed.addEventListener(() => {
      if (cameraDebounce) clearTimeout(cameraDebounce);
      cameraDebounce = setTimeout(() => {
        if (aircraftData.length > 0) {
          reconcileRender(viewer);
          updateStats();
        }
      }, 300);
    });
    // Lower the percentage threshold so changed fires on meaningful zooms
    viewer.camera.percentageChanged = 0.2;

    await fetchAircraft(viewer);
    if (consecutiveFailures < MAX_FAILURES) {
      refreshTimer = setInterval(() => {
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(refreshTimer);
          console.warn('[Aircraft] Disabled auto-refresh after repeated failures');
          return;
        }
        fetchAircraft(viewer);
      }, REFRESH_MS);
    } else {
      console.warn('[Aircraft] Skipping auto-refresh — no data source available');
    }
  }

  // ========== DATA FETCHING (unchanged logic) ==========
  async function fetchAircraft(viewer) {
    try {
      const milPromise = fetchWithProxy(MIL_URL).catch(() => ({ ac: [] }));

      let allAircraft = [];
      let source = 'none';

      try {
        const opensky = await fetchWithProxy(OPENSKY_URL);
        if (opensky.states && opensky.states.length > 0) {
          allAircraft = parseOpenSky(opensky.states);
          source = 'OpenSky';
          console.log(`[Aircraft] OpenSky: ${opensky.states.length} vectors -> ${allAircraft.length} airborne`);
        } else {
          throw new Error('OpenSky returned no states');
        }
      } catch (err) {
        console.warn(`[Aircraft] OpenSky failed (${err.message}), falling back to adsb.lol tiling...`);
        allAircraft = await fetchAdsbTiled();
        source = 'adsb.lol';
      }

      const milData = await milPromise;
      const milHexes = new Set((milData.ac || []).map(a => a.hex));
      const acMap = new Map(allAircraft.map(a => [a.hex, a]));

      for (const ac of allAircraft) {
        if (milHexes.has(ac.hex)) ac.isMilitary = true;
      }

      for (const a of (milData.ac || [])) {
        if (a.hex && a.lat && a.lon && !acMap.has(a.hex)) {
          allAircraft.push({
            hex: a.hex,
            flight: (a.flight || '').trim(),
            lat: a.lat,
            lon: a.lon,
            alt_meters: (a.alt_geom || a.alt_baro || 10000) * 0.3048,
            track: a.track || 0,
            gs: a.gs,
            squawk: a.squawk,
            category: a.category,
            r: a.r,
            t: a.t,
            ownOp: a.ownOp,
            on_ground: false,
            isMilitary: true,
          });
        }
      }

      aircraftData = allAircraft;
      const milCount = aircraftData.filter(a => a.isMilitary).length;
      console.log(`[Aircraft] ${source}: ${aircraftData.length} total (${milCount} mil)`);

      consecutiveFailures = 0;
      reconcileRender(viewer);
      updateStats();
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Aircraft] Fetch failed (${consecutiveFailures}/${MAX_FAILURES}):`, err.message);
    }
  }

  function parseOpenSky(states) {
    const aircraft = [];
    for (const s of states) {
      if (s[5] == null || s[6] == null || s[8]) continue;
      const geoAlt = s[13];
      const baroAlt = s[7];
      const alt = geoAlt != null ? geoAlt : (baroAlt != null ? baroAlt : 10000);
      aircraft.push({
        hex: s[0],
        flight: (s[1] || '').trim(),
        lat: s[6],
        lon: s[5],
        alt_meters: alt,
        track: s[10] || 0,
        gs: s[9] != null ? s[9] * 1.944 : null,
        squawk: s[14] || null,
        category: s[17] || null,
        origin_country: s[2] || null,
        on_ground: false,
        isMilitary: false,
      });
    }
    return aircraft;
  }

  async function fetchAdsbTiled() {
    const urls = ADSB_REGIONS.map(r =>
      `https://api.adsb.lol/v2/lat/${r.lat}/lon/${r.lon}/dist/${ADSB_DIST}`
    );
    const results = await Promise.allSettled(urls.map(u => fetchWithProxy(u)));
    const seen = new Map();
    for (let i = 0; i < results.length; i++) {
      if (results[i].status !== 'fulfilled') {
        console.warn(`[Aircraft] adsb.lol ${ADSB_REGIONS[i].label} failed`);
        continue;
      }
      const ac = results[i].value.ac || [];
      for (const a of ac) {
        if (a.hex && a.lat && a.lon && !seen.has(a.hex)) {
          seen.set(a.hex, {
            hex: a.hex,
            flight: (a.flight || '').trim(),
            lat: a.lat,
            lon: a.lon,
            alt_meters: (a.alt_geom || a.alt_baro || 10000) * 0.3048,
            track: a.track || 0,
            gs: a.gs,
            squawk: a.squawk,
            category: a.category,
            r: a.r,
            t: a.t,
            ownOp: a.ownOp,
            on_ground: false,
            isMilitary: false,
          });
        }
      }
    }
    return Array.from(seen.values());
  }

  async function fetchWithProxy(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch {
      const resp = await fetch(`/.netlify/functions/proxy?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
      return await resp.json();
    }
  }

  // ========== RENDER — Delta reconciliation ==========
  // Only adds new points, updates moved points, removes departed points.
  // No mass destroy/recreate cycle.
  function reconcileRender(viewer) {
    const budget = getRenderBudget(viewer);
    const toRender = selectForRender(aircraftData, budget);
    const desired = new Map(toRender.map(ac => [ac.hex, ac]));

    // 1. Update existing points that are still desired, remove departed
    for (const [hex, point] of pointMap) {
      const ac = desired.get(hex);
      if (ac) {
        // Update in place — no allocation except Cartesian3
        const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0);
        point.position = pos;
        point.color = ac.isMilitary ? MIL_COLOR : CIVIL_COLOR;
        point.pixelSize = ac.isMilitary ? 5 : 3;
        point.id = makePickData(ac);

        const label = labelMap.get(hex);
        if (label) {
          label.position = pos;
          label.text = ac.flight || ac.hex || '-';
          label.id = point.id;
        }

        desired.delete(hex); // handled
      } else {
        // Aircraft departed or filtered out — remove
        pointCollection.remove(point);
        pointMap.delete(hex);
        const label = labelMap.get(hex);
        if (label) {
          labelCollection.remove(label);
          labelMap.delete(hex);
        }
      }
    }

    // 2. Add new points for aircraft not yet rendered
    for (const [hex, ac] of desired) {
      if (!ac.lat || !ac.lon) continue;

      const isMil = ac.isMilitary;
      const pos = Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0);
      const pickData = makePickData(ac);

      const point = pointCollection.add({
        position: pos,
        pixelSize: isMil ? 5 : 3,
        color: isMil ? MIL_COLOR : CIVIL_COLOR,
        outlineColor: isMil ? MIL_OUTLINE : Cesium.Color.TRANSPARENT,
        outlineWidth: isMil ? 1 : 0,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: POINT_SCALE,
        id: pickData,
        show: visible,
      });
      pointMap.set(hex, point);

      // Labels only for military aircraft
      if (isMil) {
        const label = labelCollection.add({
          position: pos,
          text: ac.flight || ac.hex || '-',
          font: '10px monospace',
          fillColor: MIL_LABEL_COLOR,
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
        labelMap.set(hex, label);
      }
    }

    // 3. Update trail for tracked aircraft
    if (trackedHex) {
      const tracked = aircraftData.find(a => a.hex === trackedHex);
      if (tracked && tracked.lat && tracked.lon) {
        trailPositions.push(Cesium.Cartesian3.fromDegrees(tracked.lon, tracked.lat, tracked.alt_meters || 0));
        if (trailPositions.length > 100) trailPositions.shift();
        drawTrail(viewer);
      }
    }
  }

  // Build a plain object for scene.pick() — matches dossier field names
  function makePickData(ac) {
    return {
      type: 'aircraft',
      hex: ac.hex,
      callsign: ac.flight || ac.hex || '',
      isMilitary: ac.isMilitary,
      altitude: ac.alt_meters || 0,
      speed: ac.gs,
      heading: ac.track || 0,
      squawk: ac.squawk,
      category: ac.category,
      registration: ac.r || null,
      aircraftType: ac.t || null,
      operator: ac.ownOp || null,
      originCountry: ac.origin_country || null,
    };
  }

  // ========== TRACKING ==========
  function trackAircraft(viewer, hex) {
    trackedHex = hex;
    trailPositions = [];
    const ac = aircraftData.find(a => a.hex === hex);
    if (ac && ac.lat && ac.lon) {
      trailPositions.push(Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, ac.alt_meters || 0));
    }
  }

  function drawTrail(viewer) {
    if (trailEntity) viewer.entities.remove(trailEntity);
    if (trailPositions.length < 2) return;
    trailEntity = viewer.entities.add({
      polyline: {
        positions: [...trailPositions],
        width: 1.5,
        material: TRAIL_COLOR,
      },
      show: visible,
    });
  }

  function clearTrack(viewer) {
    trackedHex = null;
    trailPositions = [];
    if (trailEntity) { viewer.entities.remove(trailEntity); trailEntity = null; }
  }

  // ========== VISIBILITY ==========
  function setVisible(v) {
    visible = v;
    if (pointCollection) pointCollection.show = v;
    if (labelCollection) labelCollection.show = v && labelsVisible;
    if (trailEntity) trailEntity.show = v;
  }

  function isVisible() { return visible; }

  function setLabelsVisible(show) {
    labelsVisible = show;
    if (labelCollection) labelCollection.show = visible && show;
  }

  // ========== STATS ==========
  function getCount() { return pointMap.size; }
  function getTotalCount() { return aircraftData.length; }
  function getMilCount() { return aircraftData.filter(a => a.isMilitary).length; }

  function updateStats() {
    const el = document.getElementById('stat-aircraft');
    if (el) {
      const rendered = pointMap.size;
      const total = aircraftData.length;
      const mil = getMilCount();
      if (total > rendered) {
        el.textContent = `${rendered}/${total} aircraft (${mil} mil)`;
      } else {
        el.textContent = `${total} aircraft (${mil} mil)`;
      }
    }
  }

  return {
    init, setVisible, isVisible, getCount, getTotalCount, getMilCount,
    trackAircraft, clearTrack, setLabelsVisible,
  };
})();
