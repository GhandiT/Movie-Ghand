/**
 * GHANDI MOVIES — Collection
 * ---------------------------
 * Reads the pre-generated collections.json (built from collections.txt
 * by the GitHub Actions workflow — see scripts/fetch-collections.js).
 * Each collection's movies already arrive sorted by release year; we
 * re-sort defensively on the client too in case that ever changes.
 */

(function () {
  "use strict";

  const C = window.Common;

  const els = {
    pickerSection: document.getElementById("collection-picker"),
    pickerIntro: document.getElementById("collection-select-intro"),
    grid: document.getElementById("collection-grid"),
    empty: document.getElementById("empty-state"),
    detailSection: document.getElementById("collection-detail"),
    detailTitle: document.getElementById("collection-detail-title"),
    detailCount: document.getElementById("collection-detail-count"),
    detailGrid: document.getElementById("collection-movie-grid"),
    backBtn: document.getElementById("collection-back"),
  };

  let collections = [];

  init();

  async function init() {
    const result = await C.loadJson("collections.json");

    if (!result.ok || !result.data || !Array.isArray(result.data.collections)) {
      els.empty.hidden = false;
      els.empty.querySelector("p").textContent =
        "collections.json couldn't be loaded. Run the update workflow, then reload this page.";
      return;
    }

    collections = result.data.collections
      .filter((c) => c && typeof c.name === "string" && Array.isArray(c.movies))
      .map((c) => ({
        name: c.name,
        slug: slugify(c.name),
        okMovies: c.movies.filter((m) => m && m.ok).map(C.normalizeFrontendMovie),
        failedMovies: c.movies.filter((m) => m && !m.ok).map(C.normalizeFailedMovie),
      }));

    if (collections.length === 0) {
      els.empty.hidden = false;
      return;
    }

    renderPicker();
    els.backBtn.addEventListener("click", () => showPicker());

    // Deep-link support: #collection-slug opens straight to that collection.
    const hashSlug = (window.location.hash || "").replace(/^#/, "");
    const match = collections.find((c) => c.slug === hashSlug);
    if (match) {
      showDetail(match, { updateHash: false });
    }
  }

  function slugify(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function renderPicker() {
    els.grid.textContent = "";
    collections.forEach((c) => {
      const coverMovie = c.okMovies.find((m) => C.isHttpUrl(m.poster)) || c.okMovies[0] || null;

      const cover = C.el("div", { className: "collection-cover" });
      if (coverMovie) {
        cover.appendChild(C.buildPoster(coverMovie));
      } else {
        cover.appendChild(C.el("div", { className: "poster-placeholder", text: c.name }));
      }

      const total = c.okMovies.length + c.failedMovies.length;
      const card = C.el("button", {
        className: "collection-card",
        attrs: { type: "button", "aria-label": `Open the ${c.name} collection` },
        children: [
          cover,
          C.el("div", {
            className: "collection-card-meta",
            children: [
              C.el("h3", { text: c.name }),
              C.el("p", { text: `${total} movie${total === 1 ? "" : "s"}` }),
            ],
          }),
        ],
      });

      card.addEventListener("click", () => showDetail(c));
      els.grid.appendChild(card);
    });
  }

  function showDetail(collection, { updateHash = true } = {}) {
    els.pickerSection.hidden = true;
    els.pickerIntro.hidden = true;
    els.detailSection.hidden = false;

    els.detailTitle.textContent = collection.name;
    const total = collection.okMovies.length + collection.failedMovies.length;
    const failedNote = collection.failedMovies.length
      ? ` · ${collection.failedMovies.length} couldn't be found`
      : "";
    els.detailCount.textContent = `${total} movie${total === 1 ? "" : "s"}, oldest to newest${failedNote}`;

    els.detailGrid.textContent = "";

    const sorted = [...collection.okMovies].sort((a, b) => {
      const ay = typeof a.year === "number" ? a.year : Infinity;
      const by = typeof b.year === "number" ? b.year : Infinity;
      return ay - by;
    });

    sorted.forEach((m, i) => {
      try {
        const card = C.buildMovieCard(m);
        card.style.animationDelay = `${Math.min(i * 0.02, 0.5)}s`;
        els.detailGrid.appendChild(card);
      } catch (err) {
        console.error("Skipped a collection card that failed to render:", err);
      }
    });

    collection.failedMovies.forEach((m) => {
      try {
        els.detailGrid.appendChild(C.buildErrorCard(m));
      } catch (err) {
        console.error("Skipped a collection error card that failed to render:", err);
      }
    });

    if (updateHash) {
      history.replaceState(null, "", `#${collection.slug}`);
    }

    if (typeof els.detailSection.scrollIntoView === "function") {
      els.detailSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function showPicker() {
    els.detailSection.hidden = true;
    els.pickerSection.hidden = false;
    els.pickerIntro.hidden = false;
    history.replaceState(null, "", window.location.pathname + window.location.search);
  }
})();
