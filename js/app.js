// app.js — Boot sequence + state management

const App = (() => {
  const loadingScreen = document.getElementById('loading-screen');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBar = document.getElementById('loading-bar-fill');

  async function boot() {
    try {
      setProgress('INITIALIZING GLOBE...', 10);
      const viewer = Globe.init();

      setProgress('LOADING SHADERS...', 20);
      Shaders.init();

      setProgress('INITIALIZING DOSSIER...', 25);
      Dossier.init();

      setProgress('LOADING UNDERGROUND BASES...', 30);
      await Bases.init(viewer);

      setProgress('LOADING INTEL NETWORK...', 40);
      await Intel.init(viewer);

      setProgress('FETCHING EARTHQUAKE DATA...', 50);
      await Earthquakes.init(viewer);

      setProgress('TRACKING SATELLITES...', 65);
      await Satellites.init(viewer);

      setProgress('SCANNING AIRCRAFT...', 80);
      await Aircraft.init(viewer);

      setProgress('CONNECTING CCTV FEEDS...', 90);
      await CCTV.init(viewer);

      setProgress('INITIALIZING CONTROLS...', 95);
      await Controls.init();

      setProgress('SYSTEMS ONLINE', 100);

      // Start periodic updates
      setInterval(() => Controls.updateCounts(), 5000);
      Controls.updateCounts();

      // Dismiss loading screen
      setTimeout(() => {
        loadingScreen.classList.add('done');
        setTimeout(() => { loadingScreen.style.display = 'none'; }, 500);
      }, 800);

      console.log('[WorldView] All systems online');

    } catch (err) {
      console.error('[WorldView] Boot failed:', err);
      loadingStatus.textContent = 'ERROR: ' + err.message;
      loadingStatus.style.color = '#f87171';
    }
  }

  function setProgress(msg, pct) {
    loadingStatus.textContent = msg;
    loadingBar.style.width = pct + '%';
    console.log(`[WorldView] ${msg}`);
  }

  // Boot on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  return { boot };
})();
