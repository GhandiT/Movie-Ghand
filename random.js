/**
 * GHANDI MOVIES — Pick a Random Movie
 * -------------------------------------
 * Reuses movies.json (already loaded for Home) — no extra API calls.
 * Only movies with an IMDb rating of 6.0 or higher are eligible. The
 * "searching" animation is a short, lightweight CSS-driven state; the
 * actual selection is instant (Math.random over an in-memory array).
 */

(function () {
  "use strict";

  const C = window.Common;
  const MIN_RATING = 6.0;
  const SEARCH_ANIMATION_MS = 650;

  const els = {
    stage: document.getElementById("random-stage"),
    button: document.getElementById("random-button"),
    status: document.getElementById("random-status"),
    result: document.getElementById("random-result"),
  };

  let eligible = [];
  let lastShownTitle = null;
  let busy = false;

  init();

  async function init() {
    const result = await C.loadJson("movies.json");

    if (!result.ok || !result.data || !Array.isArray(result.data.movies)) {
      setStatus("movies.json couldn't be loaded. Run the update workflow, then reload this page.");
      els.button.disabled = true;
      return;
    }

    eligible = result.data.movies
      .filter((m) => m && m.ok)
      .map(C.normalizeFrontendMovie)
      .filter((m) => typeof m.imdbRating === "number" && m.imdbRating >= MIN_RATING);

    if (eligible.length === 0) {
      setStatus(`No movies rated ${MIN_RATING.toFixed(1)} or higher yet — watch (and rate) a few more!`);
      els.button.disabled = true;
      return;
    }

    els.button.addEventListener("click", pickMovie);
  }

  function setStatus(text) {
    els.status.textContent = text;
  }

  function pickMovie() {
    if (busy) return;
    busy = true;
    els.button.disabled = true;
    els.button.classList.add("is-searching");
    setStatus("Searching the archive…");

    setTimeout(() => {
      const movie = choose();
      lastShownTitle = movie.title;
      renderResult(movie);
      els.button.classList.remove("is-searching");
      els.button.disabled = false;
      busy = false;
      setStatus("");
    }, SEARCH_ANIMATION_MS);
  }

  function choose() {
    if (eligible.length === 1) return eligible[0];
    // Avoid repeating the immediately-previous pick when other options exist.
    let candidates = eligible.filter((m) => m.title !== lastShownTitle);
    if (candidates.length === 0) candidates = eligible;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  function renderResult(m) {
    els.result.textContent = "";
    els.result.hidden = false;

    const posterWrap = C.el("div", { className: "random-result-poster" });
    posterWrap.appendChild(C.buildPoster(m));

    const info = C.el("div", { className: "random-result-info" });
    info.appendChild(C.el("h2", { text: m.title }));

    const facts = C.el("p", { className: "detail-facts" });
    facts.appendChild(C.el("span", { text: m.year !== null ? String(m.year) : "—" }));
    if (m.runtimeMinutes) facts.appendChild(C.el("span", { text: `${m.runtimeMinutes} min` }));
    if (m.rated) facts.appendChild(C.el("span", { text: m.rated }));
    facts.appendChild(C.el("span", { className: "best-movie-rating", text: `★ ${m.imdbRating.toFixed(1)} IMDb` }));
    info.appendChild(facts);

    if (m.plot) info.appendChild(C.el("p", { className: "detail-plot", text: m.plot }));

    if (m.director) {
      const p = C.el("p", { className: "detail-row" });
      p.appendChild(C.el("span", { text: "Director: " }));
      p.appendChild(document.createTextNode(m.director));
      info.appendChild(p);
    }
    if (m.cast.length) {
      const p = C.el("p", { className: "detail-row" });
      p.appendChild(C.el("span", { text: "Cast: " }));
      p.appendChild(document.createTextNode(m.cast.join(", ")));
      info.appendChild(p);
    }
    if (m.genres.length) {
      const p = C.el("p", { className: "detail-row" });
      p.appendChild(C.el("span", { text: "Genre: " }));
      p.appendChild(document.createTextNode(m.genres.join(", ")));
      info.appendChild(p);
    }
    if (m.imdbID && /^[a-zA-Z0-9]+$/.test(m.imdbID)) {
      const p = document.createElement("p");
      p.className = "detail-row";
      const a = document.createElement("a");
      a.href = `https://www.imdb.com/title/${encodeURIComponent(m.imdbID)}/`;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View on IMDb";
      p.appendChild(a);
      info.appendChild(p);
    }

    const againBtn = C.el("button", {
      className: "random-again-button",
      text: "PICK AGAIN",
      attrs: { type: "button" },
    });
    againBtn.addEventListener("click", pickMovie);
    info.appendChild(againBtn);

    const card = C.el("div", { className: "random-result-card", children: [posterWrap, info] });
    els.result.appendChild(card);
  }
})();
