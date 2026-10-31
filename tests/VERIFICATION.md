# Verification of the English example release

Tested using Chrome 155.0.8059.81 on Windows, opening local `file://` pages with networking disabled. No local HTTP server or file-origin security override was used.

- **20 import-engine checks passed.** First import, repeat without additional files, overlap, label merging, preservation of earlier messages, English catalog/unknown-date paths, standalone headers, CID links, ASCII attachment paths, Message-ID collisions, missing IDs, HTML sanitization, cancellation/retry, exclusive writer lock, long folded headers and installation of a completely blank target archive were exercised.
- These English engine tests used the real browser JavaScript with a test filesystem adapter writing actual disk files. They are not a fresh native folder-picker verification. The original implementation had separate native File System Access tests; those private-development logs are deliberately not included in this public package.
- **14 browser UI checks passed.** Four examples loaded, English page/message labels rendered, body/accent search and label/date filters worked, the CID image loaded, the text attachment opened, messages contained no scripts, and a relocated copy worked in a new offline browser context. Zero HTTP(S) requests and JavaScript errors were observed.
- The installer payload was verified to create a zero-message archive. It does not embed the example catalog or message contents.
- Publication checks confirm the shipped manifest has only the `example` account with four fictional messages. Example addresses use `.invalid`. No private-account tree, user-home paths or personal import logs are included.

Machine-readable results are `engine-results.json` and `browser-results.json`. The screenshot shows fictional data only. Open `tests/index.html` in Chrome/Edge and choose a separate test folder to rerun the native integration tests yourself; the installer check is part of the automated test setup, not that manual page.

Edge, Firefox, Safari and Linux were not independently tested for this English package. See the main README for supported APIs and limits. No test result is a guarantee against all malformed mail or abrupt hardware failure.
