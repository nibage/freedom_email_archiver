# Testing and verification

The public checkout contains only fictional messages. The four indexed demonstration emails under `archived_emails/example/` are separate from the MBOX inputs in `tests/fixtures/`, which are used to verify import and deduplication.

## Automated checks

GitHub Actions runs the source checks and actual offline browser flow. See the [current workflow results](https://github.com/nibage/freedom_email_archiver/actions/workflows/archive-tests.yml) rather than relying on old committed screenshots or result JSON.

Run the dependency-free source checks with Node 22:

```sh
node tests/eml-node.cjs
node tests/theme-node.cjs
node tests/reader-node.cjs
node tests/catalog-sync-node.cjs
node tests/recent-target-node.cjs
node tests/importer-lazy-node.cjs
node tests/writer-lock-node.cjs
node scripts/check-public.cjs
```

For browser regression checks:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/browser-flow.cjs
```

Set `CHROME_PATH` to an installed Chrome executable if needed. The test uses a disposable on-disk filesystem adapter, opens the real offline application, checks page and filter restoration, direct message rendering, imports, deduplication, attachment handling, full-text search, check/rebuild progress and cancellation, and runs the browser import-engine suite.

For native filesystem testing, open `tests/index.html` in desktop Chrome/Edge and choose an empty disposable test folder. Before relying on the application for a large real archive, test import, interruption, restore and recovery against a backup. Automated browser adapters do not replace native OS picker testing.

## Refresh documentation screenshots

After installing Playwright as above:

```sh
node scripts/capture-screenshots.cjs
```

This captures the actual offline app in Chromium using a temporary copy of the bundled four-message demo. It writes the images under `docs/screenshots/`. It refuses to use a checkout containing additional account folders or a modified demo manifest. Never capture private email in public documentation.

The [documentation screenshots workflow](https://github.com/nibage/freedom_email_archiver/actions/workflows/documentation-screenshots.yml) can also refresh the screenshots on main.

Historical verification records remain available in Git history, but are not evidence that the current revision passes.
