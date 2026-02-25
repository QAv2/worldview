// cctv.js — Austin TX traffic camera feeds

const CCTV = (() => {
  let entities = [];
  let visible = true;
  let cameraData = [];
  const FEED_URL = 'https://data.austintexas.gov/resource/b4k4-adkb.json?$limit=200';
  const REFRESH_MS = 300000; // 5 minutes

  async function init(viewer) {
    await fetchCameras(viewer);
    setInterval(() => fetchCameras(viewer), REFRESH_MS);
  }

  async function fetchCameras(viewer) {
    try {
      const resp = await fetch(FEED_URL);
      const data = await resp.json();
      // API returns GeoJSON location: {type:"Point", coordinates:[lon, lat]}
      cameraData = data.filter(c =>
        (c.location && c.location.coordinates) ||
        (c.location_latitude && c.location_longitude)
      );
      renderCameras(viewer);
      updateStats();
      console.log(`[CCTV] Loaded ${cameraData.length} cameras`);
    } catch (err) {
      console.warn('[CCTV] Fetch failed:', err.message);
    }
  }

  function renderCameras(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    cameraData.forEach(cam => {
      let lat, lon;
      if (cam.location && cam.location.coordinates) {
        lon = parseFloat(cam.location.coordinates[0]);
        lat = parseFloat(cam.location.coordinates[1]);
      } else {
        lat = parseFloat(cam.location_latitude);
        lon = parseFloat(cam.location_longitude);
      }
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
          text: cam.location_name || cam.camera_id || '—',
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
          name: cam.location_name || cam.camera_id,
          imageUrl: cam.camera_mgt_url || cam.screenshot_address,
          cameraId: cam.camera_id,
          status: cam.camera_status,
          turnOn: cam.turn_on_date,
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

    title.textContent = name || 'Camera Feed';

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
