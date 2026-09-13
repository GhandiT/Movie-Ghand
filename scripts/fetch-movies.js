/**
 * GHANDI MOVIES — data builder (Home / movies.txt)
 * -------------------------------------------------
 * Reads movies.txt (one title per line), looks each one up on OMDb, and
 * writes a static movies.json that the frontend reads.
 *
 * This script is meant to run inside GitHub Actions, where the OMDb API
 * key is injected as the OMDB_API_KEY environment variable (from a
 * GitHub Actions Secret). It never writes the key to disk, never logs
 * it, and never includes it in the generated JSON.
 *
 * Caching: reuses any already-successful entry found in movies.json,
 * watchlist.json, or collections.json (a title fetched for any one of
 * those pages is never re-fetched for another). Set FORCE_REFRESH=true
 * to bypass the cache and re-fetch everything for this file.
 *
 * Safety: movies.json is never touched until a new, validated version
 * has been built successfully in full. If anything looks wrong (invalid
 * API key, malformed output, or a total wipeout of previously-working
 * data) the script exits without writing, so a temporary failure can
 * never destroy good data.
 */

const fs = require("fs");
const path = require("path");
const {
  parseTitleListText,
  loadCombinedCache,
  loadSuccessfulEntriesFromFile,
  fetchTitles,
  validateMoviesArray,
  writeJsonAtomic,
  redact,
} = require("./lib/omdb");

const ROOT = path.join(__dirname, "..");
const MOVIES_TXT = path.join(ROOT, "movies.txt");
const MOVIES_JSON = path.join(ROOT, "movies.json");
const MOVIES_JSON_TMP = path.join(ROOT, "movies.json.tmp");
const WATCHLIST_JSON = path.join(ROOT, "watchlist.json");
const COLLECTIONS_JSON = path.join(ROOT, "collections.json");

const API_KEY = process.env.OMDB_API_KEY;
const FORCE_REFRESH = process.env.FORCE_REFRESH === "true";

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

async function main() {
  if (!API_KEY) {
    fail(
      "OMDB_API_KEY environment variable is not set. In GitHub Actions this comes from " +
        "the OMDB_API_KEY repository secret. Locally, run with:\n" +
        "  OMDB_API_KEY=your_key node scripts/fetch-movies.js"
    );
  }

  if (!fs.existsSync(MOVIES_TXT)) {
    fail(`Could not find movies.txt at ${MOVIES_TXT}`);
  }

  const titles = parseTitleListText(fs.readFileSync(MOVIES_TXT, "utf-8"), {
    onWarn: (msg) => console.warn(`⚠️  ${msg}`),
  });
  if (titles.length === 0) {
    console.warn("⚠️  movies.txt has no usable titles. movies.json will contain an empty list.");
  }

  // Shared cache: a title already fetched for the Watchlist or a
  // Collection is reused here too, and vice versa.
  const combinedCache = loadCombinedCache([MOVIES_JSON, WATCHLIST_JSON, COLLECTIONS_JSON]);
  const ownPreviousSuccessCount = Array.from(loadSuccessfulEntriesFromFile(MOVIES_JSON).values()).filter(
    (m) => m && m.ok
  ).length;
  const cache = FORCE_REFRESH ? new Map() : combinedCache;

  const { results, fetchedCount, cachedCount, errorCount, sawInvalidKey, completed } = await fetchTitles(
    titles,
    API_KEY,
    cache,
    {
      onProgress: (evt) => {
        if (evt.type === "success") {
          console.log(`✅ "${evt.title}" → ${evt.result.title} (${evt.result.year ?? "n/a"})`);
        } else if (evt.type === "error") {
          console.warn(`⚠️  "${evt.title}": ${evt.result.message}`);
        } else if (evt.type === "invalid_key") {
          console.error("❌ OMDb reports the API key is invalid — stopping early to avoid wasting requests.");
        }
      },
    }
  );

  console.log("\n— Summary (movies.json) —");
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

  if (!completed) {
    fail("Stopped before processing every title. The previous movies.json has been left untouched.");
  }

  const newSuccessCount = results.filter((m) => m.ok).length;
  if (titles.length > 0 && ownPreviousSuccessCount > 0 && newSuccessCount === 0) {
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

  const { valid, errors } = validateMoviesArray(output.movies, API_KEY);
  if (!valid) {
    console.error("❌ Generated movies.json failed validation:");
    errors.forEach((e) => console.error(`   - ${e}`));
    fail("Refusing to overwrite the existing movies.json with invalid data.");
  }

  writeJsonAtomic(MOVIES_JSON, MOVIES_JSON_TMP, output);
  console.log(`Wrote ${MOVIES_JSON}`);
}

main().catch((err) => {
  fail(`Unexpected error: ${redact(err.stack || err.message || String(err), API_KEY)}`);
});
