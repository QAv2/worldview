// aircraft.js — Global aircraft tracking (OpenSky Network + adsb.lol military)

const Aircraft = (() => {
  let entities = [];
  let visible = true;
  let aircraftData = [];
  let trackedHex = null;
  let trailEntity = null;
  let trailPositions = [];
  let consecutiveFailures = 0;
  let refreshTimer = null;

  // OpenSky Network — returns ALL global aircraft in one call
  const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
  // adsb.lol — military endpoint for mil tagging
  const MIL_URL = 'https://api.adsb.lol/v2/mil';
  // adsb.lol fallback regions (250 NM max per query — the actual API cap)
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
  const ADSB_DIST = 250; // nautical miles — adsb.lol hard cap

  const REFRESH_MS = 15000;
  const MAX_FAILURES = 5;

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
      // Fetch military data in parallel with main source
      const milPromise = fetchWithProxy(MIL_URL).catch(() => ({ ac: [] }));

      // Try OpenSky first (global, single request)
      let allAircraft = [];
      let source = 'none';

      try {
        const opensky = await fetchWithProxy(OPENSKY_URL);
        if (opensky.states && opensky.states.length > 0) {
          allAircraft = parseOpenSky(opensky.states);
          source = 'OpenSky';
          console.log(`[Aircraft] OpenSky: ${opensky.states.length} vectors → ${allAircraft.length} airborne`);
        } else {
          throw new Error('OpenSky returned no states');
        }
      } catch (err) {
        console.warn(`[Aircraft] OpenSky failed (${err.message}), falling back to adsb.lol tiling...`);
        allAircraft = await fetchAdsbTiled();
        source = 'adsb.lol';
      }

      // Apply military tagging
      const milData = await milPromise;
      const milHexes = new Set((milData.ac || []).map(a => a.hex));
      const acMap = new Map(allAircraft.map(a => [a.hex, a]));

      for (const ac of allAircraft) {
        if (milHexes.has(ac.hex)) ac.isMilitary = true;
      }

      // Add military-only entries not already in data
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
      renderAircraft(viewer);
      updateStats();
    } catch (err) {
      consecutiveFailures++;
      console.warn(`[Aircraft] Fetch failed (${consecutiveFailures}/${MAX_FAILURES}):`, err.message);
    }
  }

  // Parse OpenSky state vector arrays into objects
  // Indices: 0=icao24, 1=callsign, 2=origin_country, 5=lon, 6=lat,
  //          7=baro_alt(m), 8=on_ground, 9=velocity(m/s), 10=true_track,
  //          13=geo_alt(m), 14=squawk, 17=category
  function parseOpenSky(states) {
    const aircraft = [];
    for (const s of states) {
      // Skip no-position or on-ground
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
        gs: s[9] != null ? s[9] * 1.944 : null, // m/s → knots
        squawk: s[14] || null,
        category: s[17] || null,
        origin_country: s[2] || null,
        on_ground: false,
        isMilitary: false,
      });
    }
    return aircraft;
  }

  // Fallback: dense adsb.lol tiling at 250 NM per query
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
      console.log(`[Aircraft] adsb.lol ${ADSB_REGIONS[i].label}: ${ac.length}`);
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

      const alt = ac.alt_meters || 0;
      const heading = ac.track || 0;
      const callsign = ac.flight || ac.hex || '';

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
          registration: ac.r || null,
          aircraftType: ac.t || null,
          operator: ac.ownOp || null,
          originCountry: ac.origin_country || null,
        },
        show: visible,
      });

      entities.push(entity);
    });

    // Update trail if tracking
    if (trackedHex) {
      const tracked = aircraftData.find(a => a.hex === trackedHex);
      if (tracked && tracked.lat && tracked.lon) {
        trailPositions.push(Cesium.Cartesian3.fromDegrees(tracked.lon, tracked.lat, tracked.alt_meters || 0));
        if (trailPositions.length > 100) trailPositions.shift();
        drawTrail(viewer);
      }
    }
  }

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
