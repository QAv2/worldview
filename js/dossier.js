// dossier.js — Side panel for entity/location details

const Dossier = (() => {
  const panel = document.getElementById('dossier-panel');
  const titleEl = document.getElementById('dossier-title');
  const bodyEl = document.getElementById('dossier-body');
  let currentId = null;

  function init() {
    document.getElementById('dossier-close').addEventListener('click', close);
  }

  function showBase(baseId) {
    const base = Bases.getBaseById(baseId);
    if (!base) return;

    currentId = baseId;
    titleEl.textContent = base.name;

    const tierColor = getTierColor(base.evidence_tier);

    let html = `
      <div class="dossier-type-tag" style="background:${tierColor}22;color:${tierColor}">
        ${base.type.replace(/_/g, ' ')}
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${base.evidence_tier}">${base.evidence_tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${base.lat.toFixed(4)}, ${base.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Depth Estimate</div>
        <div class="dossier-field-value">${esc(base.depth_estimate)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Primary Source</div>
        <div class="dossier-field-value">${esc(base.source)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Notes</div>
        <div class="dossier-field-value">${esc(base.notes)}</div>
      </div>
    `;

    // Connected facilities
    if (base.connections && base.connections.length > 0) {
      html += `
        <div class="dossier-field">
          <div class="dossier-field-label">Connected Facilities</div>
          <ul class="dossier-connections">
            ${base.connections.map(id => {
              const connected = Bases.getBaseById(id);
              const name = connected ? connected.name : id;
              return `<li data-base-id="${esc(id)}">${esc(name)}</li>`;
            }).join('')}
          </ul>
        </div>
      `;
    }

    // Earthquake correlation
    const viewer = Globe.getViewer();
    const nearby = Bases.showCorrelation(viewer, baseId);

    if (nearby.length > 0) {
      html += `
        <div class="correlation-alert">
          <div class="correlation-alert-title">Seismic Activity (${Bases.getData().length ? '150' : '—'}km radius)</div>
          ${nearby.slice(0, 5).map(q => {
            const mag = q.properties.mag;
            const place = q.properties.place || 'Unknown';
            const dist = q.distance.toFixed(0);
            const depth = q.geometry.coordinates[2];
            return `<div class="correlation-alert-item">M${mag.toFixed(1)} — ${esc(place)} (${dist}km, ${depth.toFixed(0)}km deep)</div>`;
          }).join('')}
          ${nearby.length > 5 ? `<div class="correlation-alert-item" style="color:var(--text-tertiary)">+ ${nearby.length - 5} more</div>` : ''}
        </div>
      `;
    }

    bodyEl.innerHTML = html;
    panel.classList.add('open');

    // Connection click handlers
    bodyEl.querySelectorAll('.dossier-connections li').forEach(li => {
      li.addEventListener('click', () => {
        const id = li.getAttribute('data-base-id');
        const connected = Bases.getBaseById(id);
        if (connected) {
          Globe.flyTo(connected.lon, connected.lat, 50000, 1.5);
          showBase(id);
        }
      });
    });
  }

  function showMilitary(baseId) {
    const base = Military.getBaseById(baseId);
    if (!base) return;

    currentId = baseId;
    titleEl.textContent = base.name;

    const branchColors = {
      army: '#8b5cf6',
      navy: '#3b82f6',
      air_force: '#06b6d4',
      marines: '#ef4444',
      space_force: '#a855f7',
      joint: '#f59e0b',
      intelligence: '#ec4899',
      foreign_military: '#6b7280',
    };
    const branchColor = branchColors[base.branch] || '#6b7280';
    const branchLabel = base.branch ? base.branch.replace(/_/g, ' ') : 'unknown';
    const typeLabel = base.type ? base.type.replace(/_/g, ' ') : 'unknown';

    let html = `
      <div class="dossier-type-tag" style="background:${branchColor}22;color:${branchColor}">
        ${branchLabel}
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Installation Type</div>
        <div class="dossier-field-value">${esc(typeLabel)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Operator</div>
        <div class="dossier-field-value">${esc(base.operator)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Country</div>
        <div class="dossier-field-value">${esc(base.country)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Status</div>
        <div class="dossier-field-value">${esc(base.status)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${base.lat.toFixed(4)}, ${base.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Notes</div>
        <div class="dossier-field-value">${esc(base.notes)}</div>
      </div>
    `;

    bodyEl.innerHTML = html;
    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showIntel(entityId) {
    const ent = Intel.getEntityById(entityId);
    if (!ent) return;

    currentId = entityId;
    titleEl.textContent = ent.name;

    // Branch on source
    if (ent.source === 'intel-console') {
      showConsoleIntel(ent);
    } else {
      showCuratedIntel(ent);
    }

    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showCuratedIntel(ent) {
    const tierColor = getTierColor(ent.tier);
    const typeColors = {
      facility: '#4a9eff',
      organization: '#c084fc',
      location: '#fbbf24',
      person: '#f87171',
    };
    const typeColor = typeColors[ent.type] || '#4a9eff';

    let html = `
      <div class="dossier-type-tag" style="background:${typeColor}22;color:${typeColor}">
        ${ent.type}
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${ent.tier}">${ent.tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${ent.lat.toFixed(4)}, ${ent.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Description</div>
        <div class="dossier-field-value">${esc(ent.description)}</div>
      </div>
    `;

    bodyEl.innerHTML = html;
  }

  function showConsoleIntel(ent) {
    const consoleColors = {
      facility: '#f59e0b',
      organization: '#ec4899',
      agency: '#ef4444',
      person: '#a78bfa',
    };
    const typeColor = consoleColors[ent.type] || '#f59e0b';

    const signals = Intel.getSignalsForEntity(ent.id);

    let html = `
      <div class="dossier-type-tag" style="background:${typeColor}22;color:${typeColor}">
        ${ent.type}
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Evidence Tier</div>
        <div class="dossier-field-value">
          <span class="tier-badge ${ent.tier}">${ent.tier}</span>
        </div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Coordinates</div>
        <div class="dossier-field-value">${ent.lat.toFixed(4)}, ${ent.lon.toFixed(4)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Network Centrality</div>
        <div class="dossier-field-value">${(ent.centrality || 0).toFixed(4)} (${ent.connection_count || 0} connections)</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Description</div>
        <div class="dossier-field-value">${esc(ent.description)}</div>
      </div>
    `;

    // Recent signals
    if (signals.length > 0) {
      const shown = signals.slice(0, 5);
      html += `
        <div class="dossier-field">
          <div class="dossier-field-label">Recent Signals (${signals.length})</div>
          <div class="signal-feed">
            ${shown.map(s => {
              const time = s.collected_at ? new Date(s.collected_at).toISOString().replace('T', ' ').slice(0, 16) : '';
              return `<div class="signal-item">
                <span class="signal-feed-badge">${esc(s.source_feed)}</span>
                <a class="signal-headline" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.headline)}</a>
                <span class="signal-time">${time}</span>
              </div>`;
            }).join('')}
          </div>
        </div>
      `;
    }

    // Console link
    html += `
      <a class="console-link" href="https://qav2.github.io/intel-console/" target="_blank" rel="noopener">
        Open in Intel Console
      </a>
    `;

    bodyEl.innerHTML = html;
  }

  function showEarthquake(props) {
    currentId = null;
    const mag = props.magnitude?.getValue ? props.magnitude.getValue() : props.magnitude;
    const depth = props.depth?.getValue ? props.depth.getValue() : props.depth;
    const place = props.place?.getValue ? props.place.getValue() : props.place;
    const time = props.time?.getValue ? props.time.getValue() : props.time;
    const url = props.url?.getValue ? props.url.getValue() : props.url;

    titleEl.textContent = `M${Number(mag).toFixed(1)} Earthquake`;

    const date = new Date(time);

    let html = `
      <div class="dossier-type-tag" style="background:var(--quake-shallow)22;color:var(--quake-shallow)">
        earthquake
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Magnitude</div>
        <div class="dossier-field-value">${Number(mag).toFixed(1)}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Depth</div>
        <div class="dossier-field-value">${Number(depth).toFixed(1)} km</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Location</div>
        <div class="dossier-field-value">${esc(String(place))}</div>
      </div>

      <div class="dossier-field">
        <div class="dossier-field-label">Time (UTC)</div>
        <div class="dossier-field-value">${date.toISOString().replace('T', ' ').slice(0, 19)}</div>
      </div>

      ${url ? `
      <div class="dossier-field">
        <div class="dossier-field-label">USGS Detail</div>
        <div class="dossier-field-value"><a href="${esc(String(url))}" target="_blank" style="color:var(--accent)">${esc(String(url))}</a></div>
      </div>` : ''}
    `;

    bodyEl.innerHTML = html;
    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showAircraft(props) {
    currentId = null;
    const callsign = props.callsign?.getValue ? props.callsign.getValue() : props.callsign;
    const hex = props.hex?.getValue ? props.hex.getValue() : props.hex;
    const isMil = props.isMilitary?.getValue ? props.isMilitary.getValue() : props.isMilitary;
    const alt = props.altitude?.getValue ? props.altitude.getValue() : props.altitude;
    const speed = props.speed?.getValue ? props.speed.getValue() : props.speed;
    const heading = props.heading?.getValue ? props.heading.getValue() : props.heading;
    const squawk = props.squawk?.getValue ? props.squawk.getValue() : props.squawk;
    const reg = props.registration?.getValue ? props.registration.getValue() : props.registration;
    const acType = props.aircraftType?.getValue ? props.aircraftType.getValue() : props.aircraftType;
    const operator = props.operator?.getValue ? props.operator.getValue() : props.operator;
    const country = props.originCountry?.getValue ? props.originCountry.getValue() : props.originCountry;

    titleEl.textContent = callsign || hex || 'Aircraft';

    const tagColor = isMil ? 'var(--aircraft-mil)' : 'var(--aircraft-civil)';

    let html = `
      <div class="dossier-type-tag" style="background:${tagColor}22;color:${tagColor}">
        ${isMil ? 'military' : 'civilian'} aircraft
      </div>

      ${callsign ? `<div class="dossier-field"><div class="dossier-field-label">Callsign</div><div class="dossier-field-value">${esc(String(callsign))}</div></div>` : ''}
      ${hex ? `<div class="dossier-field"><div class="dossier-field-label">ICAO Hex</div><div class="dossier-field-value">${esc(String(hex))}</div></div>` : ''}
      ${reg ? `<div class="dossier-field"><div class="dossier-field-label">Registration</div><div class="dossier-field-value">${esc(String(reg))}</div></div>` : ''}
      ${acType ? `<div class="dossier-field"><div class="dossier-field-label">Type</div><div class="dossier-field-value">${esc(String(acType))}</div></div>` : ''}
      ${operator ? `<div class="dossier-field"><div class="dossier-field-label">Operator</div><div class="dossier-field-value">${esc(String(operator))}</div></div>` : ''}
      ${country ? `<div class="dossier-field"><div class="dossier-field-label">Origin</div><div class="dossier-field-value">${esc(String(country))}</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">Altitude</div><div class="dossier-field-value">${alt ? (Number(alt) * 3.28084).toFixed(0) + ' ft' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Ground Speed</div><div class="dossier-field-value">${speed ? Number(speed).toFixed(0) + ' kts' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Heading</div><div class="dossier-field-value">${heading ? Number(heading).toFixed(0) + '°' : '—'}</div></div>
      ${squawk ? `<div class="dossier-field"><div class="dossier-field-label">Squawk</div><div class="dossier-field-value">${esc(String(squawk))}</div></div>` : ''}
    `;

    bodyEl.innerHTML = html;
    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showSatellite(props) {
    currentId = null;
    const name = props.name?.getValue ? props.name.getValue() : props.name;
    const noradId = props.noradId?.getValue ? props.noradId.getValue() : props.noradId;
    const objectType = props.objectType?.getValue ? props.objectType.getValue() : props.objectType;
    const period = props.period?.getValue ? props.period.getValue() : props.period;
    const inclination = props.inclination?.getValue ? props.inclination.getValue() : props.inclination;
    const apogee = props.apogee?.getValue ? props.apogee.getValue() : props.apogee;
    const perigee = props.perigee?.getValue ? props.perigee.getValue() : props.perigee;

    titleEl.textContent = name || 'Satellite';

    let html = `
      <div class="dossier-type-tag" style="background:var(--sat-color)22;color:var(--sat-color)">
        satellite
      </div>

      ${name ? `<div class="dossier-field"><div class="dossier-field-label">Name</div><div class="dossier-field-value">${esc(String(name))}</div></div>` : ''}
      ${noradId ? `<div class="dossier-field"><div class="dossier-field-label">NORAD ID</div><div class="dossier-field-value">${noradId}</div></div>` : ''}
      ${objectType ? `<div class="dossier-field"><div class="dossier-field-label">Object Type</div><div class="dossier-field-value">${esc(String(objectType))}</div></div>` : ''}
      ${period ? `<div class="dossier-field"><div class="dossier-field-label">Orbital Period</div><div class="dossier-field-value">${Number(period).toFixed(1)} min</div></div>` : ''}
      ${inclination ? `<div class="dossier-field"><div class="dossier-field-label">Inclination</div><div class="dossier-field-value">${Number(inclination).toFixed(1)}°</div></div>` : ''}
      ${apogee ? `<div class="dossier-field"><div class="dossier-field-label">Apogee</div><div class="dossier-field-value">${Number(apogee).toFixed(0)} km</div></div>` : ''}
      ${perigee ? `<div class="dossier-field"><div class="dossier-field-label">Perigee</div><div class="dossier-field-value">${Number(perigee).toFixed(0)} km</div></div>` : ''}
    `;

    bodyEl.innerHTML = html;
    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function showVessel(props) {
    currentId = null;
    const mmsi = props.mmsi?.getValue ? props.mmsi.getValue() : props.mmsi;
    const name = props.name?.getValue ? props.name.getValue() : props.name;
    const callsign = props.callsign?.getValue ? props.callsign.getValue() : props.callsign;
    const shipType = props.shipType?.getValue ? props.shipType.getValue() : props.shipType;
    const flag = props.flag?.getValue ? props.flag.getValue() : props.flag;
    const lat = props.lat?.getValue ? props.lat.getValue() : props.lat;
    const lon = props.lon?.getValue ? props.lon.getValue() : props.lon;
    const speed = props.speed?.getValue ? props.speed.getValue() : props.speed;
    const course = props.course?.getValue ? props.course.getValue() : props.course;
    const heading = props.heading?.getValue ? props.heading.getValue() : props.heading;
    const status = props.status?.getValue ? props.status.getValue() : props.status;
    const lastUpdate = props.lastUpdate?.getValue ? props.lastUpdate.getValue() : props.lastUpdate;

    titleEl.textContent = name || `MMSI ${mmsi}`;

    const navStatus = Vessels.getNavStatusText(status);
    const updateTime = lastUpdate ? new Date(lastUpdate).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
    const typeColorHex = Vessels.getTypeColorHex(shipType);
    const typeName = Vessels.getShipTypeName(shipType);
    const flagEmoji = Vessels.countryToFlag(flag);

    let html = `
      <div class="dossier-type-tag" style="background:${typeColorHex}22;color:${typeColorHex}">
        ${esc(typeName)}
      </div>

      ${name ? `<div class="dossier-field"><div class="dossier-field-label">Vessel Name</div><div class="dossier-field-value">${esc(String(name))}</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">MMSI</div><div class="dossier-field-value">${esc(String(mmsi))}</div></div>
      ${callsign ? `<div class="dossier-field"><div class="dossier-field-label">Callsign</div><div class="dossier-field-value">${esc(String(callsign))}</div></div>` : ''}
      ${flag ? `<div class="dossier-field"><div class="dossier-field-label">Flag</div><div class="dossier-field-value">${flagEmoji ? flagEmoji + ' ' : ''}${esc(String(flag))}</div></div>` : ''}
      ${shipType != null ? `<div class="dossier-field"><div class="dossier-field-label">Ship Type</div><div class="dossier-field-value">${esc(typeName)} (${shipType})</div></div>` : ''}
      <div class="dossier-field"><div class="dossier-field-label">Speed</div><div class="dossier-field-value">${speed != null ? Number(speed).toFixed(1) + ' kts' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Course</div><div class="dossier-field-value">${course != null ? Number(course).toFixed(0) + '°' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Heading</div><div class="dossier-field-value">${heading != null ? Number(heading).toFixed(0) + '°' : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Nav Status</div><div class="dossier-field-value">${esc(navStatus)}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Coordinates</div><div class="dossier-field-value">${lat != null ? Number(lat).toFixed(4) : '—'}, ${lon != null ? Number(lon).toFixed(4) : '—'}</div></div>
      <div class="dossier-field"><div class="dossier-field-label">Last Update</div><div class="dossier-field-value">${updateTime}</div></div>
    `;

    bodyEl.innerHTML = html;
    panel.classList.add('open');
    Bases.clearCorrelation(Globe.getViewer());
  }

  function close() {
    panel.classList.remove('open');
    currentId = null;
    Bases.clearCorrelation(Globe.getViewer());
  }

  function isOpen() {
    return panel.classList.contains('open');
  }

  function getTierColor(tier) {
    const colors = {
      documented: '#34d399',
      credible: '#fbbf24',
      inference: '#fb923c',
      speculative: '#f87171',
    };
    return colors[tier] || '#4a9eff';
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  return { init, showBase, showMilitary, showIntel, showEarthquake, showAircraft, showSatellite, showVessel, close, isOpen };
})();
