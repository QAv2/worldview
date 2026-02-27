// intel.js — Intel network overlay from disclosure-files data

const Intel = (() => {
  let entities = [];
  let connectionEntities = [];
  let visible = false; // off by default (dense layer)
  let intelData = [];

  // Geo-enriched intel entities — curated subset with known locations
  const INTEL_ENTITIES = [
    { id: 'pentagon', name: 'The Pentagon', lat: 38.8719, lon: -77.0563, type: 'facility', tier: 'documented', description: 'US Department of Defense headquarters. Houses OUSD(I&S), DIA, and UAP disclosure oversight functions.' },
    { id: 'langley', name: 'CIA Headquarters', lat: 38.9517, lon: -77.1467, type: 'facility', tier: 'documented', description: 'Central Intelligence Agency, Langley VA. ORD (Office of Research & Development) linked to consciousness research programs.' },
    { id: 'nsa-ft-meade', name: 'NSA Fort Meade', lat: 39.1086, lon: -76.7714, type: 'facility', tier: 'documented', description: 'National Security Agency headquarters. SIGINT collection, connected to Five Eyes/ECHELON network.' },
    { id: 'dia-bolling', name: 'DIA / Bolling AFB', lat: 38.8396, lon: -76.9528, type: 'facility', tier: 'documented', description: 'Defense Intelligence Agency. Ran AAWSAP/AATIP ($22M, 2007-2012). 38 Defense Intelligence Reference Documents (DIRDs).' },
    { id: 'battelle', name: 'Battelle Memorial Institute', lat: 39.9950, lon: -82.9821, type: 'organization', tier: 'credible', description: 'Manages 7 national labs. Named in Grusch testimony and Wilson-Davis memo as materials custodian.' },
    { id: 'lockheed-skunkworks', name: 'Lockheed Skunk Works', lat: 34.6366, lon: -118.0847, type: 'organization', tier: 'credible', description: 'Lockheed Martin Advanced Development Programs (Palmdale). Named in multiple retrieval program allegations.' },
    { id: 'wright-pat-fti', name: 'Wright-Patterson FTD', lat: 39.8261, lon: -84.0483, type: 'facility', tier: 'credible', description: 'Foreign Technology Division (now NASIC). Historical center for recovered material analysis per Goldwater, Corso.' },
    { id: 'livermore', name: 'Lawrence Livermore NL', lat: 37.6879, lon: -121.7044, type: 'facility', tier: 'documented', description: 'LLNL. Nuclear weapons lab. Connected to Z Division (intelligence). AAWSAP subcontractor.' },
    { id: 'los-alamos-intel', name: 'Los Alamos NL', lat: 35.8800, lon: -106.3031, type: 'facility', tier: 'documented', description: 'LANL. Manhattan Project origin. Active nuclear weapons + exotic materials research.' },
    { id: 'bigelow-lv', name: 'Bigelow Aerospace', lat: 36.0788, lon: -115.0200, type: 'organization', tier: 'documented', description: 'Robert Bigelow\'s aerospace company, Las Vegas. Received AAWSAP contract. BAASS subcontractor for UAP investigation.' },
    { id: 'skinwalker', name: 'Skinwalker Ranch', lat: 40.2588, lon: -109.8880, type: 'location', tier: 'credible', description: 'Uintah Basin, UT. NIDS then BAASS/AAWSAP research site. Anomalous phenomena documented by Kelleher/Knapp.' },
    { id: 'wilson-davis-loc', name: 'EG&G / Nevada Test Site', lat: 36.7906, lon: -116.1892, type: 'facility', tier: 'credible', description: 'EG&G Special Projects. Wilson-Davis memo implicates test site contractor in reverse engineering program.' },
    { id: 'capitol-hill', name: 'US Capitol', lat: 38.8899, lon: -77.0091, type: 'facility', tier: 'documented', description: 'Congressional oversight. AARO, Grusch testimony (July 2023), UAPDA legislation, Schumer-Rounds amendment.' },
    { id: 'raytheon-tucson', name: 'Raytheon Missiles & Defense', lat: 32.1643, lon: -110.8570, type: 'organization', tier: 'credible', description: 'Raytheon (now RTX) missile systems, Tucson AZ. Named in UAP contractor allegations.' },
    { id: 'northrop-palmdale', name: 'Northrop Grumman', lat: 34.6156, lon: -118.0852, type: 'organization', tier: 'credible', description: 'Northrop Grumman Palmdale facility. B-2/B-21 programs. Named in legacy program allegations.' },
    { id: 'boeing-phantom', name: 'Boeing Phantom Works', lat: 33.9200, lon: -118.3900, type: 'organization', tier: 'credible', description: 'Boeing classified programs division. St. Louis + satellite locations. Named by Grusch in contractor allegations.' },
    { id: 'sci-apps', name: 'SAIC/Leidos', lat: 38.9537, lon: -77.3477, type: 'organization', tier: 'credible', description: 'Science Applications International. Former employers of multiple UAP researchers. Government IT contractor.' },
    { id: 'stanford-sri', name: 'Stanford / SRI International', lat: 37.4545, lon: -122.1750, type: 'organization', tier: 'documented', description: 'SRI International (formerly Stanford Research Institute). Ran Stargate remote viewing program for CIA/DIA.' },
    { id: 'aaro-hq', name: 'AARO (Pentagon)', lat: 38.8719, lon: -77.0563, type: 'facility', tier: 'documented', description: 'All-domain Anomaly Resolution Office. Established 2022. Kirkpatrick then Phillips. Congressional reporting mandate.' },
  ];

  async function init(viewer) {
    intelData = INTEL_ENTITIES;
    renderEntities(viewer);
    Globe.requestRender();
  }

  function renderEntities(viewer) {
    entities.forEach(e => viewer.entities.remove(e));
    entities = [];

    const typeColors = {
      facility: '#4a9eff',
      organization: '#c084fc',
      location: '#fbbf24',
      person: '#f87171',
    };

    intelData.forEach(ent => {
      const color = typeColors[ent.type] || '#4a9eff';

      const entity = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(ent.lon, ent.lat),
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.fromCssColorString(color),
          outlineWidth: 2,
          disableDepthTestDistance: 0,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: ent.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: 0,
          show: true,
          scaleByDistance: new Cesium.NearFarScalar(1e5, 1, 3e6, 0.4),
        },
        properties: {
          type: 'intel',
          id: ent.id,
          name: ent.name,
          entityType: ent.type,
          evidence_tier: ent.tier,
          description: ent.description,
        },
        show: visible,
      });

      entities.push(entity);
    });
  }

  function setVisible(v) {
    visible = v;
    entities.forEach(e => { e.show = v; });
    connectionEntities.forEach(e => { e.show = v; });
    Globe.requestRender();
  }

  function isVisible() { return visible; }
  function getCount() { return intelData.length; }

  function getEntityById(id) {
    return intelData.find(e => e.id === id);
  }

  function setLabelsVisible(show) {
    entities.forEach(e => {
      if (e.label) e.label.show = show;
    });
  }

  return { init, setVisible, isVisible, getCount, getEntityById, setLabelsVisible };
})();
