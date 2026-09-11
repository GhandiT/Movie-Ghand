# Ghandi Movies

A personal movie library. You list what you've watched in a plain text file, GitHub Actions looks each title up on OMDb and writes the results to a JSON file, and a static, dark, cinematic website reads that JSON. No servers, no exposed API keys, no search box — just your list, beautifully displayed.

## How it fits together

```
movies.txt
    ↓          (you edit this — one title per line)
GitHub Actions
    ↓          (runs scripts/fetch-movies.js, reads the OMDB_API_KEY secret)
OMDb API
    ↓          (returns title, year, rating, poster, cast, etc.)
movies.json
    ↓          (committed back to the repo automatically)
GitHub Pages
    ↓          (serves index.html / style.css / script.js as static files)
Ghandi Movies
```

The key idea: your OMDb API key only ever exists inside GitHub's servers, as a secret used by the Actions workflow. Your browser never sees it and never calls OMDb directly — it only ever fetches the already-built `movies.json` file.

## What's in this project

| File | What it does |
|---|---|
| `movies.txt` | Your list of watched movies — one title per line. This is the only file you edit day-to-day. |
| `movies.json` | Generated automatically. The frontend's entire data source. Don't edit by hand. |
| `index.html` | Page structure: header, stats bar, filter controls, movie grid, detail popup. |
| `style.css` | The dark, cinematic visual design. |
| `script.js` | Loads `movies.json`, computes statistics, and handles sorting/filtering/detail view — entirely in the browser, no API calls. |
| `scripts/fetch-movies.js` | Node script that reads `movies.txt`, queries OMDb, and writes `movies.json`. Only ever runs inside GitHub Actions (or locally if you choose). |
| `.github/workflows/update-movies.yml` | The GitHub Actions workflow that runs the script above and commits the result. |
| `.env.example` | Documentation showing the shape of the API key variable. Never contains a real key. |
| `.gitignore` | Keeps a real `.env` (if you ever create one locally) out of Git. |

## One-time setup

### 1. Get a free OMDb API key

1. Go to https://www.omdbapi.com/apikey.aspx
2. Choose the free tier, enter your email, and submit.
3. Check your email and click the activation link — the key doesn't work until you activate it.
4. Copy the key you receive; you'll paste it into GitHub in step 3 below.

### 2. Create the GitHub repository

1. Go to https://github.com/new
2. Name it something like `ghandi-movies`. Choose **Public** (GitHub Pages on the free plan needs a public repo, and remember — the key is never stored in the repo anyway).
3. Don't initialize with a README (you already have one) — create an empty repository.
4. On your computer, in the folder containing these files, run:
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/ghandi-movies.git
   git push -u origin main
   ```

### 3. Add your OMDb key as a GitHub Secret

1. In your new repository on GitHub, go to **Settings → Secrets and variables → Actions**.
2. Click **New repository secret**.
3. Name: `OMDB_API_KEY`
4. Value: paste the key from step 1.
5. Click **Add secret**.

The key now lives only in GitHub's encrypted secret store. It will never appear in your code, your commits, or the generated `movies.json`.

### 4. Enable GitHub Pages

1. Go to **Settings → Pages**.
2. Under "Build and deployment", set **Source** to **Deploy from a branch**.
3. Set **Branch** to `main` and folder to `/ (root)`.
4. Click **Save**. GitHub will give you a URL like `https://YOUR_USERNAME.github.io/ghandi-movies/` — it may take a minute to go live.

### 5. Run the workflow for the first time

1. Go to the **Actions** tab of your repository.
2. Click **Update movies.json** in the left sidebar.
3. Click **Run workflow** → **Run workflow** (leave "Re-fetch every movie" unchecked).
4. Wait for it to finish (usually under a minute). It will fetch data for the sample titles in `movies.txt` and commit the resulting `movies.json` back to `main`.
5. Refresh your GitHub Pages URL — your movie cards should now appear.

## Day-to-day use

### Adding a movie

1. Open `movies.txt` and add the title on its own line (e.g. `Whiplash`).
2. Commit and push:
   ```bash
   git add movies.txt
   git commit -m "Add Whiplash"
   git push
   ```
3. Pushing a change to `movies.txt` automatically triggers the workflow. Watch it run in the **Actions** tab.
4. Once it finishes, it commits an updated `movies.json`, and GitHub Pages picks it up within a minute or two — no other action needed.

You can also add titles directly on GitHub.com (edit `movies.txt` in the browser and commit) — the same automatic update happens.

### Re-fetching everything from scratch

If you ever want to bypass the cache and re-download every movie (for example, after OMDb corrects some data), go to **Actions → Update movies.json → Run workflow**, and check **"Re-fetch every movie, ignoring the cache"** before running.

### How caching works

Each time the workflow runs, it only calls OMDb for titles that don't already have a successful entry in `movies.json`. Titles you've already fetched successfully are reused as-is, so adding one new movie to a long list doesn't re-fetch everything else.

## Common errors and fixes

| Symptom | Cause | Fix |
|---|---|---|
| Workflow fails with "OMDB_API_KEY environment variable is not set" | The secret wasn't created, or its name doesn't match exactly | Re-check **Settings → Secrets and variables → Actions**; the name must be exactly `OMDB_API_KEY` |
| Workflow fails mentioning an invalid API key | Key wasn't activated by email yet, or was mistyped | Check your email for the OMDb activation link, then re-copy the key into the secret |
| A specific movie shows "Not found" | OMDb couldn't match the title | Try a more exact title (check the movie's real title on IMDb), including the correct year if it's a remake |
| A card shows "Rate limited" | The free OMDb tier allows 1,000 requests/day | Wait and re-run the workflow later; the cache means this rarely recurs |
| Site shows "movies.json couldn't be loaded" | The workflow hasn't run yet, or Pages hasn't picked up the latest commit | Run the workflow manually once (see step 5 above), then hard-refresh the page |
| Posters missing for some movies | OMDb has no poster on file for that title | Expected and handled gracefully — a text placeholder is shown instead |

## Design and behavior notes

- **No search box, by design.** The site only ever shows what's in `movies.txt`.
- **No frontend framework.** Just HTML, CSS, and vanilla JavaScript — works directly on GitHub Pages with zero build step for the site itself (only the data-fetch step runs in Actions).
- **No client-side API calls.** Sorting, filtering, and statistics are all computed from the already-downloaded `movies.json` in the browser.
- **Graceful failure.** One bad title never breaks the site — it's shown as its own small error card explaining what went wrong.

## Running the fetch script locally (optional)

You don't need to do this — GitHub Actions handles it — but if you want to test locally:

```bash
export OMDB_API_KEY=your_real_key_here
node scripts/fetch-movies.js
```

Never commit a `.env` file or hardcode your key into any file that gets pushed to GitHub.
