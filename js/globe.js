// globe.js — CesiumJS viewer initialization with multiple base layer options

const Globe = (() => {
  let viewer = null;
  let currentBaseLayer = 'dark';
  let google3dTileset = null;
  const GOOGLE_API_KEY = '__GOOGLE_MAPS_API_KEY__';

  // Available base layer providers
  const BASE_LAYERS = {
    dark: {
      name: 'Dark Matter',
      create: () => new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('CartoDB'),
        maximumLevel: 18,
      }),
    },
    satellite: {
      name: 'Satellite',
      create: () => new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics'),
        maximumLevel: 19,
      }),
    },
    terrain: {
      name: 'Terrain',
      create: () => new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/arcgis/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}',
        credit: new Cesium.Credit('Esri, National Geographic'),
        maximumLevel: 16,
      }),
    },
    osm: {
      name: 'OpenStreetMap',
      create: () => new Cesium.OpenStreetMapImageryProvider({
        url: 'https://tile.openstreetmap.org/',
        credit: new Cesium.Credit('OpenStreetMap contributors'),
      }),
    },
    voyager: {
      name: 'Voyager',
      create: () => new Cesium.UrlTemplateImageryProvider({
        url: 'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
        credit: new Cesium.Credit('CartoDB'),
        maximumLevel: 18,
      }),
    },
    google3d: {
      name: '3D Tiles',
      is3d: true,
    },
  };

  function init() {
    // No Ion token — use open tile sources only
    Cesium.Ion.defaultAccessToken = undefined;

    viewer = new Cesium.Viewer('cesiumContainer', {
      // Disable all default UI
      animation: false,
      timeline: false,
      fullscreenButton: false,
      vrButton: false,
      geocoder: false,
      homeButton: false,
      navigationHelpButton: false,
      baseLayerPicker: false,
      sceneModePicker: false,
      selectionIndicator: false,
      infoBox: false,
      creditContainer: document.createElement('div'),

      // Start with dark base layer
      baseLayer: new Cesium.ImageryLayer(BASE_LAYERS.dark.create()),

      // Flat globe
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),

      // Scene settings
      skyBox: false,
      skyAtmosphere: false,
      orderIndependentTranslucency: false,
      contextOptions: {
        webgl: { alpha: true },
      },
    });

    // Dark scene settings
    const scene = viewer.scene;
    scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0f');
    scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a0f');
    scene.globe.showGroundAtmosphere = false;
    scene.fog.enabled = false;
    if (scene.sun) scene.sun.show = false;
    if (scene.moon) scene.moon.show = false;
    if (scene.skyBox) scene.skyBox.show = false;

    scene.globe.enableLighting = false;
    scene.requestRenderMode = true;
    scene.maximumRenderTimeChange = Infinity;

    // Initial camera — US overview
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-98.5795, 39.8283, 15000000),
    });

    return viewer;
  }

  function removeGoogle3d() {
    if (google3dTileset) {
      viewer.scene.primitives.remove(google3dTileset);
      google3dTileset = null;
    }
    viewer.scene.globe.show = true;
  }

  async function loadGoogle3d() {
    if (google3dTileset) return;
    if (!GOOGLE_API_KEY || GOOGLE_API_KEY.startsWith('__')) {
      console.warn('[Globe] Google Maps API key not configured');
      return;
    }
    try {
      google3dTileset = await Cesium.Cesium3DTileset.fromUrl(
        `https://tile.googleapis.com/v1/3dtiles/root.json?key=${GOOGLE_API_KEY}`
      );
      viewer.scene.primitives.add(google3dTileset);
      viewer.scene.globe.show = false;
      requestRender();
    } catch (err) {
      console.error('[Globe] Failed to load Google 3D Tiles:', err);
      google3dTileset = null;
      viewer.scene.globe.show = true;
    }
  }

  function setBaseLayer(layerId) {
    if (!viewer || !BASE_LAYERS[layerId]) return;
    const scene = viewer.scene;

    // Leaving 3D tiles mode
    if (currentBaseLayer === 'google3d' && layerId !== 'google3d') {
      removeGoogle3d();
    }

    // Entering 3D tiles mode
    if (layerId === 'google3d') {
      currentBaseLayer = layerId;
      loadGoogle3d();
      scene.backgroundColor = Cesium.Color.fromCssColorString('#000408');
      scene.globe.showGroundAtmosphere = true;
      if (scene.sun) scene.sun.show = true;
      if (scene.moon) scene.moon.show = true;
      scene.globe.enableLighting = true;
      requestRender();
      return;
    }

    // Standard imagery layer swap
    const layers = viewer.imageryLayers;
    if (layers.length > 0) {
      layers.remove(layers.get(0));
    }
    const provider = BASE_LAYERS[layerId].create();
    const newLayer = new Cesium.ImageryLayer(provider);
    layers.add(newLayer, 0);

    currentBaseLayer = layerId;

    if (layerId === 'dark') {
      scene.backgroundColor = Cesium.Color.fromCssColorString('#0a0a0f');
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#0a0a0f');
      scene.globe.showGroundAtmosphere = false;
      if (scene.sun) scene.sun.show = false;
      if (scene.moon) scene.moon.show = false;
      scene.globe.enableLighting = false;
    } else {
      scene.backgroundColor = Cesium.Color.fromCssColorString('#000408');
      scene.globe.baseColor = Cesium.Color.fromCssColorString('#1a2a3a');
      scene.globe.showGroundAtmosphere = true;
      if (scene.sun) scene.sun.show = true;
      if (scene.moon) scene.moon.show = true;
      scene.globe.enableLighting = true;
    }

    requestRender();
  }

  function getBaseLayerId() {
    return currentBaseLayer;
  }

  function getBaseLayerList() {
    return Object.entries(BASE_LAYERS).map(([id, layer]) => ({
      id,
      name: layer.name,
    }));
  }

  function flyTo(lon, lat, altitude, duration = 2.0) {
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, altitude),
      duration: duration,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  function getViewer() {
    return viewer;
  }

  function getMouseCoords(movement) {
    if (!viewer) return null;
    const ray = viewer.camera.getPickRay(movement.endPosition || movement.position);
    if (!ray) return null;
    const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
    if (!cartesian) return null;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      alt: viewer.camera.positionCartographic.height,
    };
  }

  function getCameraState() {
    if (!viewer) return null;
    const carto = viewer.camera.positionCartographic;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      alt: carto.height,
      heading: Cesium.Math.toDegrees(viewer.camera.heading),
      pitch: Cesium.Math.toDegrees(viewer.camera.pitch),
      roll: Cesium.Math.toDegrees(viewer.camera.roll),
    };
  }

  function requestRender() {
    if (viewer) viewer.scene.requestRender();
  }

  return { init, flyTo, getViewer, getMouseCoords, getCameraState, setBaseLayer, getBaseLayerId, getBaseLayerList, requestRender };
})();
