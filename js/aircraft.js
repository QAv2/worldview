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

  const ALL_URL = 'https://api.adsb.lol/v2/lat/39.83/lon/-98.58/dist/250';
  const MIL_URL = 'https://api.adsb.lol/v2/mil';
  const REFRESH_MS = 10000; // 10 seconds
  const MAX_FAILURES = 3; // stop retrying after this many consecutive failures

  async function init(viewer) {
    await fetchAircraft(viewer);
    if (consecutiveFailures < MAX_FAILURES) {
      refreshTimer = setInterval(() => {
        if (consecutiveFailures >= MAX_FAILURES) {
          clearInterval(refreshTimer);
          console.warn('[Aircraft] Disabled auto-refresh after repeated failures (CORS proxy not available locally)');
          return;
        }
        fetchAircraft(viewer);
      }, REFRESH_MS);
    } else {
      console.warn('[Aircraft] Skipping auto-refresh — no data source available locally');
    }
  }

  async function fetchAircraft(viewer) {
    try {
      // Try fetching military aircraft separately
      const [allResp, milResp] = await Promise.allSettled([
        fetchWithProxy(ALL_URL),
        fetchWithProxy(MIL_URL),
      ]);

      const allData = allResp.status === 'fulfilled' ? allResp.value : { ac: [] };
      const milData = milResp.status === 'fulfilled' ? milResp.value : { ac: [] };

      // Merge, marking military aircraft
      const milHexes = new Set((milData.ac || []).map(a => a.hex));
      aircraftData = (allData.ac || []).map(a => ({
        ...a,
        isMilitary: milHexes.has(a.hex),
      }));

      // Also add any military-only entries not in all
      (milData.ac || []).forEach(a => {
        if (!aircraftData.find(x => x.hex === a.hex)) {
          aircraftData.push({ ...a, isMilitary: true });
        }
      });

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
