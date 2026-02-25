// aircraft.js — adsb.lol aircraft tracking (commercial + military)

const Aircraft = (() => {
  let entities = [];
  let visible = true;
  let aircraftData = [];
  let trackedHex = null;
  let trailEntity = null;
  let trailPositions = [];
  let consecutiveFailures = 0;
  let refreshTimer = null;

  // Query multiple regions for global coverage (adsb.lol caps per-query results)
  const REGION_QUERIES = [
    { lat: 39.83, lon: -98.58, dist: 3000, label: 'Americas' },       // Central US — covers NA/SA
    { lat: 50.0,  lon: 10.0,   dist: 3000, label: 'Europe/Africa' },  // Central Europe
    { lat: 35.0,  lon: 105.0,  dist: 3000, label: 'Asia' },           // China
    { lat: -25.0, lon: 135.0,  dist: 3000, label: 'Oceania' },        // Australia
  ];
  const MIL_URL = 'https://api.adsb.lol/v2/mil';
  const REFRESH_MS = 15000; // 15 seconds (4 queries now)
  const MAX_FAILURES = 3;

  async function init(viewer) {
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

  async function fetchAircraft(viewer) {
    try {
      // Fetch all regions + military in parallel
      const regionUrls = REGION_QUERIES.map(r =>
        `https://api.adsb.lol/v2/lat/${r.lat}/lon/${r.lon}/dist/${r.dist}`
      );
      const fetches = [
        ...regionUrls.map(url => fetchWithProxy(url)),
        fetchWithProxy(MIL_URL),
      ];

      const results = await Promise.allSettled(fetches);

      // Military is the last result
      const milResult = results[results.length - 1];
      const milData = milResult.status === 'fulfilled' ? milResult.value : { ac: [] };
      const milHexes = new Set((milData.ac || []).map(a => a.hex));

      // Merge all regional results, dedup by hex
      const seen = new Map();
      for (let i = 0; i < results.length - 1; i++) {
        if (results[i].status !== 'fulfilled') {
          console.warn(`[Aircraft] ${REGION_QUERIES[i].label} query failed`);
          continue;
        }
        const ac = results[i].value.ac || [];
        console.log(`[Aircraft] ${REGION_QUERIES[i].label}: ${ac.length} aircraft`);
        for (const a of ac) {
          if (a.hex && !seen.has(a.hex)) {
            seen.set(a.hex, { ...a, isMilitary: milHexes.has(a.hex) });
          }
        }
      }

      // Add military-only entries not in regional data
      for (const a of (milData.ac || [])) {
        if (a.hex && !seen.has(a.hex)) {
          seen.set(a.hex, { ...a, isMilitary: true });
        }
      }

      aircraftData = Array.from(seen.values());
      console.log(`[Aircraft] Total: ${aircraftData.length} unique (${milHexes.size} mil tagged)`);

      consecutiveFailures = 0;
      renderAircraft(viewer);
      updateStats();
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Aircraft] Fetch failed (${consecutiveFailures}/${MAX_FAILURES}):`, err.message);
    }
  }

  async function fetchWithProxy(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Direct failed');
      return await resp.json();
    } catch {
      const resp = await fetch(`/.netlify/functions/proxy?url=${encodeURIComponent(url)}`);
      return await resp.json();
    }
  }

  function renderAircraft(viewer) {
    // Remove old
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    aircraftData.forEach(ac => {
      if (!ac.lat || !ac.lon) return;

      const isMil = ac.isMilitary;
      const color = isMil
        ? Cesium.Color.fromCssColorString('#fb923c')
        : Cesium.Color.fromCssColorString('#e2e8f0');

      const alt = (ac.alt_geom || ac.alt_baro || 10000) * 0.3048; // feet to meters
      const heading = ac.track || 0;
      const callsign = (ac.flight || ac.hex || '').trim();

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt),
        point: {
          pixelSize: isMil ? 5 : 3,
          color: color.withAlpha(0.85),
          outlineColor: color,
          outlineWidth: isMil ? 1 : 0,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: callsign || '—',
          font: `${isMil ? '10' : '9'}px monospace`,
          fillColor: color.withAlpha(0.7),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: isMil, // only show military labels by default
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 5e6, 0.3),
        },
        properties: {
          type: 'aircraft',
          hex: ac.hex,
          callsign: callsign,
          isMilitary: isMil,
          altitude: alt,
          speed: ac.gs, // ground speed in knots
          heading: heading,
          squawk: ac.squawk,
          category: ac.category,
          registration: ac.r,
          aircraftType: ac.t,
          operator: ac.ownOp,
        },
        show: visible,
      });

      entities.push(entity);
    });

    // Update trail if tracking
    if (trackedHex) {
      const tracked = aircraftData.find(a => a.hex === trackedHex);
      if (tracked && tracked.lat && tracked.lon) {
        const alt = (tracked.alt_geom || tracked.alt_baro || 10000) * 0.3048;
        trailPositions.push(Cesium.Cartesian3.fromDegrees(tracked.lon, tracked.lat, alt));
        if (trailPositions.length > 100) trailPositions.shift();
        drawTrail(viewer);
      }
    }
  }

  function trackAircraft(viewer, hex) {
    trackedHex = hex;
    trailPositions = [];
    // Find current position
    const ac = aircraftData.find(a => a.hex === hex);
    if (ac && ac.lat && ac.lon) {
      const alt = (ac.alt_geom || ac.alt_baro || 10000) * 0.3048;
      trailPositions.push(Cesium.Cartesian3.fromDegrees(ac.lon, ac.lat, alt));
    }
  }

  function drawTrail(viewer) {
    if (trailEntity) viewer.entities.remove(trailEntity);
    if (trailPositions.length < 2) return;

    trailEntity = viewer.entities.add({
      polyline: {
        positions: trailPositions,
        width: 1.5,
        material: Cesium.Color.fromCssColorString('#fb923c').withAlpha(0.5),
      },
      show: visible,
    });
  }

  function clearTrack(viewer) {
    trackedHex = null;
    trailPositions = [];
    if (trailEntity) { viewer.entities.remove(trailEntity); trailEntity = null; }
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    if (trailEntity) trailEntity.show = v;
  }

  function isVisible() { return visible; }
  function getCount() { return entities.length; }

  function getMilCount() {
    return aircraftData.filter(a => a.isMilitary).length;
  }

  function updateStats() {
    const el = document.getElementById('stat-aircraft');
    if (el) el.textContent = `${entities.length} aircraft (${getMilCount()} mil)`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return { init, setVisible, isVisible, getCount, getMilCount, trackAircraft, clearTrack, setLabelsVisible };
})();
