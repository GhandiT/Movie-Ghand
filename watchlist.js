/**
 * GHANDI MOVIES — Watchlist & Rewatchs
 * -------------------------------------
 * Reads the pre-generated watchlist.json (built from Watchlist.txt by
 * the GitHub Actions workflow — see scripts/fetch-watchlist.js). No
 * OMDb key or API calls happen in the browser.
 */

(function () {
  "use strict";

  const C = window.Common;

  const els = {
    grid: document.getElementById("movie-grid"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-state-message"),
    count: document.getElementById("watchlist-count"),
  };

  init();

  async function init() {
    const result = await C.loadJson("watchlist.json");

    if (!result.ok || !result.data || !Array.isArray(result.data.movies)) {
      showEmpty("watchlist.json couldn't be loaded. Run the update workflow, then reload this page.");
      return;
    }

    const movies = result.data.movies;
    const okMovies = movies.filter((m) => m && m.ok).map(C.normalizeFrontendMovie);
    const failedMovies = movies.filter((m) => m && !m.ok).map(C.normalizeFailedMovie);

    if (okMovies.length === 0 && failedMovies.length === 0) {
      showEmpty();
      return;
    }

    const failedNote = failedMovies.length
      ? ` · ${failedMovies.length} title${failedMovies.length === 1 ? "" : "s"} couldn't be found`
      : "";
    els.count.textContent = `${okMovies.length} film${okMovies.length === 1 ? "" : "s"}${failedNote}`;

    okMovies.forEach((m, i) => {
      try {
        const card = C.buildMovieCard(m);
        card.style.animationDelay = `${Math.min(i * 0.02, 0.5)}s`;
        els.grid.appendChild(card);
      } catch (err) {
        console.error("Skipped a watchlist card that failed to render:", err);
      }
    });

    failedMovies.forEach((m) => {
      try {
        els.grid.appendChild(C.buildErrorCard(m));
      } catch (err) {
        console.error("Skipped a watchlist error card that failed to render:", err);
      }
    });
  }

  function showEmpty(message) {
    els.empty.hidden = false;
    if (message) els.emptyMessage.textContent = message;
    els.count.textContent = "";
  }
})();
