# Verification of the English example release

Tested using Chrome 155.0.8059.81 on Windows, opening local `file://` pages with networking disabled. No local HTTP server or file-origin security override was used.

- **20 import-engine checks passed.** First import, repeat without additional files, overlap, label merging, preservation of earlier messages, English catalog/unknown-date paths, standalone headers, CID links, ASCII attachment paths, Message-ID collisions, missing IDs, HTML sanitization, cancellation/retry, exclusive writer lock, long folded headers and installation of a completely blank target archive were exercised.
- These English engine tests used the real browser JavaScript with a test filesystem adapter writing actual disk files. They are not a fresh native folder-picker verification. The original implementation had separate native File System Access tests; those private-development logs are deliberately not included in this public package.
- **14 browser UI checks passed.** Four examples loaded, English page/message labels rendered, body/accent search and label/date filters worked, the CID image loaded, the text attachment opened, messages contained no scripts, and a relocated copy worked in a new offline browser context. Zero HTTP(S) requests and JavaScript errors were observed.
- The installer payload was verified to create a zero-message archive. It does not embed the example catalog or message contents.
- Publication checks confirm the shipped manifest has only the `example` account with four fictional messages. Example addresses use `.invalid`. No private-account tree, user-home paths or personal import logs are included.

Machine-readable results are `engine-results.json` and `browser-results.json`. The screenshot shows fictional data only. Open `tests/index.html` in Chrome/Edge and choose a separate test folder to rerun the native integration tests yourself; the installer check is part of the automated test setup, not that manual page.

Edge, Firefox, Safari and Linux were not independently tested for this English package. See the main README for supported APIs and limits. No test result is a guarantee against all malformed mail or abrupt hardware failure.

## Proposed HTML fidelity update (not yet independently browser-verified)

The `fix/email-html-fidelity` branch adds isolated rich-HTML rendering, blocked-by-default remote images with a manual load control, and an optional reformat pass for existing duplicate messages. Additional engine assertions cover color retention, CSS URL stripping, remote-image opt-in, and duplicate reformatting. The prior Chrome test counts above refer to the *earlier published version*, not this change. Rerun `tests/index.html` in Chrome/Edge with an empty test directory before deploying to real mail.

## Rebuildable HTML metadata branch (pending integration verification)

The additional branch adds inert per-email JSON metadata, a separate HTML-folder index rebuild, and generated manifest placement under `assets/catalog/` with fallback to legacy root manifests. Added browser tests exercise index rebuilding, metadata recovery, cancellation and preservation of standalone HTML/attachment paths. These tests have been authored but **not independently executed** in a real Chrome/Edge filesystem session. The older verification counts in this file must not be attributed to the new feature.

## Selected EML preservation branch — verification status

The `feature/selected-eml-retention` branch adds a default-on selected-category EML policy. Added native-browser regression checks exercise MBOXrd body-only de-quoting, CRLF preservation, DKIM-only exclusion, Gmail Important/Starred, PGP and S/MIME signed/encrypted classification, selected EML file output, SHA-256 verification, repeat-import reuse, corruption recovery, label-based promotion, intentional opt-out, EML verification failure without publishing false metadata, and preservation of EML references during HTML-only catalog rebuild.

The standalone source-level tests are available at `tests/eml-node.cjs` and can be run using `node tests/eml-node.cjs` without external libraries.

The EML helper's classification, byte-extraction and overwrite/reuse logic were also **executed in a limited JavaScript in-memory filesystem adapter**. That test used a simple test hash (not SHA-256), so it verifies control flow and round-trip reuse but does not replace native browser integration. Syntax checks and bundle consistency checks were performed. **The full native File System Access browser suite and real multi-GB private MBOX were not run here.** Do not attribute earlier test counts to the new branch. Run `tests/index.html` on a disposable Chrome/Edge folder and check that copied EML bytes pass SHA-256 verification before using a real archive.

## Current branch option defaults and migration removal

The three EML options are independent: signed/encrypted **on by default**, Gmail Starred **off by default**, Gmail Important **off by default**. Each Gmail checkbox explicitly warns that storing EML uses more space, and Important may include a large number of auto-labeled emails. Browser regression tests cover Starred-only, Important-only, and both-off imports. Node tests also cover the independent selector logic.

The integrated version restores optional **Rebuild appearance** and legacy manifest compatibility while keeping selective EML retention and strict validation for self-describing HTML catalog repair. Full browser validation remains pending.

These updated tests are authored but the full native File System Access browser suite has not yet been independently executed; do not interpret prior baseline counts as passing results for this branch.

## Integrated PR #3 and PR #4 (browser verification pending)

The integrated release includes selected EML retention, optional rebuilding of existing HTML appearance, safe Stop feedback, same-tab email links, catalog refresh from the selected destination, and a sibling `__email_archiver` viewer folder in newly created archives. The installer bundle was regenerated from the current source files and syntax/manifest path checks are available. This combination has not yet received a complete independent Chrome/Edge File System Access import or 4.5 GB interruption test. Run native tests on an empty test directory and back up any existing archive before trying it with real mail.

## Reader image preference and return-position update (pending real-browser confirmation)

The `fix/image-preference-and-return-position` branch adds a checked-by-default **Load external images automatically** setting in the archive's Browse toolbar. Newly generated standalone HTML emails honor the URL preference and provide a history-aware Back link. Direct file opening without the preference parameter retains remote image blocking. The viewer also saves a short-lived, optional per-tab return position for older HTML pages, without modifying messages or needing the MBOX. `node tests/reader-node.cjs` validates HTML script hashing, remote-image consent, and Back-link behavior; the GitHub Actions workflow runs this test. Test in desktop Chrome/Edge with saved real messages before relying on the optional session-storage restoration or default image behavior. An archive-page checkbox cannot retrofit the scripts inside already-saved older HTML emails without a separate upgrade.

## Recent folder and independent repair targets (browser verification pending)

The recent-target branch adds opt-in reuse of the most recently selected archive directory handle in Import MBOX and Repair catalog. Browser IndexedDB stores only the local folder handle when allowed; no message content or search index is copied into browser storage. Permission must be granted to reuse it, and the ordinary folder picker remains available. Repair scans/writes only its explicitly selected root and does not switch an unrelated viewer to display that archive. `node tests/recent-target-node.cjs` supplies a simulated UI check; native Chrome/Edge directory-handle persistence and permission prompts still need real-browser verification.

## Unified Import workspace with auto-selected root/account (pending Chrome validation)

The Import MBOX and Repair catalog controls now share a single folder root, presented on a dedicated page section selected by the green top-right **Import** button. Recent-folder reuse buttons are gone; the latest selected directory handle and account name are read from the optional browser IndexedDB store and preselected without invoking a permission prompt. Write access is checked when the user explicitly starts an import or previews a repair. A relative folder/root name is displayed because browser directory handles do not expose an absolute filesystem path. The changed-folder flow invalidates an older repair preview. `node tests/recent-target-node.cjs` simulates these workflows and ensures Browse links stay clickable. Full Chrome/Edge file:// storage and File System Access validation is still required.

## Legacy reader upgrade and consistent import UI (native browser verification pending)

The default-checked Browse image preference only affects HTML pages generated with the current reader. Added a separate previewed **Update saved email reader controls** action in the Import catalog-repair area. It upgrades only saved HTML pages with the exact known legacy inline reader script and matching CSP hash, preserving message body, metadata, attachments and original EML, and does not rebuild catalogs. `node tests/reader-node.cjs` checks the legacy hash, unchanged message body, idempotence and rejection of an unknown script. Import notices and progress are above the forms. Filter columns are 4 equal widths with the full-size search field spanning 2 columns; date inputs use equal smaller widths. Real Chrome/Edge tests with a **backed-up archive** remain important.

## Brick-red light and charcoal/orange dark theme (native browser verification pending)

A compact theme switch is displayed at the upper right of the archive header and Guide. Both pages share `assets/theme.js`, which applies the remembered theme before styling and saves the choice in optional localStorage. Light mode uses light cards/brick accents; dark mode uses charcoal panels and orange accents. Messages remain unmodified, preserving their sender styling. `node tests/theme-node.cjs` tests palette coverage, accessibility labels, remembered state and storage-blocked fallback. Please confirm colors and responsive layout in a real Chrome/Edge browser before considering the UI fully verified.

## Self archive defaults and shared status region (manual Chrome verification pending)

The current viewer's own archive is displayed as the default target. IndexedDB folder handles and account choices are keyed by `index.html` location; legacy global "last" keys are ignored, and selecting a different destination does not replace the next-startup self default. Without a previously granted directory handle, browser security requires the user to choose the archive root manually once. `tests/recent-target-node.cjs` includes two synthetic viewer instances to guard against cross-archive settings leakage.

Import progress now appears after the import form and before catalog repair. Catalog scan and rebuild status use a sibling activity panel at the same position. The light header subtitle has increased contrast and Clear filters is rendered as a normal outlined button. The old saved-reader update UI and its unused implementation were removed; newer imported messages already contain the current reader controls. No stored HTML, catalog or attachments are changed by applying this interface update.

Safe recovery test: copy the full archive, rename **both** `__email_archiver/assets/catalog/archive.js` and `archive.previous.js` to `.bak`, leaving all account subfolders and HTML intact. Missing-catalog load warning is expected. On that copy, manually grant the correct parent root, preview Rebuild catalog, rebuild, reopen its index.html, and verify the count and search. A non-destructive reindex test needs no renaming.
