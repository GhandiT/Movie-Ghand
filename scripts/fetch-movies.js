/**
 * GHANDI MOVIES — data builder
 * ----------------------------
 * Reads movies.txt (one title per line), looks each one up on OMDb,
 * and writes a static movies.json that the frontend reads.
 *
 * This script is meant to run inside GitHub Actions, where the OMDb
 * API key is injected as the OMDB_API_KEY environment variable
 * (from a GitHub Actions Secret). It never writes the key to disk,
 * never logs it, and never includes it in the generated JSON.
 *
 * Caching: if a title already has a successful entry in the existing
 * movies.json, we reuse it instead of calling the API again. Set
 * FORCE_REFRESH=true as an env var to bypass the cache and re-fetch
 * everything.
 *
 * Safety: the previous movies.json is never touched until a new,
 * validated version has been built successfully in full. If anything
 * looks wrong (invalid API key, malformed output, or a total wipeout
 * of previously-working data) the script exits without writing, so a
 * temporary failure can never destroy good data.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MOVIES_TXT = path.join(ROOT, "movies.txt");
const MOVIES_JSON = path.join(ROOT, "movies.json");
const MOVIES_JSON_TMP = path.join(ROOT, "movies.json.tmp");

const API_KEY = process.env.OMDB_API_KEY;
const FORCE_REFRESH = process.env.FORCE_REFRESH === "true";
const REQUEST_DELAY_MS = 250; // be polite to the free OMDb tier
const REQUEST_TIMEOUT_MS = 15000;
const MAX_TITLE_LENGTH = 300; // generous — real movie titles are always shorter

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Never let a value that might contain the secret reach the logs.
function redact(str) {
  if (!API_KEY || typeof str !== "string") return str;
  return str.split(API_KEY).join("[REDACTED]");
}

function readMovieTitles() {
  if (!fs.existsSync(MOVIES_TXT)) {
    fail(`Could not find movies.txt at ${MOVIES_TXT}`);
  }

  const raw = fs.readFileSync(MOVIES_TXT, "utf-8");
  const rawLines = raw.split(/\r?\n/);

  const seen = new Set();
  const titles = [];

  for (const rawLine of rawLines) {
    // Strip control characters (including stray tabs/nulls) that could
    // otherwise cause odd behavior downstream, then trim whitespace.
    const cleaned = rawLine.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim();

    if (cleaned.length === 0) continue;

    if (cleaned.length > MAX_TITLE_LENGTH) {
      console.warn(
        `⚠️  Skipping an entry in movies.txt: longer than ${MAX_TITLE_LENGTH} characters, ` +
          "which is almost certainly not a real movie title."
      );
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      console.warn(`⚠️  Duplicate entry skipped in movies.txt: "${cleaned}"`);
      continue;
    }
    seen.add(key);
    titles.push(cleaned);
  }

  if (titles.length === 0) {
    console.warn("⚠️  movies.txt has no usable titles. movies.json will contain an empty list.");
  }

  return titles;
}

function loadExistingCache() {
  if (!fs.existsSync(MOVIES_JSON)) return new Map();

  try {
    const raw = fs.readFileSync(MOVIES_JSON, "utf-8");
    const parsed = JSON.parse(raw);
    const cache = new Map();
    for (const entry of parsed.movies || []) {
      if (entry && typeof entry.queriedTitle === "string") {
        cache.set(entry.queriedTitle.toLowerCase(), entry);
      }
    }
    return cache;
  } catch (err) {
    console.warn("⚠️  Existing movies.json could not be parsed, starting fresh.");
    return new Map();
  }
}

function parseRuntimeMinutes(runtimeStr) {
  if (!runtimeStr || runtimeStr === "N/A") return null;
  const match = runtimeStr.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Only ever accept http(s) poster URLs. This blocks javascript:, data:,
// or other schemes an unexpected/malformed API response could contain
// from ever reaching the frontend as a src attribute.
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

async function fetchMovie(title) {
  const url = `https://www.omdbapi.com/?apikey=${encodeURIComponent(API_KEY)}&t=${encodeURIComponent(
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
        : `Network error while contacting OMDb: ${redact(networkErr.message)}`,
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
  } catch (parseErr) {
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
    // Common cases: "Movie not found!", "Invalid API key!", "Request limit reached!"
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

// Structural + safety validation before we ever let a result touch disk.
// Returns { valid: boolean, errors: string[] }.
function validateOutput(output) {
  const errors = [];

  if (!output || typeof output !== "object" || !Array.isArray(output.movies)) {
    return { valid: false, errors: ["Output is missing a movies array."] };
  }

  output.movies.forEach((m, i) => {
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

  // Defense in depth: make sure the secret can never end up in the file
  // we're about to commit to a public repository.
  if (API_KEY) {
    const serialized = JSON.stringify(output);
    if (serialized.includes(API_KEY)) {
      errors.push("Generated output appears to contain the API key — refusing to write it.");
    }
  }

  return { valid: errors.length === 0, errors };
}

async function main() {
  if (!API_KEY) {
    fail(
      "OMDB_API_KEY environment variable is not set. In GitHub Actions this comes from " +
        "the OMDB_API_KEY repository secret. Locally, run with:\n" +
        "  OMDB_API_KEY=your_key node scripts/fetch-movies.js"
    );
  }

  const titles = readMovieTitles();

  // Always look at what's really on disk to judge whether previously-good
  // data exists — independent of FORCE_REFRESH, which only controls
  // whether *this run* is allowed to reuse cached entries for fetching.
  const existingCache = loadExistingCache();
  const previousSuccessCount = Array.from(existingCache.values()).filter((m) => m && m.ok).length;
  const cache = FORCE_REFRESH ? new Map() : existingCache;

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

    const result = await fetchMovie(title);
    results.push(result);
    fetchedCount++;

    if (!result.ok) {
      errorCount++;
      console.warn(`⚠️  "${title}": ${result.message}`);
      if (result.error === "invalid_api_key") {
        sawInvalidKey = true;
        console.error("❌ OMDb reports the API key is invalid — stopping early to avoid wasting requests.");
        break;
      }
    } else {
      console.log(`✅ "${title}" → ${result.title} (${result.year ?? "n/a"})`);
    }

    // Small delay so we don't hammer the free-tier API.
    await sleep(REQUEST_DELAY_MS);
  }

  console.log("\n— Summary —");
  console.log(`Total titles in movies.txt: ${titles.length}`);
  console.log(`Titles processed this run: ${results.length}`);
  console.log(`Fetched from OMDb: ${fetchedCount}`);
  console.log(`Reused from cache: ${cachedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (sawInvalidKey) {
    fail(
      "OMDb reported an invalid API key. The previous movies.json has been left untouched. " +
        "Double-check the OMDB_API_KEY secret value (Settings → Secrets and variables → Actions) " +
        "and that it's activated via the confirmation email OMDb sends when you request a key."
    );
  }

  if (results.length < titles.length) {
    // We broke out of the loop early for some other reason before finishing.
    fail("Stopped before processing every title. The previous movies.json has been left untouched.");
  }

  const newSuccessCount = results.filter((m) => m.ok).length;

  // If we previously had working data and this run produced *zero*
  // successes despite having titles to look up, something is systemically
  // wrong (e.g. an outage, or every request being rejected) — refuse to
  // let that wipe out a previously good movies.json.
  if (titles.length > 0 && previousSuccessCount > 0 && newSuccessCount === 0) {
    fail(
      "Every movie failed to fetch in this run, but a previous successful movies.json exists. " +
        "Leaving the existing movies.json untouched rather than overwriting it with all-error data. " +
        "Check OMDb's status and your API key, then re-run the workflow."
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceCount: titles.length,
    movies: results,
  };

  const { valid, errors } = validateOutput(output);
  if (!valid) {
    console.error("❌ Generated movies.json failed validation:");
    errors.forEach((e) => console.error(`   - ${e}`));
    fail("Refusing to overwrite the existing movies.json with invalid data.");
  }

  // Write to a temp file and only replace movies.json once the write
  // succeeds in full, so a crash mid-write can never leave a corrupt or
  // partial file behind.
  const serialized = JSON.stringify(output, null, 2) + "\n";
  fs.writeFileSync(MOVIES_JSON_TMP, serialized, "utf-8");
  JSON.parse(fs.readFileSync(MOVIES_JSON_TMP, "utf-8")); // re-read as a final sanity check
  fs.renameSync(MOVIES_JSON_TMP, MOVIES_JSON);

  console.log(`Wrote ${MOVIES_JSON}`);
}

main().catch((err) => {
  // Anything unexpected: fail loudly, but movies.json was never touched
  // because writing only happens at the very end of main().
  fail(`Unexpected error: ${redact(err.stack || err.message || String(err))}`);
});