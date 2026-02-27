// timeline.js — 7-day time scrubber for earthquake history + satellite propagation

const Timeline = (() => {
  let bar = null;
  let slider = null;
  let playBtn = null;
  let dateLabel = null;
  let statusLabel = null;
  let visible = false;
  let playing = false;
  let playInterval = null;
  let currentEpoch = null; // null = LIVE

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const PLAY_STEP_MS = 15 * 60 * 1000; // 15 min per tick when playing
  const PLAY_INTERVAL_MS = 200; // tick every 200ms

  function init() {
    buildDOM();
    attachListeners();
    updateDisplay();
  }

  function buildDOM() {
    bar = document.getElementById('timeline-bar');
    slider = document.getElementById('timeline-slider');
    playBtn = document.getElementById('timeline-play');
    dateLabel = document.getElementById('timeline-date');
    statusLabel = document.getElementById('timeline-status');

    // Set slider range: 7 days ago → now
    updateSliderRange();
  }

  function updateSliderRange() {
    const now = Date.now();
    slider.min = now - SEVEN_DAYS_MS;
    slider.max = now;
    slider.value = now;
  }

  function attachListeners() {
    slider.addEventListener('input', () => {
      const val = parseInt(slider.value);
      const now = Date.now();
      // If dragged to within 5 min of now, snap to LIVE
      if (now - val < 5 * 60 * 1000) {
        goLive();
      } else {
        currentEpoch = val;
        stopPlay();
        broadcastTime();
        updateDisplay();
      }
    });

    playBtn.addEventListener('click', togglePlay);
  }

  function togglePlay() {
    if (playing) {
      stopPlay();
    } else {
      startPlay();
    }
  }

  function startPlay() {
    if (currentEpoch === null) {
      // Start from 7 days ago
      currentEpoch = Date.now() - SEVEN_DAYS_MS;
      slider.value = currentEpoch;
    }
    playing = true;
    playBtn.textContent = '\u23F8'; // pause icon
    playInterval = setInterval(() => {
      currentEpoch += PLAY_STEP_MS;
      const now = Date.now();
      if (currentEpoch >= now) {
        goLive();
        return;
      }
      slider.value = currentEpoch;
      broadcastTime();
      updateDisplay();
    }, PLAY_INTERVAL_MS);
  }

  function stopPlay() {
    playing = false;
    playBtn.textContent = '\u25B6'; // play icon
    if (playInterval) {
      clearInterval(playInterval);
      playInterval = null;
    }
  }

  function goLive() {
    stopPlay();
    currentEpoch = null;
    updateSliderRange();
    broadcastTime();
    updateDisplay();
    updateTopBarLive(true);
  }

  function broadcastTime() {
    const epoch = currentEpoch;
    // Update layers that support time scrubbing
    if (typeof Earthquakes !== 'undefined' && Earthquakes.setTime) {
      Earthquakes.setTime(epoch);
    }
    if (typeof Satellites !== 'undefined' && Satellites.setTime) {
      Satellites.setTime(epoch);
    }
    // Update top bar LIVE indicator
    updateTopBarLive(epoch === null);
  }

  function updateTopBarLive(isLive) {
    const liveEl = document.querySelector('#top-bar .live');
    if (liveEl) {
      if (isLive) {
        liveEl.textContent = 'LIVE';
        liveEl.style.color = '';
      } else {
        const d = new Date(currentEpoch);
        liveEl.textContent = 'REPLAY ' + formatShortDate(d);
        liveEl.style.color = 'var(--quake-shallow)';
      }
    }
  }

  function updateDisplay() {
    if (currentEpoch === null) {
      dateLabel.textContent = 'NOW';
      statusLabel.textContent = 'LIVE';
      statusLabel.className = 'timeline-status live';
    } else {
      const d = new Date(currentEpoch);
      dateLabel.textContent = formatDate(d);
      statusLabel.textContent = 'REPLAY';
      statusLabel.className = 'timeline-status replay';
    }
  }

  function formatDate(d) {
    const mon = d.toLocaleString('en', { month: 'short' });
    const day = d.getUTCDate();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${mon} ${day} ${h}:${m} UTC`;
  }

  function formatShortDate(d) {
    const mon = d.toLocaleString('en', { month: 'short' });
    const day = d.getUTCDate();
    const h = String(d.getUTCHours()).padStart(2, '0');
    const m = String(d.getUTCMinutes()).padStart(2, '0');
    return `${mon} ${day} ${h}:${m}`;
  }

  // Public API
  function getTime() {
    return currentEpoch !== null ? currentEpoch : Date.now();
  }

  function isLive() {
    return currentEpoch === null;
  }

  function setVisible(v) {
    visible = v;
    if (bar) bar.classList.toggle('hidden', !v);
    document.body.classList.toggle('timeline-open', v);
    // When hiding, reset to LIVE
    if (!v && currentEpoch !== null) {
      goLive();
    }
  }

  function isTimelineVisible() {
    return visible;
  }

  // Keyboard actions (called from controls.js)
  function stepBack() {
    if (currentEpoch === null) {
      currentEpoch = Date.now() - ONE_HOUR_MS;
    } else {
      currentEpoch = Math.max(currentEpoch - ONE_HOUR_MS, Date.now() - SEVEN_DAYS_MS);
    }
    stopPlay();
    slider.value = currentEpoch;
    broadcastTime();
    updateDisplay();
    // Auto-show timeline when stepping
    if (!visible) setVisible(true);
  }

  function stepForward() {
    if (currentEpoch === null) return; // Already LIVE
    currentEpoch = currentEpoch + ONE_HOUR_MS;
    const now = Date.now();
    if (currentEpoch >= now) {
      goLive();
      return;
    }
    stopPlay();
    slider.value = currentEpoch;
    broadcastTime();
    updateDisplay();
  }

  function resetToLive() {
    goLive();
  }

  return {
    init, getTime, isLive, setVisible, isTimelineVisible,
    stepBack, stepForward, togglePlay, resetToLive,
  };
})();
