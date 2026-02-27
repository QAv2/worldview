// app.js — Boot sequence + state management

const App = (() => {
  const loadingScreen = document.getElementById('loading-screen');
  const loadingStatus = document.getElementById('loading-status');
  const loadingBar = document.getElementById('loading-bar-fill');

  async function boot() {
    try {
      // Phase 1 — sequential core init
      setProgress('INITIALIZING CORE...', 10);
      const viewer = Globe.init();
      setProgress('INITIALIZING CORE...', 20);
      Shaders.init();
      setProgress('INITIALIZING CORE...', 25);
      Dossier.init();

      // Phase 2 — parallel data layer loading
      setProgress('LOADING DATA LAYERS...', 30);
      const t0 = performance.now();
      const results = await Promise.allSettled([
        Bases.init(viewer),
        Intel.init(viewer),
        Earthquakes.init(viewer),
        Satellites.init(viewer),
        Aircraft.init(viewer),
        Military.init(viewer),
        Vessels.init(viewer),
        Traffic.init(viewer),
      ]);
      const elapsed = ((performance.now() - t0) / 1000).toFixed(1);
      console.log(`[WorldView] Data layers loaded in ${elapsed}s`);

      // Log any failures
      const layerNames = ['Bases', 'Intel', 'Earthquakes', 'Satellites', 'Aircraft', 'Military', 'Vessels', 'Traffic'];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[WorldView] ${layerNames[i]} failed:`, r.reason);
        }
      });

      setProgress('LOADING DATA LAYERS...', 90);

      // Phase 3 — controls (depends on layers being ready)
      setProgress('INITIALIZING CONTROLS...', 95);
      await Controls.init();
      Timeline.init();

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
