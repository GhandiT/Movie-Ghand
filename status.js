/**
 * GHANDI MOVIES — My Status
 * -------------------------
 * All statistics here are calculated live from movies.json — nothing is
 * hardcoded. See common.js for the shared stats helpers, card builders,
 * and the keyless Wikidata-based favorite-actor/actress lookup.
 */

(function () {
  "use strict";

  const C = window.Common;

  const els = {
    loading: document.getElementById("status-loading"),
    empty: document.getElementById("status-empty"),
    content: document.getElementById("status-content"),
    bestMovieBody: document.getElementById("best-movie-body"),
    favoriteActorBody: document.getElementById("favorite-actor-body"),
    favoriteActressBody: document.getElementById("favorite-actress-body"),
    genreValue: document.getElementById("favorite-genre-value"),
    genreScroller: document.getElementById("favorite-genre-scroller"),
    yearValue: document.getElementById("favorite-year-value"),
    yearScroller: document.getElementById("favorite-year-scroller"),
    genreChart: document.getElementById("genre-chart"),
  };

  init();

  async function init() {
    const result = await C.loadJson("movies.json");

    if (!result.ok || !result.data || !Array.isArray(result.data.movies)) {
      showEmpty("movies.json couldn't be loaded. Run the update workflow, then reload this page.");
      return;
    }

    const allMovies = result.data.movies.filter((m) => m && m.ok).map(C.normalizeFrontendMovie);

    if (allMovies.length === 0) {
      showEmpty();
      return;
    }

    els.loading.hidden = true;
    els.content.hidden = false;

    renderBestMovie(allMovies);
    renderFavoriteGenre(allMovies);
    renderFavoriteYear(allMovies);
    renderGenreChart(allMovies);
    renderFavoritePeople(allMovies); // async, doesn't block the rest of the page
  }

  function showEmpty(message) {
    els.loading.hidden = true;
    els.empty.hidden = false;
    if (message) els.empty.querySelector("p").textContent = message;
  }

  /* ---------------- poster tile (lighter than a full movie card) ---------------- */

  function buildPosterTile(m) {
    const tile = C.el("button", {
      className: "poster-tile",
      attrs: { type: "button", "aria-label": `View details for ${m.title}` },
    });
    tile.appendChild(C.buildPoster(m));
    tile.addEventListener("click", () => C.openMovieDetail(m));
    return tile;
  }

  /* ---------------- Best Movie ---------------- */

  function renderBestMovie(movies) {
    const { best, tiedCount } = C.getBestMovies(movies);
    els.bestMovieBody.textContent = "";

    if (!best) {
      els.bestMovieBody.appendChild(C.el("p", { className: "status-muted", text: "No rated movies yet." }));
      return;
    }

    const posterWrap = C.el("div", { className: "best-movie-poster" });
    posterWrap.appendChild(C.buildPoster(best));

    const info = C.el("div", { className: "best-movie-info" });
    info.appendChild(C.el("h3", { text: best.title }));
    const facts = C.el("p", { className: "best-movie-facts" });
    facts.appendChild(C.el("span", { className: "best-movie-rating", text: `★ ${best.imdbRating.toFixed(1)}` }));
    if (best.year !== null) facts.appendChild(C.el("span", { text: String(best.year) }));
    info.appendChild(facts);
    if (tiedCount > 1) {
      info.appendChild(
        C.el("p", {
          className: "status-muted",
          text: `Tied with ${tiedCount - 1} other movie${tiedCount - 1 === 1 ? "" : "s"} at ${best.imdbRating.toFixed(1)} — shown alphabetically.`,
        })
      );
    }

    const card = C.el("button", { className: "best-movie-card", attrs: { type: "button" } });
    card.appendChild(posterWrap);
    card.appendChild(info);
    card.addEventListener("click", () => C.openMovieDetail(best));

    els.bestMovieBody.appendChild(card);
  }

  /* ---------------- Favorite Genre / Year (poster strips) ---------------- */

  function renderFavoriteGenre(movies) {
    const result = C.getFavoriteGenre(movies);
    if (!result) {
      els.genreValue.textContent = "—";
      return;
    }
    els.genreValue.textContent = `${result.genre} · ${result.count} movie${result.count === 1 ? "" : "s"}`;
    els.genreScroller.textContent = "";
    result.movies.forEach((m) => els.genreScroller.appendChild(buildPosterTile(m)));
  }

  function renderFavoriteYear(movies) {
    const result = C.getFavoriteYear(movies);
    if (!result) {
      els.yearValue.textContent = "—";
      return;
    }
    els.yearValue.textContent = `${result.year} · ${result.count} movie${result.count === 1 ? "" : "s"}`;
    els.yearScroller.textContent = "";
    result.movies.forEach((m) => els.yearScroller.appendChild(buildPosterTile(m)));
  }

  /* ---------------- Genre chart (lightweight, no library) ---------------- */

  function renderGenreChart(movies) {
    const distribution = C.getGenreDistribution(movies, { maxSlices: 8 });
    els.genreChart.textContent = "";

    if (!distribution.length) {
      els.genreChart.appendChild(C.el("p", { className: "status-muted", text: "No genre data yet." }));
      return;
    }

    const list = C.el("ul", { className: "genre-chart-list" });
    distribution.forEach((slice) => {
      const row = C.el("li", { className: "genre-chart-row" });
      row.appendChild(C.el("span", { className: "genre-chart-label", text: slice.genre }));

      const track = C.el("span", { className: "genre-chart-track" });
      const bar = C.el("span", {
        className: "genre-chart-bar",
        attrs: { style: `width: ${slice.pct.toFixed(1)}%` },
      });
      track.appendChild(bar);
      row.appendChild(track);

      row.appendChild(C.el("span", { className: "genre-chart-pct", text: `${slice.pct.toFixed(0)}%` }));
      list.appendChild(row);
    });

    els.genreChart.appendChild(list);
  }

  /* ---------------- Favorite Actor / Actress ---------------- */

  async function renderFavoritePeople(movies) {
    renderPersonLoading(els.favoriteActorBody);
    renderPersonLoading(els.favoriteActressBody);

    const [actor, actress] = await Promise.all([
      C.getFavoritePerson(movies, "male").catch(() => null),
      C.getFavoritePerson(movies, "female").catch(() => null),
    ]);

    renderPerson(els.favoriteActorBody, actor, "No favorite actor found yet.");
    renderPerson(els.favoriteActressBody, actress, "No favorite actress found yet.");
  }

  function renderPersonLoading(container) {
    container.textContent = "";
    container.appendChild(C.el("p", { className: "status-muted", text: "Looking this up…" }));
  }

  function renderPerson(container, person, emptyMessage) {
    container.textContent = "";

    if (!person) {
      container.appendChild(C.el("p", { className: "status-muted", text: emptyMessage }));
      return;
    }

    const portraitWrap = C.el("div", { className: "person-portrait" });
    if (C.isHttpUrl(person.imageUrl)) {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = person.name;
      img.addEventListener(
        "error",
        () => {
          if (img.parentElement) {
            img.replaceWith(C.el("div", { className: "person-portrait-placeholder", text: initials(person.name) }));
          }
        },
        { once: true }
      );
      img.src = person.imageUrl;
      portraitWrap.appendChild(img);
    } else {
      portraitWrap.appendChild(C.el("div", { className: "person-portrait-placeholder", text: initials(person.name) }));
    }

    container.appendChild(portraitWrap);
    container.appendChild(C.el("p", { className: "person-name", text: person.name }));
    if (person.stale) {
      container.appendChild(
        C.el("p", { className: "status-muted status-muted-small", text: "Showing a cached result — the lookup service was unavailable." })
      );
    }
  }

  function initials(name) {
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join("");
  }
})();
