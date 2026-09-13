/**
 * Shared OMDb data-building helpers.
 * ------------------------------------
 * Used by scripts/fetch-movies.js, scripts/fetch-watchlist.js, and
 * scripts/fetch-collections.js so all three data sources share the exact
 * same fetching, caching, validation, and safe-write logic instead of
 * three copies of the same code.
 *
 * Nothing in this file ever logs the API key, and callers are expected
 * to pass ROOT-relative paths in.
 */

const fs = require("fs");

const REQUEST_DELAY_MS = 250; // be polite to the free OMDb tier
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TITLE_LENGTH = 300; // generous — real movie titles are always shorter

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Never let a value that might contain the secret reach the logs.
function redact(str, apiKey) {
  if (!apiKey || typeof str !== "string") return str;
  return str.split(apiKey).join("[REDACTED]");
}

// Parses a simple "one title per line" text file (movies.txt, Watchlist.txt).
// Strips control characters, trims whitespace, skips blanks/over-long
// lines, and de-duplicates case-insensitively while preserving order.
function parseTitleListText(rawText, { onWarn } = {}) {
  const warn = onWarn || (() => {});
  const rawLines = rawText.split(/\r?\n/);

  const seen = new Set();
  const titles = [];

  for (const rawLine of rawLines) {
    const cleaned = rawLine.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (cleaned.length === 0) continue;

    if (cleaned.length > MAX_TITLE_LENGTH) {
      warn(`Skipping an entry longer than ${MAX_TITLE_LENGTH} characters — not a real movie title.`);
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      warn(`Duplicate entry skipped: "${cleaned}"`);
      continue;
    }
    seen.add(key);
    titles.push(cleaned);
  }

  return titles;
}

// Parses collections.txt. A line matching ^<number>.<name> starts a new
// collection; every following line (until the next header) is a movie
// title belonging to that collection. Tolerates missing/extra spaces,
// blank lines, and lines before the first header (skipped with a
// warning rather than crashing).
function parseCollectionsText(rawText, { onWarn } = {}) {
  const warn = onWarn || (() => {});
  const headerPattern = /^\s*\d+\s*\.\s*(.+?)\s*$/;

  const collections = [];
  let current = null;

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const cleaned = rawLine.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();
    if (cleaned.length === 0) continue;

    const headerMatch = cleaned.match(headerPattern);
    if (headerMatch && headerMatch[1]) {
      current = { name: headerMatch[1], titles: [] };
      collections.push(current);
      continue;
    }

    if (!current) {
      warn(`Skipping a line that appears before any "N. Collection Name" header: "${cleaned}"`);
      continue;
    }

    if (cleaned.length > MAX_TITLE_LENGTH) {
      warn(`Skipping a movie entry longer than ${MAX_TITLE_LENGTH} characters in "${current.name}".`);
      continue;
    }

    current.titles.push(cleaned);
  }

  // De-duplicate titles within each collection (case-insensitive),
  // preserving the order they were listed in.
  for (const c of collections) {
    const seen = new Set();
    c.titles = c.titles.filter((t) => {
      const key = t.toLowerCase();
      if (seen.has(key)) {
        warn(`Duplicate movie skipped in "${c.name}": "${t}"`);
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  return collections.filter((c) => c.name);
}

// Reads a previously-generated JSON file and returns a Map of
// lowercase-title -> successful entry. Understands both shapes used in
// this project: the flat { movies: [...] } shape (movies.json,
// watchlist.json) and the nested { collections: [{ movies: [...] }] }
// shape (collections.json). Missing or unparsable files just yield an
// empty map (never throws).
function loadSuccessfulEntriesFromFile(jsonPath) {
  const map = new Map();
  if (!fs.existsSync(jsonPath)) return map;

  try {
    const raw = fs.readFileSync(jsonPath, "utf-8");
    const parsed = JSON.parse(raw);

    const flatList = Array.isArray(parsed.movies) ? parsed.movies : [];
    const nestedList = Array.isArray(parsed.collections)
      ? parsed.collections.flatMap((c) => (c && Array.isArray(c.movies) ? c.movies : []))
      : [];

    for (const entry of [...flatList, ...nestedList]) {
      if (entry && entry.ok && typeof entry.queriedTitle === "string") {
        map.set(entry.queriedTitle.toLowerCase(), entry);
      }
    }
  } catch {
    // Corrupt/unreadable file — treat as "nothing cached from here".
  }
  return map;
}

// Combines cached successful entries from several JSON files (movies.json,
// watchlist.json, collections.json) into one Map, so a title already
// fetched for one page is reused everywhere instead of re-fetched.
function loadCombinedCache(jsonPaths) {
  const combined = new Map();
  for (const p of jsonPaths) {
    const fromFile = loadSuccessfulEntriesFromFile(p);
    for (const [key, value] of fromFile) {
      if (!combined.has(key)) combined.set(key, value);
    }
  }
  return combined;
}

function parseRuntimeMinutes(runtimeStr) {
  if (!runtimeStr || runtimeStr === "N/A") return null;
  const match = runtimeStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Only ever accept http(s) poster URLs — blocks javascript:, data:, or
// other schemes an unexpected/malformed API response could contain from
// ever reaching the frontend as a src attribute.
function sanitizePosterUrl(posterStr) {
  if (!posterStr || posterStr === "N/A") return null;
  try {
    const parsed = new URL(posterStr);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeOmdbResponse(title, data) {
  const rating = parseFloat(data.imdbRating);
  const year = parseInt(String(data.Year || "").slice(0, 4), 10);

  return {
    queriedTitle: title,
    ok: true,
    title: typeof data.Title === "string" && data.Title ? data.Title : title,
    year: Number.isFinite(year) ? year : null,
    imdbID: typeof data.imdbID === "string" ? data.imdbID : null,
    imdbRating: Number.isFinite(rating) ? rating : null,
    poster: sanitizePosterUrl(data.Poster),
    genres: data.Genre && data.Genre !== "N/A" ? data.Genre.split(",").map((g) => g.trim()).filter(Boolean) : [],
    cast: data.Actors && data.Actors !== "N/A" ? data.Actors.split(",").map((a) => a.trim()).filter(Boolean) : [],
    director: data.Director && data.Director !== "N/A" ? data.Director : null,
    runtimeMinutes: parseRuntimeMinutes(data.Runtime),
    plot: data.Plot && data.Plot !== "N/A" ? data.Plot : null,
    rated: data.Rated && data.Rated !== "N/A" ? data.Rated : null,
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchMovie(title, apiKey) {
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(apiKey)}&t=${encodeURIComponent(
    title
  )}&plot=short`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (networkErr) {
    const isTimeout = networkErr.name === "AbortError";
    return {
      queriedTitle: title,
      ok: false,
      error: isTimeout ? "timeout" : "network_error",
      message: isTimeout
        ? `Request to OMDb timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
        : `Network error while contacting OMDb: ${redact(networkErr.message, apiKey)}`,
      fetchedAt: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let errorType = "http_error";
    if (response.status === 429) errorType = "rate_limited";
    if (response.status === 401) errorType = "invalid_api_key";

    return {
      queriedTitle: title,
      ok: false,
      error: errorType,
      message: `OMDb responded with HTTP ${response.status}`,
      fetchedAt: new Date().toISOString(),
    };
  }

  let data;
  try {
    data = await response.json();
  } catch {
    return {
      queriedTitle: title,
      ok: false,
      error: "malformed_response",
      message: "OMDb returned a response that could not be parsed as JSON",
      fetchedAt: new Date().toISOString(),
    };
  }

  if (!data || typeof data !== "object") {
    return {
      queriedTitle: title,
      ok: false,
      error: "malformed_response",
      message: "OMDb returned an unexpected response shape",
      fetchedAt: new Date().toISOString(),
    };
  }

  if (data.Response === "False") {
    const rawError = typeof data.Error === "string" ? data.Error : "Unknown OMDb error";
    let errorType = "not_found";
    if (/invalid api key/i.test(rawError)) errorType = "invalid_api_key";
    if (/request limit/i.test(rawError)) errorType = "rate_limited";

    return {
      queriedTitle: title,
      ok: false,
      error: errorType,
      message: rawError,
      fetchedAt: new Date().toISOString(),
    };
  }

  return normalizeOmdbResponse(title, data);
}

// Fetches a flat list of titles, reusing `cache` (Map of lowercase title
// -> successful entry) wherever possible. Stops early if OMDb reports an
// invalid key. Returns { results, fetchedCount, cachedCount, errorCount,
// sawInvalidKey, completed }.
async function fetchTitles(titles, apiKey, cache, { onProgress } = {}) {
  const progress = onProgress || (() => {});
  const results = [];
  let fetchedCount = 0;
  let cachedCount = 0;
  let errorCount = 0;
  let sawInvalidKey = false;

  for (const title of titles) {
    const cached = cache.get(title.toLowerCase());

    if (cached && cached.ok) {
      results.push(cached);
      cachedCount++;
      continue;
    }

    const result = await fetchMovie(title, apiKey);
    results.push(result);
    fetchedCount++;

    // Seed the shared cache immediately so later callers in the same
    // process (or a later script reading the same in-memory cache)
    // reuse it instead of re-fetching.
    if (result.ok) cache.set(title.toLowerCase(), result);

    if (!result.ok) {
      errorCount++;
      progress({ type: "error", title, result });
      if (result.error === "invalid_api_key") {
        sawInvalidKey = true;
        progress({ type: "invalid_key" });
        break;
      }
    } else {
      progress({ type: "success", title, result });
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return {
    results,
    fetchedCount,
    cachedCount,
    errorCount,
    sawInvalidKey,
    completed: results.length === titles.length,
  };
}

// Structural + safety validation before a movies-array output ever
// touches disk. Returns { valid, errors }.
function validateMoviesArray(movies, apiKey) {
  const errors = [];

  if (!Array.isArray(movies)) {
    return { valid: false, errors: ["Output is missing a movies array."] };
  }

  movies.forEach((m, i) => {
    if (!m || typeof m !== "object") {
      errors.push(`movies[${i}] is not an object`);
      return;
    }
    if (typeof m.queriedTitle !== "string" || m.queriedTitle.length === 0) {
      errors.push(`movies[${i}] is missing a valid queriedTitle`);
    }
    if (typeof m.ok !== "boolean") {
      errors.push(`movies[${i}] is missing a boolean "ok" field`);
      return;
    }
    if (m.ok) {
      if (typeof m.title !== "string" || m.title.length === 0) errors.push(`movies[${i}] missing title`);
      if (m.year !== null && typeof m.year !== "number") errors.push(`movies[${i}] has invalid year`);
      if (m.imdbRating !== null && typeof m.imdbRating !== "number") errors.push(`movies[${i}] has invalid imdbRating`);
      if (m.poster !== null && typeof m.poster !== "string") errors.push(`movies[${i}] has invalid poster`);
      if (!Array.isArray(m.genres)) errors.push(`movies[${i}] has invalid genres`);
      if (!Array.isArray(m.cast)) errors.push(`movies[${i}] has invalid cast`);
    } else {
      if (typeof m.error !== "string") errors.push(`movies[${i}] missing error type`);
      if (typeof m.message !== "string") errors.push(`movies[${i}] missing error message`);
    }
  });

  if (apiKey) {
    const serialized = JSON.stringify(movies);
    if (serialized.includes(apiKey)) {
      errors.push("Generated output appears to contain the API key — refusing to write it.");
    }
  }

  return { valid: errors.length === 0, errors };
}

// Writes JSON to `finalPath` via a temp-file-then-rename so a crash
// mid-write can never leave a corrupt or partial file behind.
function writeJsonAtomic(finalPath, tmpPath, obj) {
  const serialized = JSON.stringify(obj, null, 2) + "\n";
  fs.writeFileSync(tmpPath, serialized, "utf-8");
  JSON.parse(fs.readFileSync(tmpPath, "utf-8")); // final sanity check
  fs.renameSync(tmpPath, finalPath);
}

module.exports = {
  REQUEST_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  MAX_TITLE_LENGTH,
  sleep,
  redact,
  parseTitleListText,
  parseCollectionsText,
  loadSuccessfulEntriesFromFile,
  loadCombinedCache,
  sanitizePosterUrl,
  normalizeOmdbResponse,
  fetchMovie,
  fetchTitles,
  validateMoviesArray,
  writeJsonAtomic,
};
