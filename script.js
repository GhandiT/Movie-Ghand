/**
 * GHANDI MOVIES — Home page
 * -------------------------
 * Reads the pre-generated movies.json (built by the GitHub Actions
 * workflow) and renders the searchable/sortable/filterable grid. This
 * file never calls the OMDb API and never needs an API key.
 *
 * Shared logic (theme toggle, back-to-top, hamburger menu, the DOM-safe
 * card/detail-overlay builders, and the `el()` helper) lives in
 * common.js, which is loaded before this file — see that file's header
 * comment for the security rationale behind building the DOM with
 * createElement/textContent instead of HTML strings.
 */

(function () {
  "use strict";

  const C = window.Common;

  const els = {
    grid: document.getElementById("movie-grid"),
    empty: document.getElementById("empty-state"),
    emptyMessage: document.getElementById("empty-state-message"),
    stats: document.getElementById("stats-strip"),
    resultCount: document.getElementById("result-count"),
    sort: document.getElementById("sort-select"),
    genre: document.getElementById("genre-select"),
    year: document.getElementById("year-select"),
    rating: document.getElementById("rating-select"),
    search: document.getElementById("search-input"),
    welcomeOverlay: document.getElementById("welcome-overlay"),
    welcomeClose: document.getElementById("welcome-close"),
    welcomeCta: document.getElementById("welcome-cta"),
  };

  let allMovies = []; // successfully-fetched movies, in movies.txt order
  let failedMovies = []; // movies OMDb couldn't resolve

  /* ==================================================================
     WELCOME POPUP (home page only)
     Shown once per browser session (sessionStorage). Auto-dismisses
     after 8s, or on click of close / CTA / backdrop / Escape.
     ================================================================== */

  function showWelcome() {
    if (!els.welcomeOverlay) return;

    let seen = false;
    try {
      seen = sessionStorage.getItem("welcome-seen") === "1";
    } catch {
      /* ignore */
    }
    if (seen) return;

    els.welcomeOverlay.hidden = false;

    let dismissTimer = null;
    let closed = false;

    function dismiss() {
      if (closed) return;
      closed = true;
      if (dismissTimer) clearTimeout(dismissTimer);
      els.welcomeOverlay.classList.add("closing");
      try {
        sessionStorage.setItem("welcome-seen", "1");
      } catch {
        /* ignore */
      }
      setTimeout(() => {
        els.welcomeOverlay.hidden = true;
        els.welcomeOverlay.classList.remove("closing");
      }, 350);
    }

    els.welcomeClose.addEventListener("click", dismiss, { once: true });
    els.welcomeCta.addEventListener("click", dismiss, { once: true });
    els.welcomeOverlay.addEventListener("click", (e) => {
      if (e.target === els.welcomeOverlay) dismiss();
    });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") {
        dismiss();
        document.removeEventListener("keydown", onKey);
      }
    });

    dismissTimer = setTimeout(dismiss, 8000);
  }

  /* ==================================================================
     BOOT
     ================================================================== */

  init();

  async function init() {
    const result = await C.loadJson("movies.json");

    if (!result.ok || !result.data || typeof result.data !== "object" || !Array.isArray(result.data.movies)) {
      showLoadFailure(result.error);
      return;
    }

    const data = result.data;
    const movies = data.movies;
    allMovies = movies.filter((m) => m && m.ok).map(C.normalizeFrontendMovie);
    failedMovies = movies.filter((m) => m && !m.ok).map(C.normalizeFailedMovie);

    allMovies.forEach((m, i) => (m._order = i));

    renderStats(data);
    populateFilters();
    bindControls();
    applyAndRender();

    // Show the welcome popup only after the grid has rendered.
    showWelcome();
  }

  function showLoadFailure(err) {
    els.stats.textContent = "";
    els.empty.hidden = false;
    els.emptyMessage.textContent =
      "movies.json couldn't be loaded. If you just deployed, run the update workflow once in the Actions tab.";
    console.error("Failed to load movies.json:", err);
  }

  /* ---------------- stats ---------------- */

  function renderStats(data) {
    els.stats.textContent = "";
    if (allMovies.length === 0) return;

    const ratings = allMovies.filter((m) => typeof m.imdbRating === "number");
    const avg = ratings.length
      ? (ratings.reduce((sum, m) => sum + m.imdbRating, 0) / ratings.length).toFixed(1)
      : "—";

    const highest = ratings.length ? ratings.reduce((a, b) => (b.imdbRating > a.imdbRating ? b : a)) : null;
    const lowest = ratings.length ? ratings.reduce((a, b) => (b.imdbRating < a.imdbRating ? b : a)) : null;

    const withYear = allMovies.filter((m) => typeof m.year === "number");
    const oldest = withYear.length ? withYear.reduce((a, b) => (b.year < a.year ? b : a)) : null;
    const newest = withYear.length ? withYear.reduce((a, b) => (b.year > a.year ? b : a)) : null;

    const stats = [
      { label: "Movies", value: String(allMovies.length) },
      { label: "Average rating", value: avg, accent: true },
      { label: "Highest rated", value: highest ? `${highest.title} (${highest.imdbRating})` : "—" },
      { label: "Lowest rated", value: lowest ? `${lowest.title} (${lowest.imdbRating})` : "—" },
      { label: "Oldest", value: oldest ? `${oldest.title} (${oldest.year})` : "—" },
      { label: "Newest", value: newest ? `${newest.title} (${newest.year})` : "—" },
    ];

    stats.forEach((s) => {
      els.stats.appendChild(
        C.el("div", {
          className: "stat",
          children: [
            C.el("span", { className: s.accent ? "stat-value accent" : "stat-value", text: s.value }),
            C.el("span", { className: "stat-label", text: s.label }),
          ],
        })
      );
    });

    if (data.generatedAt) {
      const when = new Date(data.generatedAt);
      if (!isNaN(when)) {
        els.stats.appendChild(
          C.el("div", {
            className: "stat",
            children: [
              C.el("span", { className: "stat-value", text: when.toLocaleDateString() }),
              C.el("span", { className: "stat-label", text: "Last updated" }),
            ],
          })
        );
      }
    }
  }

  /* ---------------- filters ---------------- */

  function populateFilters() {
    const genres = new Set();
    const years = new Set();

    allMovies.forEach((m) => {
      m.genres.forEach((g) => genres.add(g));
      if (typeof m.year === "number") years.add(m.year);
    });

    fillSelect(els.genre, Array.from(genres).sort(), "all", "All genres");
    fillSelect(
      els.year,
      Array.from(years).sort((a, b) => b - a),
      "all",
      "All years"
    );
  }

  function fillSelect(select, values, allValue, allLabel) {
    const current = select.value;
    select.textContent = "";
    select.appendChild(C.el("option", { text: allLabel, attrs: { value: allValue } }));
    values.forEach((v) => {
      select.appendChild(C.el("option", { text: String(v), attrs: { value: String(v) } }));
    });
    if (Array.from(select.options).some((o) => o.value === current)) {
      select.value = current;
    }
  }

  function bindControls() {
    [els.sort, els.genre, els.year, els.rating].forEach((elm) => elm.addEventListener("change", applyAndRender));

    // Search: debounced so we don't re-render on every keystroke.
    let searchTimeout = null;
    els.search.addEventListener("input", () => {
      if (searchTimeout) clearTimeout(searchTimeout);
      searchTimeout = setTimeout(applyAndRender, 150);
    });
    els.search.addEventListener("search", applyAndRender); // fires on the native ✕ button
  }

  /* ---------------- filter + sort + render ---------------- */

  function applyAndRender() {
    const genre = els.genre.value;
    const year = els.year.value;
    const minRating = parseFloat(els.rating.value);
    const sortMode = els.sort.value;
    const query = (els.search.value || "").trim().toLowerCase();

    let list = allMovies.filter((m) => {
      if (genre !== "all" && !m.genres.includes(genre)) return false;
      if (year !== "all" && String(m.year) !== year) return false;
      if (minRating > 0 && !(typeof m.imdbRating === "number" && m.imdbRating >= minRating)) return false;

      if (query) {
        const haystack = [m.title, m.director || "", ...(m.cast || []), ...(m.genres || [])].join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }

      return true;
    });

    list = sortMovies(list, sortMode);

    renderGrid(list);
    renderResultCount(list.length);
  }

  function sortMovies(list, mode) {
    const copy = [...list];
    switch (mode) {
      case "rating-desc":
        return copy.sort((a, b) => (b.imdbRating ?? -1) - (a.imdbRating ?? -1));
      case "rating-asc":
        return copy.sort((a, b) => (a.imdbRating ?? 999) - (b.imdbRating ?? 999));
      case "year-desc":
        return copy.sort((a, b) => (b.year ?? -1) - (a.year ?? -1));
      case "year-asc":
        return copy.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
      case "alpha-asc":
        return copy.sort((a, b) => a.title.localeCompare(b.title));
      case "alpha-desc":
        return copy.sort((a, b) => b.title.localeCompare(a.title));
      case "my-order":
      default:
        return copy.sort((a, b) => a._order - b._order);
    }
  }

  function renderResultCount(n) {
    const failedNote = failedMovies.length
      ? ` · ${failedMovies.length} title${failedMovies.length === 1 ? "" : "s"} couldn't be found`
      : "";
    els.resultCount.textContent = `${n} film${n === 1 ? "" : "s"}${failedNote}`;
  }

  function renderGrid(list) {
    els.grid.textContent = "";

    if (list.length === 0 && failedMovies.length === 0) {
      els.empty.hidden = false;
      els.emptyMessage.textContent =
        allMovies.length === 0
          ? "Add titles to movies.txt and run the update workflow to populate this archive."
          : "No films match the current filters.";
      return;
    }

    els.empty.hidden = true;

    list.forEach((m, i) => {
      try {
        const card = C.buildMovieCard(m);
        // Stagger the entrance animation — capped so long lists don't
        // take forever to finish animating in.
        card.style.animationDelay = `${Math.min(i * 0.02, 0.5)}s`;
        els.grid.appendChild(card);
      } catch (err) {
        console.error("Skipped a movie card that failed to render:", err);
      }
    });

    failedMovies.forEach((m) => {
      try {
        els.grid.appendChild(C.buildErrorCard(m));
      } catch (err) {
        console.error("Skipped an error card that failed to render:", err);
      }
    });
  }
})();
