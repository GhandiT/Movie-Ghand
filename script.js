/**
 * GHANDI MOVIES — frontend
 * ------------------------
 * Reads the pre-generated movies.json (built by the GitHub Actions
 * workflow) and renders everything client-side. This file never calls
 * the OMDb API and never needs an API key.
 *
 * Security note: every value that comes from movies.json (title, plot,
 * cast, poster URL, imdbID, etc.) is treated as untrusted. All of it is
 * inserted into the page using DOM APIs (createElement/textContent)
 * rather than HTML strings, so it can never be interpreted as markup or
 * script — including inside attributes, where naive escaping can still
 * be unsafe (e.g. an inline event-handler attribute gets HTML-decoded
 * before it runs as JavaScript). Poster and IMDb links are additionally
 * restricted to http(s) URLs before ever being used as src/href.
 */

(function () {
  "use strict";

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
    overlay: document.getElementById("detail-overlay"),
    detailBody: document.getElementById("detail-body"),
    detailClose: document.getElementById("detail-close"),
  };

  let allMovies = []; // successfully-fetched movies, in movies.txt order
  let failedMovies = []; // movies OMDb couldn't resolve

/* ---------------- theme ---------------- */

function initTheme() {
  const saved = localStorage.getItem("theme");
  const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("theme", next);
}

// این رو قبل از init() صدا بزن:
initTheme();
  
  init();

  async function init() {
    let data;
    try {
      const res = await fetch("movies.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      showLoadFailure(err);
      return;
    }

    if (!data || typeof data !== "object" || !Array.isArray(data.movies)) {
      showLoadFailure(new Error("movies.json has an unexpected shape"));
      return;
    }

    const movies = data.movies;
    allMovies = movies.filter((m) => m && m.ok).map(normalizeFrontendMovie);
    failedMovies = movies.filter((m) => m && !m.ok).map(normalizeFailedMovie);

    allMovies.forEach((m, i) => (m._order = i));

    renderStats(data);
    populateFilters();
    bindControls();
    function bindControls() {
  [els.sort, els.genre, els.year, els.rating].forEach((elm) =>
    elm.addEventListener("change", applyAndRender)
  );

  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  els.detailClose.addEventListener("click", closeDetail);
  // ... بقیه
}
    applyAndRender();
  }

  function showLoadFailure(err) {
    els.stats.textContent = "";
    els.empty.hidden = false;
    els.emptyMessage.textContent =
      "movies.json couldn't be loaded. If you just deployed, run the update workflow once in the Actions tab.";
    console.error("Failed to load movies.json:", err);
  }

  /* ---------------- defensive normalization ---------------- */

  // One malformed entry in movies.json should never break the whole page.
  function normalizeFrontendMovie(m) {
    return {
      queriedTitle: typeof m.queriedTitle === "string" ? m.queriedTitle : "Untitled",
      title: typeof m.title === "string" && m.title ? m.title : (typeof m.queriedTitle === "string" ? m.queriedTitle : "Untitled"),
      year: typeof m.year === "number" && Number.isFinite(m.year) ? m.year : null,
      imdbID: typeof m.imdbID === "string" ? m.imdbID : null,
      imdbRating: typeof m.imdbRating === "number" && Number.isFinite(m.imdbRating) ? m.imdbRating : null,
      poster: typeof m.poster === "string" ? m.poster : null,
      genres: Array.isArray(m.genres) ? m.genres.filter((g) => typeof g === "string") : [],
      cast: Array.isArray(m.cast) ? m.cast.filter((c) => typeof c === "string") : [],
      director: typeof m.director === "string" ? m.director : null,
      runtimeMinutes: typeof m.runtimeMinutes === "number" && Number.isFinite(m.runtimeMinutes) ? m.runtimeMinutes : null,
      plot: typeof m.plot === "string" ? m.plot : null,
      rated: typeof m.rated === "string" ? m.rated : null,
    };
  }

  function normalizeFailedMovie(m) {
    return {
      queriedTitle: typeof m.queriedTitle === "string" && m.queriedTitle ? m.queriedTitle : "Untitled",
      error: typeof m.error === "string" ? m.error : "unknown",
      message: typeof m.message === "string" ? m.message : "Could not load this title",
    };
  }

  // Only ever treat plain http(s) URLs as usable — blocks javascript:,
  // data:, or any other scheme from ever reaching a src/href attribute.
  function isHttpUrl(str) {
    if (typeof str !== "string" || str.length === 0) return false;
    try {
      const u = new URL(str);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  /* ---------------- small DOM-building helper ---------------- */

  function el(tag, { className, text, attrs, children } = {}) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    if (attrs) {
      for (const [key, value] of Object.entries(attrs)) {
        if (value !== null && value !== undefined) node.setAttribute(key, value);
      }
    }
    if (children) children.forEach((child) => child && node.appendChild(child));
    return node;
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
        el("div", {
          className: "stat",
          children: [
            el("span", { className: s.accent ? "stat-value accent" : "stat-value", text: s.value }),
            el("span", { className: "stat-label", text: s.label }),
          ],
        })
      );
    });

    if (data.generatedAt) {
      const when = new Date(data.generatedAt);
      if (!isNaN(when)) {
        els.stats.appendChild(
          el("div", {
            className: "stat",
            children: [
              el("span", { className: "stat-value", text: when.toLocaleDateString() }),
              el("span", { className: "stat-label", text: "Last updated" }),
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
    select.appendChild(el("option", { text: allLabel, attrs: { value: allValue } }));
    values.forEach((v) => {
      select.appendChild(el("option", { text: String(v), attrs: { value: String(v) } }));
    });
    if (Array.from(select.options).some((o) => o.value === current)) {
      select.value = current;
    }
  }

  function bindControls() {
    [els.sort, els.genre, els.year, els.rating].forEach((elm) =>
      elm.addEventListener("change", applyAndRender)
    );

    els.detailClose.addEventListener("click", closeDetail);
    els.overlay.addEventListener("click", (e) => {
      if (e.target === els.overlay) closeDetail();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDetail();
    });
  }

  /* ---------------- filter + sort + render ---------------- */

  function applyAndRender() {
    const genre = els.genre.value;
    const year = els.year.value;
    const minRating = parseFloat(els.rating.value);
    const sortMode = els.sort.value;

    let list = allMovies.filter((m) => {
      if (genre !== "all" && !m.genres.includes(genre)) return false;
      if (year !== "all" && String(m.year) !== year) return false;
      if (minRating > 0 && !(typeof m.imdbRating === "number" && m.imdbRating >= minRating)) return false;
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

    list.forEach((m) => {
      try {
        els.grid.appendChild(buildMovieCard(m));
      } catch (err) {
        // One malformed entry should never take down the whole grid.
        console.error("Skipped a movie card that failed to render:", err);
      }
    });

    failedMovies.forEach((m) => {
      try {
        els.grid.appendChild(buildErrorCard(m));
      } catch (err) {
        console.error("Skipped an error card that failed to render:", err);
      }
    });
  }

  function buildPoster(m) {
    if (isHttpUrl(m.poster)) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = `${m.title} poster`;
      img.addEventListener(
        "error",
        () => {
          if (img.parentElement) {
            img.replaceWith(el("div", { className: "poster-placeholder", text: m.title }));
          }
        },
        { once: true }
      );
      img.src = m.poster;
      return img;
    }
    return el("div", { className: "poster-placeholder", text: m.title });
  }

  function buildMovieCard(m) {
    const posterWrap = el("div", { className: "poster-wrap" });
    posterWrap.appendChild(buildPoster(m));

    if (typeof m.imdbRating === "number") {
      posterWrap.appendChild(el("div", { className: "rating-badge", text: `★ ${m.imdbRating.toFixed(1)}` }));
    }

    const cast = m.cast.slice(0, 3).join(", ");
    posterWrap.appendChild(
      el("div", {
        className: "card-overlay",
        children: [el("p", { className: "overlay-cast", text: cast || "Cast unavailable" })],
      })
    );

    const subline = el("p", { className: "card-subline" });
    subline.appendChild(el("span", { text: m.year !== null ? String(m.year) : "—" }));
    const genres = m.genres.slice(0, 2).join(", ");
    if (genres) subline.appendChild(el("span", { text: `· ${genres}` }));

    const meta = el("div", {
      className: "card-meta",
      children: [el("h3", { className: "card-title", text: m.title }), subline],
    });

    const card = el("article", {
      className: "movie-card",
      attrs: {
        tabindex: "0",
        role: "button",
        "aria-label": `View details for ${m.title}`,
      },
      children: [posterWrap, meta],
    });

    card.addEventListener("click", () => openDetail(m));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(m);
      }
    });

    return card;
  }

  function buildErrorCard(m) {
    const reason =
      m.error === "invalid_api_key"
        ? "API key issue"
        : m.error === "rate_limited"
        ? "Rate limited"
        : m.error === "network_error" || m.error === "http_error" || m.error === "timeout" || m.error === "malformed_response"
        ? "Network error"
        : "Not found";

    const posterWrap = el("div", {
      className: "poster-wrap",
      children: [el("div", { className: "poster-placeholder", text: reason })],
    });

    const meta = el("div", {
      className: "card-meta",
      children: [
        el("h3", { className: "card-title", text: m.queriedTitle }),
        el("p", { className: "card-subline", children: [el("span", { text: m.message })] }),
      ],
    });

    return el("article", {
      className: "movie-card error-card",
      attrs: { "aria-label": `${m.queriedTitle}: ${reason}` },
      children: [posterWrap, meta],
    });
  }

  /* ---------------- detail overlay ---------------- */

  function openDetail(m) {
    if (!m) return;

    els.detailBody.textContent = "";

    const posterEl = isHttpUrl(m.poster)
      ? (() => {
          const img = document.createElement("img");
          img.src = m.poster;
          img.alt = `${m.title} poster`;
          return img;
        })()
      : el("div", { className: "poster-placeholder", text: m.title, attrs: { style: "aspect-ratio:2/3;" } });

    const right = document.createElement("div");
    right.appendChild(el("h2", { text: m.title, attrs: { id: "detail-title" } }));

    const facts = el("p", { className: "detail-facts" });
    facts.appendChild(el("span", { text: m.year !== null ? String(m.year) : "—" }));
    if (m.runtimeMinutes) facts.appendChild(el("span", { text: `${m.runtimeMinutes} min` }));
    if (m.rated) facts.appendChild(el("span", { text: m.rated }));
    if (typeof m.imdbRating === "number") facts.appendChild(el("span", { text: `★ ${m.imdbRating.toFixed(1)} IMDb` }));
    right.appendChild(facts);

    if (m.plot) right.appendChild(el("p", { className: "detail-plot", text: m.plot }));

    if (m.director) {
      const p = el("p", { className: "detail-row" });
      p.appendChild(el("span", { text: "Director: " }));
      p.appendChild(document.createTextNode(m.director));
      right.appendChild(p);
    }

    if (m.cast.length) {
      const p = el("p", { className: "detail-row" });
      p.appendChild(el("span", { text: "Cast: " }));
      p.appendChild(document.createTextNode(m.cast.join(", ")));
      right.appendChild(p);
    }

    if (m.genres.length) {
      const p = el("p", { className: "detail-row" });
      p.appendChild(el("span", { text: "Genre: " }));
      p.appendChild(document.createTextNode(m.genres.join(", ")));
      right.appendChild(p);
    }

    // imdbID should always look like "tt1234567" — constrain it before
    // ever using it to build a URL, as defense in depth.
    if (m.imdbID && /^[a-zA-Z0-9]+$/.test(m.imdbID)) {
      const p = document.createElement("p");
      p.className = "detail-row";
      const a = document.createElement("a");
      a.href = `https://www.imdb.com/title/${encodeURIComponent(m.imdbID)}/`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View on IMDb";
      p.appendChild(a);
      right.appendChild(p);
    }

    els.detailBody.appendChild(posterEl);
    els.detailBody.appendChild(right);

    els.overlay.hidden = false;
    els.detailClose.focus();
  }

  function closeDetail() {
    els.overlay.hidden = true;
    els.detailBody.textContent = "";
  }
})();
