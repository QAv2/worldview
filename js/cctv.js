// cctv.js — Multi-source global traffic camera feeds

const CCTV = (() => {
  let entities = [];
  let visible = true;
  let cameraData = [];
  const REFRESH_MS = 300000; // 5 minutes

  // Each source: { name, url, parse(data) → [{lat, lon, name, imageUrl, source}] }
  const SOURCES = [
    {
      name: 'Austin TX',
      url: 'https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=500',
      parse: (data) => data.map(c => {
        let lat, lon;
        if (c.location && c.location.coordinates) {
          lon = parseFloat(c.location.coordinates[0]);
          lat = parseFloat(c.location.coordinates[1]);
        } else {
          lat = parseFloat(c.location_latitude);
          lon = parseFloat(c.location_longitude);
        }
        return {
          lat, lon,
          name: c.location_name || c.camera_id || 'Austin Camera',
          imageUrl: c.camera_mgt_url || c.screenshot_address || null,
          source: 'Austin TX',
        };
      }),
    },
    {
      name: 'London TfL',
      url: 'https://api.tfl.gov.uk/Place/Type/JamCam',
      parse: (data) => data.map(cam => {
        const imgProp = (cam.additionalProperties || []).find(p => p.key === 'imageUrl');
        return {
          lat: cam.lat,
          lon: cam.lon,
          name: cam.commonName || cam.id || 'London Camera',
          imageUrl: imgProp ? imgProp.value : null,
          source: 'TfL London',
        };
      }),
    },
    {
      name: 'Finland',
      url: 'https://tie.digitraffic.fi/api/weathercam/v1/stations',
      parse: (data) => {
        const features = data.features || [];
        return features.map(f => {
          const coords = f.geometry ? f.geometry.coordinates : null;
          const props = f.properties || {};
          const presets = props.presets || [];
          // Station list only has preset IDs — construct image URL from ID
          const presetId = presets.length > 0 ? presets[0].id : null;
          const img = presetId ? `https://weathercam.digitraffic.fi/${presetId}.jpg` : null;
          return {
            lat: coords ? coords[1] : null,
            lon: coords ? coords[0] : null,
            name: props.name || props.id || 'Finland Camera',
            imageUrl: img,
            source: 'Finland',
          };
        });
      },
    },
    {
      name: 'Caltrans D7 (LA)',
      url: 'https://cwwp2.dot.ca.gov/data/d7/cctv/cctvStatusD07.json',
      parse: parseCaltrans,
    },
    {
      name: 'Caltrans D4 (Bay Area)',
      url: 'https://cwwp2.dot.ca.gov/data/d4/cctv/cctvStatusD04.json',
      parse: parseCaltrans,
    },
    {
      name: 'Caltrans D12 (Orange County)',
      url: 'https://cwwp2.dot.ca.gov/data/d12/cctv/cctvStatusD12.json',
      parse: parseCaltrans,
    },
    {
      name: 'Caltrans D11 (San Diego)',
      url: 'https://cwwp2.dot.ca.gov/data/d11/cctv/cctvStatusD11.json',
      parse: parseCaltrans,
    },
    {
      name: 'Caltrans D3 (Sacramento)',
      url: 'https://cwwp2.dot.ca.gov/data/d3/cctv/cctvStatusD03.json',
      parse: parseCaltrans,
    },
    // WSDOT (Washington) — removed, API decommissioned (404)
  ];

  // Shared parser for Caltrans district CCTV JSON
  function parseCaltrans(data) {
    // Caltrans format: { data: [{ cctv: { location: {...}, imageData: { static: { currentImageURL } } } }] }
    const items = data.data || data;
    if (!Array.isArray(items)) return [];
    return items.map(item => {
      const cam = item.cctv || item;
      const loc = cam.location || {};
      const imgData = cam.imageData || {};
      const staticData = imgData.static || {};
      return {
        lat: loc.latitude || cam.latitude,
        lon: loc.longitude || cam.longitude,
        name: loc.locationName || loc.description || cam.description || 'Caltrans Camera',
        imageUrl: staticData.currentImageURL || null,
        source: 'Caltrans CA',
      };
    });
  }

  async function init(viewer) {
    await fetchAllCameras(viewer);
    setInterval(() => fetchAllCameras(viewer), REFRESH_MS);
  }

  async function fetchAllCameras(viewer) {
    const promises = SOURCES.map(src => fetchSource(src));
    const results = await Promise.allSettled(promises);

    let allCameras = [];
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        const cams = results[i].value;
        console.log(`[CCTV] ${SOURCES[i].name}: ${cams.length} cameras`);
        allCameras = allCameras.concat(cams);
      } else {
        console.warn(`[CCTV] ${SOURCES[i].name}: failed —`, results[i].reason?.message || 'unknown error');
      }
    }

    // Filter valid coordinates
    cameraData = allCameras.filter(c => {
      const lat = parseFloat(c.lat);
      const lon = parseFloat(c.lon);
      return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
    });

    console.log(`[CCTV] Total: ${cameraData.length} cameras from ${SOURCES.length} sources`);
    renderCameras(viewer);
    updateStats();
  }

  async function fetchSource(src) {
    let data;
    try {
      const resp = await fetch(src.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      data = await resp.json();
    } catch {
      // Fallback through CORS proxy
      const resp = await fetch(`/.netlify/functions/proxy?url=${encodeURIComponent(src.url)}`);
      if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
      data = await resp.json();
    }
    return src.parse(data);
  }

  function renderCameras(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    cameraData.forEach(cam => {
      const lat = parseFloat(cam.lat);
      const lon = parseFloat(cam.lon);
      if (isNaN(lat) || isNaN(lon)) return;

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat),
        point: {
          pixelSize: 5,
          color: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.7),
          outlineColor: Cesium.Color.fromCssColorString('#34d399'),
          outlineWidth: 1,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 5e5, 0.3),
        },
        label: {
          text: cam.name || '—',
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString('#34d399').withAlpha(0.6),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -8),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          show: false,
          scaleByDistance: new Cesium.NearFarScalar(1e4, 1, 2e5, 0),
        },
        properties: {
          type: 'cctv',
          name: cam.name,
          imageUrl: cam.imageUrl,
          source: cam.source,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function showFeed(cam) {
    const overlay = document.getElementById('cctv-overlay');
    const title = document.getElementById('cctv-title');
    const img = document.getElementById('cctv-image');

    const name = cam.name?.getValue ? cam.name.getValue() : cam.name;
    const imageUrl = cam.imageUrl?.getValue ? cam.imageUrl.getValue() : cam.imageUrl;
    const source = cam.source?.getValue ? cam.source.getValue() : cam.source;

    title.textContent = (name || 'Camera Feed') + (source ? ` [${source}]` : '');

    if (imageUrl) {
      img.src = imageUrl;
      img.alt = name || 'Camera';
    } else {
      img.src = '';
      img.alt = 'No feed available';
    }

    overlay.classList.add('visible');
  }

  function hideFeed() {
    document.getElementById('cctv-overlay').classList.remove('visible');
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
  }

  function isVisible() { return visible; }
  function getCount() { return entities.length; }

  function updateStats() {
    const el = document.getElementById('stat-cctv');
    if (el) el.textContent = `${entities.length} cams`;
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return { init, setVisible, isVisible, getCount, showFeed, hideFeed, setLabelsVisible };
})();
