/**
 * GHANDI MOVIES — shared frontend library
 * ----------------------------------------
 * Loaded by every page (before that page's own small script). Provides:
 *   - theme toggle, back-to-top, hamburger menu (auto-wired on load)
 *   - safe DOM-building helpers (no innerHTML with untrusted data — see
 *     the note in openMovieDetail/buildMovieCard below)
 *   - a generic movie-card / detail-overlay renderer reused by every
 *     page that shows movies (Home, Watchlist, Collection, Random,
 *     My Status posters)
 *   - statistics helpers (best movie, favorite genre/year, genre
 *     distribution) that work on any array of normalized movie objects
 *   - a keyless, cache-aware "favorite person" lookup (see the Actor
 *     Service section) used only by the My Status page
 *
 * Security note: every value that ultimately comes from movies.json /
 * watchlist.json / collections.json / Watchlist.txt / collections.txt /
 * OMDb / the actor service is treated as untrusted. It is written into
 * the page using DOM APIs (createElement/textContent) rather than HTML
 * strings, so it can never be interpreted as markup or script — this
 * matters even inside attributes, where naive string-escaping can still
 * be unsafe. Poster/person-image/IMDb URLs are additionally restricted
 * to http(s) before ever being used as a src/href.
 */

window.Common = (function () {
  "use strict";

  /* ================================================================
     DOM helpers
     ================================================================ */

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

  /* ================================================================
     THEME / BACK-TO-TOP / HAMBURGER MENU
     Auto-wired for any page that includes the matching markup. Every
     lookup is defensive (checks the element exists) so a page missing
     one piece (e.g. About & Credits has no back-to-top button) never
     throws.
     ================================================================ */

  function initTheme() {
    const toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    toggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "dark";
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* ignore — theme just won't persist */
      }
    });
  }

  function initBackToTop() {
    const btn = document.getElementById("back-to-top");
    if (!btn) return;

    window.addEventListener(
      "scroll",
      () => {
        btn.hidden = window.scrollY < 400;
      },
      { passive: true }
    );

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function initHamburgerMenu() {
    const toggle = document.getElementById("hamburger-toggle");
    const drawer = document.getElementById("nav-drawer");
    if (!toggle || !drawer) return;

    const closeBtn = document.getElementById("nav-drawer-close");
    const backdrop = document.getElementById("nav-drawer-backdrop");

    function isOpen() {
      return drawer.getAttribute("data-open") === "true";
    }

    function openDrawer() {
      drawer.setAttribute("data-open", "true");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("nav-open");
      const firstLink = drawer.querySelector("a");
      if (firstLink) firstLink.focus();
    }

    function closeDrawer({ refocusToggle = true } = {}) {
      drawer.setAttribute("data-open", "false");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("nav-open");
      if (refocusToggle) toggle.focus();
    }

    toggle.addEventListener("click", () => {
      isOpen() ? closeDrawer() : openDrawer();
    });

    if (closeBtn) closeBtn.addEventListener("click", () => closeDrawer());
    if (backdrop) backdrop.addEventListener("click", () => closeDrawer({ refocusToggle: false }));

    // Close after selecting a page — the click still navigates normally.
    drawer.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", () => closeDrawer({ refocusToggle: false }));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) closeDrawer();
    });

    // Click outside the drawer/backdrop area closes it.
    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      if (drawer.contains(e.target) || toggle.contains(e.target)) return;
      closeDrawer({ refocusToggle: false });
    });
  }

  /* ================================================================
     Movie data normalization (defensive — one bad entry from a JSON
     file should never break a whole page)
     ================================================================ */

  function normalizeFrontendMovie(m) {
    return {
      queriedTitle: typeof m.queriedTitle === "string" ? m.queriedTitle : "Untitled",
      title:
        typeof m.title === "string" && m.title
          ? m.title
          : typeof m.queriedTitle === "string"
          ? m.queriedTitle
          : "Untitled",
      year: typeof m.year === "number" && Number.isFinite(m.year) ? m.year : null,
      imdbID: typeof m.imdbID === "string" ? m.imdbID : null,
      imdbRating: typeof m.imdbRating === "number" && Number.isFinite(m.imdbRating) ? m.imdbRating : null,
      poster: typeof m.poster === "string" ? m.poster : null,
      genres: Array.isArray(m.genres) ? m.genres.filter((g) => typeof g === "string") : [],
      cast: Array.isArray(m.cast) ? m.cast.filter((c) => typeof c === "string") : [],
      director: typeof m.director === "string" ? m.director : null,
      runtimeMinutes:
        typeof m.runtimeMinutes === "number" && Number.isFinite(m.runtimeMinutes) ? m.runtimeMinutes : null,
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

  // Fetches and parses one of the generated JSON files (movies.json,
  // watchlist.json, collections.json). Uses a relative path and
  // cache:"no-store" so a freshly-updated file is always picked up.
  // Returns { ok: true, data } or { ok: false, error }.
  async function loadJson(relativePath) {
    try {
      const res = await fetch(relativePath, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err };
    }
  }

  /* ================================================================
     Generic movie card / detail overlay
     Reused by Home, Watchlist, Collection, Random, and My Status.
     ================================================================ */

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

  function buildMovieCard(m, { onOpen } = {}) {
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
      attrs: { tabindex: "0", role: "button", "aria-label": `View details for ${m.title}` },
      children: [posterWrap, meta],
    });

    const open = onOpen || openMovieDetail;
    card.addEventListener("click", () => open(m));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(m);
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
        : m.error === "network_error" ||
          m.error === "http_error" ||
          m.error === "timeout" ||
          m.error === "malformed_response"
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

  function initDetailOverlay() {
    const overlay = document.getElementById("detail-overlay");
    const closeBtn = document.getElementById("detail-close");
    if (!overlay || !closeBtn) return;

    closeBtn.addEventListener("click", closeMovieDetail);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeMovieDetail();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !overlay.hidden) closeMovieDetail();
    });
  }

  function openMovieDetail(m) {
    if (!m) return;
    const overlay = document.getElementById("detail-overlay");
    const body = document.getElementById("detail-body");
    const closeBtn = document.getElementById("detail-close");
    if (!overlay || !body) return;

    body.textContent = "";

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
    if (typeof m.imdbRating === "number")
      facts.appendChild(el("span", { text: `★ ${m.imdbRating.toFixed(1)} IMDb` }));
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

    body.appendChild(posterEl);
    body.appendChild(right);

    overlay.hidden = false;
    if (closeBtn) closeBtn.focus();
  }

  function closeMovieDetail() {
    const overlay = document.getElementById("detail-overlay");
    const body = document.getElementById("detail-body");
    if (!overlay) return;
    overlay.hidden = true;
    if (body) body.textContent = "";
  }

  /* ================================================================
     Statistics helpers
     Operate on an array of normalized, successful movie objects.
     Ties are handled deterministically (never randomly): the
     alphabetically-first title wins a rating tie; the
     alphabetically-first genre/year wins a count tie.
     ================================================================ */

  function getBestMovies(movies) {
    const rated = movies.filter((m) => typeof m.imdbRating === "number");
    if (!rated.length) return { best: null, tiedCount: 0 };
    const maxRating = Math.max(...rated.map((m) => m.imdbRating));
    const tied = rated.filter((m) => m.imdbRating === maxRating).sort((a, b) => a.title.localeCompare(b.title));
    return { best: tied[0], tiedCount: tied.length };
  }

  function getFavoriteGenre(movies) {
    const counts = new Map();
    movies.forEach((m) => (m.genres || []).forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
    if (!counts.size) return null;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [genre, count] = sorted[0];
    const inGenre = movies
      .filter((m) => (m.genres || []).includes(genre))
      .sort((a, b) => (b.imdbRating ?? -1) - (a.imdbRating ?? -1));
    return { genre, count, movies: inGenre };
  }

  function getFavoriteYear(movies) {
    const counts = new Map();
    movies.forEach((m) => {
      if (typeof m.year === "number") counts.set(m.year, (counts.get(m.year) || 0) + 1);
    });
    if (!counts.size) return null;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const [year, count] = sorted[0];
    const inYear = movies.filter((m) => m.year === year).sort((a, b) => (b.imdbRating ?? -1) - (a.imdbRating ?? -1));
    return { year, count, movies: inYear };
  }

  // Top `maxSlices` genres by count, with any remainder collapsed into
  // an "Other" slice so the chart stays readable even with dozens of
  // genres.
  function getGenreDistribution(movies, { maxSlices = 8 } = {}) {
    const counts = new Map();
    let totalTags = 0;
    movies.forEach((m) =>
      (m.genres || []).forEach((g) => {
        counts.set(g, (counts.get(g) || 0) + 1);
        totalTags++;
      })
    );
    if (!totalTags) return [];

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const top = sorted.slice(0, maxSlices);
    const rest = sorted.slice(maxSlices);
    const restTotal = rest.reduce((sum, [, c]) => sum + c, 0);

    const slices = top.map(([genre, count]) => ({ genre, count, pct: (count / totalTags) * 100 }));
    if (restTotal > 0) {
      slices.push({ genre: "Other", count: restTotal, pct: (restTotal / totalTags) * 100 });
    }
    return slices;
  }

  function tallyActors(movies) {
    const counts = new Map();
    movies.forEach((m) =>
      (m.cast || []).forEach((name) => {
        const key = name.trim();
        if (!key) return;
        counts.set(key, (counts.get(key) || 0) + 1);
      })
    );
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }

  /* ================================================================
     Actor / actress service
     ------------------------------------------------------------------
     Service: Wikidata's public action API (www.wikidata.org/w/api.php),
     called with origin=* for anonymous CORS access. No API key, no
     account, no rate-limit registration — see README / About page for
     the full writeup of why this was chosen over a keyed service like
     TheMovieDB.
     We look up, at most, a handful of the most-frequent cast names
     (already computed locally from data we already have) until we find
     one Wikidata tags as male (for Favorite Actor) or female (for
     Favorite Actress) via the P21 ("sex or gender") property, and reuse
     that person's P18 ("image") Commons file as a small thumbnail via
     Special:FilePath — never downloading a full-resolution image.
     Results are cached in localStorage and only re-queried if the
     underlying top-10 actor tally actually changes.
     ================================================================ */

  const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
  const ACTOR_CACHE_KEY = "ghandi-movies:favorite-people:v1";
  const MAX_CANDIDATE_LOOKUPS = 10;

  function readActorCache() {
    try {
      const raw = localStorage.getItem(ACTOR_CACHE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function writeActorCache(data) {
    try {
      localStorage.setItem(ACTOR_CACHE_KEY, JSON.stringify(data));
    } catch {
      /* localStorage unavailable/full — just skip caching this run */
    }
  }

  async function wikidataFetch(params, timeoutMs = 8000) {
    const url = `${WIKIDATA_API}?${params.toString()}&format=json&origin=*`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`Wikidata HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function wikidataSearchPersonId(name) {
    const params = new URLSearchParams({
      action: "wbsearchentities",
      search: name,
      language: "en",
      type: "item",
      limit: "1",
    });
    const data = await wikidataFetch(params);
    const hit = (data.search || [])[0];
    return hit ? hit.id : null;
  }

  async function wikidataGetPersonInfo(qid) {
    const params = new URLSearchParams({
      action: "wbgetclaims",
      entity: qid,
      property: "P21|P18",
    });
    const data = await wikidataFetch(params);
    const claims = data.claims || {};

    let gender = null;
    const genderClaim = claims.P21 && claims.P21[0] && claims.P21[0].mainsnak && claims.P21[0].mainsnak.datavalue;
    if (genderClaim && genderClaim.value && genderClaim.value.id === "Q6581097") gender = "male";
    if (genderClaim && genderClaim.value && genderClaim.value.id === "Q6581072") gender = "female";

    let imageUrl = null;
    const imageClaim = claims.P18 && claims.P18[0] && claims.P18[0].mainsnak && claims.P18[0].mainsnak.datavalue;
    if (imageClaim && typeof imageClaim.value === "string") {
      imageUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
        imageClaim.value
      )}?width=300`;
    }

    return { gender, imageUrl };
  }

  async function findFavoritePerson(sortedActorCounts, targetGender) {
    const limit = Math.min(MAX_CANDIDATE_LOOKUPS, sortedActorCounts.length);
    for (let i = 0; i < limit; i++) {
      const name = sortedActorCounts[i][0];
      try {
        const qid = await wikidataSearchPersonId(name);
        if (!qid) continue;
        const info = await wikidataGetPersonInfo(qid);
        if (info.gender === targetGender) {
          return { name, imageUrl: info.imageUrl };
        }
      } catch (err) {
        console.warn(`Wikidata lookup failed for "${name}":`, err);
        // Try the next candidate rather than failing the whole feature.
      }
    }
    return null;
  }

  // targetGender: "male" | "female". Returns
  // { name, imageUrl, fromCache, stale } or null if nothing could be
  // determined (no cast data, and the lookup found no match / failed).
  async function getFavoritePerson(movies, targetGender) {
    const counts = tallyActors(movies);
    if (!counts.length) return null;

    const fingerprint = counts
      .slice(0, MAX_CANDIDATE_LOOKUPS)
      .map(([name, c]) => `${name}:${c}`)
      .join("|");

    const cache = readActorCache();
    const cached = cache[targetGender];
    if (cached && cached.fingerprint === fingerprint) {
      return { name: cached.name, imageUrl: cached.imageUrl, fromCache: true, stale: false };
    }

    try {
      const result = await findFavoritePerson(counts, targetGender);
      if (result) {
        cache[targetGender] = { fingerprint, name: result.name, imageUrl: result.imageUrl, computedAt: Date.now() };
        writeActorCache(cache);
        return { name: result.name, imageUrl: result.imageUrl, fromCache: false, stale: false };
      }
    } catch (err) {
      console.warn("Favorite-person lookup failed:", err);
    }

    // Lookup failed or found no match this time — fall back to a stale
    // cached value rather than showing nothing, if one exists.
    if (cached) return { name: cached.name, imageUrl: cached.imageUrl, fromCache: true, stale: true };
    return null;
  }

  /* ================================================================
     Auto-init on load
     ================================================================ */

  document.addEventListener("DOMContentLoaded", () => {
    initTheme();
    initBackToTop();
    initHamburgerMenu();
    initDetailOverlay();
  });

  return {
    el,
    isHttpUrl,
    normalizeFrontendMovie,
    normalizeFailedMovie,
    loadJson,
    buildPoster,
    buildMovieCard,
    buildErrorCard,
    openMovieDetail,
    closeMovieDetail,
    getBestMovies,
    getFavoriteGenre,
    getFavoriteYear,
    getGenreDistribution,
    tallyActors,
    getFavoritePerson,
  };
})();
