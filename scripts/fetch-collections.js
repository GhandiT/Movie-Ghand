/**
 * GHANDI MOVIES — data builder (Collection / collections.txt)
 * ---------------------------------------------------------------
 * Parses collections.txt (see README for the exact format), fetches
 * every movie referenced across every collection from OMDb (reusing the
 * shared cache from movies.json/watchlist.json/collections.json), sorts
 * each collection's movies by release year, and writes collections.json.
 *
 * The frontend Collection page reads collections.json only — no OMDb
 * key or API calls happen in the browser.
 */

const fs = require("fs");
const path = require("path");
const {
  parseCollectionsText,
  loadCombinedCache,
  fetchTitles,
  validateMoviesArray,
  writeJsonAtomic,
  redact,
} = require("./lib/omdb");

const ROOT = path.join(__dirname, "..");
const COLLECTIONS_TXT = path.join(ROOT, "collections.txt");
const COLLECTIONS_JSON = path.join(ROOT, "collections.json");
const COLLECTIONS_JSON_TMP = path.join(ROOT, "collections.json.tmp");
const MOVIES_JSON = path.join(ROOT, "movies.json");
const WATCHLIST_JSON = path.join(ROOT, "watchlist.json");

const API_KEY = process.env.OMDB_API_KEY;
const FORCE_REFRESH = process.env.FORCE_REFRESH === "true";

function fail(message) {
  console.error(`\n❌ ${message}\n`);
  process.exit(1);
}

function countPreviousSuccesses(collectionsJsonPath) {
  if (!fs.existsSync(collectionsJsonPath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(collectionsJsonPath, "utf-8"));
    let count = 0;
    for (const c of parsed.collections || []) {
      for (const m of c.movies || []) {
        if (m && m.ok) count++;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

async function main() {
  if (!API_KEY) {
    fail(
      "OMDB_API_KEY environment variable is not set. In GitHub Actions this comes from " +
        "the OMDB_API_KEY repository secret. Locally, run with:\n" +
        "  OMDB_API_KEY=your_key node scripts/fetch-collections.js"
    );
  }

  if (!fs.existsSync(COLLECTIONS_TXT)) {
    console.warn(`⚠️  collections.txt not found at ${COLLECTIONS_TXT} — writing empty collections.json.`);
    writeJsonAtomic(COLLECTIONS_JSON, COLLECTIONS_JSON_TMP, {
      generatedAt: new Date().toISOString(),
      collections: [],
    });
    return;
  }

  const parsedCollections = parseCollectionsText(fs.readFileSync(COLLECTIONS_TXT, "utf-8"), {
    onWarn: (msg) => console.warn(`⚠️  ${msg}`),
  });

  if (parsedCollections.length === 0) {
    console.warn("⚠️  collections.txt has no usable collections. collections.json will be empty.");
  }

  // One flat, de-duplicated title list across every collection, so a
  // movie that appears in two collections (or already exists in
  // movies.json/watchlist.json) is only ever fetched once.
  const allTitles = [];
  const seenTitles = new Set();
  for (const c of parsedCollections) {
    for (const t of c.titles) {
      const key = t.toLowerCase();
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        allTitles.push(t);
      }
    }
  }

  const combinedCache = loadCombinedCache([MOVIES_JSON, WATCHLIST_JSON, COLLECTIONS_JSON]);
  const ownPreviousSuccessCount = countPreviousSuccesses(COLLECTIONS_JSON);
  const cache = FORCE_REFRESH ? new Map() : combinedCache;

  const { results, fetchedCount, cachedCount, errorCount, sawInvalidKey, completed } = await fetchTitles(
    allTitles,
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

  console.log("\n— Summary (collections.json) —");
  console.log(`Collections found: ${parsedCollections.length}`);
  console.log(`Unique titles across all collections: ${allTitles.length}`);
  console.log(`Fetched from OMDb: ${fetchedCount}`);
  console.log(`Reused from cache: ${cachedCount}`);
  console.log(`Errors: ${errorCount}`);

  if (sawInvalidKey) {
    fail(
      "OMDb reported an invalid API key. The previous collections.json has been left untouched. " +
        "Double-check the OMDB_API_KEY secret."
    );
  }

  if (!completed) {
    fail("Stopped before processing every title. The previous collections.json has been left untouched.");
  }

  const newSuccessCount = results.filter((m) => m.ok).length;
  if (allTitles.length > 0 && ownPreviousSuccessCount > 0 && newSuccessCount === 0) {
    fail(
      "Every title failed to fetch in this run, but a previous successful collections.json exists. " +
        "Leaving the existing collections.json untouched rather than overwriting it with all-error data."
    );
  }

  // Look each collection's titles back up in the results (by lowercase
  // title) and sort each collection's movies chronologically. Unknown
  // release years (fetch errors, or a movie with no year) sort last.
  const byLowerTitle = new Map(results.map((m) => [m.queriedTitle.toLowerCase(), m]));

  const outputCollections = parsedCollections.map((c) => {
    const movies = c.titles
      .map((t) => byLowerTitle.get(t.toLowerCase()))
      .filter(Boolean)
      .sort((a, b) => {
        const ay = a.ok && typeof a.year === "number" ? a.year : Infinity;
        const by = b.ok && typeof b.year === "number" ? b.year : Infinity;
        return ay - by;
      });
    return { name: c.name, movies };
  });

  const output = {
    generatedAt: new Date().toISOString(),
    collections: outputCollections,
  };

  // Validate every movie across every collection as one flat list.
  const flatMovies = outputCollections.flatMap((c) => c.movies);
  const { valid, errors } = validateMoviesArray(flatMovies, API_KEY);
  if (!valid) {
    console.error("❌ Generated collections.json failed validation:");
    errors.forEach((e) => console.error(`   - ${e}`));
    fail("Refusing to overwrite the existing collections.json with invalid data.");
  }

  writeJsonAtomic(COLLECTIONS_JSON, COLLECTIONS_JSON_TMP, output);
  console.log(`Wrote ${COLLECTIONS_JSON}`);
}

main().catch((err) => {
  fail(`Unexpected error: ${redact(err.stack || err.message || String(err), API_KEY)}`);
});
