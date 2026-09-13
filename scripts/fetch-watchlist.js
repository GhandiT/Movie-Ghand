/**
 * GHANDI MOVIES — data builder (Watchlist & Rewatchs / Watchlist.txt)
 * ---------------------------------------------------------------------
 * Same engine as fetch-movies.js (see scripts/lib/omdb.js), pointed at
 * Watchlist.txt instead. Produces watchlist.json, which the Watchlist
 * page reads client-side — no OMDb key or API calls in the browser.
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
const WATCHLIST_TXT = path.join(ROOT, "Watchlist.txt");
const WATCHLIST_JSON = path.join(ROOT, "watchlist.json");
const WATCHLIST_JSON_TMP = path.join(ROOT, "watchlist.json.tmp");
const MOVIES_JSON = path.join(ROOT, "movies.json");
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
        "  OMDB_API_KEY=your_key node scripts/fetch-watchlist.js"
    );
  }

  if (!fs.existsSync(WATCHLIST_TXT)) {
    console.warn(`⚠️  Watchlist.txt not found at ${WATCHLIST_TXT} — writing an empty watchlist.json.`);
    writeJsonAtomic(WATCHLIST_JSON, WATCHLIST_JSON_TMP, {
      generatedAt: new Date().toISOString(),
      sourceCount: 0,
      movies: [],
    });
    return;
  }

  const titles = parseTitleListText(fs.readFileSync(WATCHLIST_TXT, "utf-8"), {
    onWarn: (msg) => console.warn(`⚠️  ${msg}`),
  });
  if (titles.length === 0) {
    console.warn("⚠️  Watchlist.txt has no usable titles. watchlist.json will contain an empty list.");
  }

  const combinedCache = loadCombinedCache([MOVIES_JSON, WATCHLIST_JSON, COLLECTIONS_JSON]);
  const ownPreviousSuccessCount = Array.from(loadSuccessfulEntriesFromFile(WATCHLIST_JSON).values()).filter(
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

  console.log("\n— Summary (watchlist.json) —");
  console.log(`Total titles in Watchlist.txt: ${titles.length}`);
  console.log(`Titles processed this run: ${results.length}`);
  console.log(`Fetched from OMDb: ${fetchedCount}`);
  console.log(`Reused from cache: ${cachedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (sawInvalidKey) {
    fail(
      "OMDb reported an invalid API key. The previous watchlist.json has been left untouched. " +
        "Double-check the OMDB_API_KEY secret."
    );
  }

  if (!completed) {
    fail("Stopped before processing every title. The previous watchlist.json has been left untouched.");
  }

  const newSuccessCount = results.filter((m) => m.ok).length;
  if (titles.length > 0 && ownPreviousSuccessCount > 0 && newSuccessCount === 0) {
    fail(
      "Every title failed to fetch in this run, but a previous successful watchlist.json exists. " +
        "Leaving the existing watchlist.json untouched rather than overwriting it with all-error data."
    );
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourceCount: titles.length,
    movies: results,
  };

  const { valid, errors } = validateMoviesArray(output.movies, API_KEY);
  if (!valid) {
    console.error("❌ Generated watchlist.json failed validation:");
    errors.forEach((e) => console.error(`   - ${e}`));
    fail("Refusing to overwrite the existing watchlist.json with invalid data.");
  }

  writeJsonAtomic(WATCHLIST_JSON, WATCHLIST_JSON_TMP, output);
  console.log(`Wrote ${WATCHLIST_JSON}`);
}

main().catch((err) => {
  fail(`Unexpected error: ${redact(err.stack || err.message || String(err), API_KEY)}`);
});
