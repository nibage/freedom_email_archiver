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
