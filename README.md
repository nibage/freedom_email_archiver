# Email Archive

A portable, offline email archive for exported MBOX files. Open `index.html` directly in a desktop browser. No server, account, CDN, cloud API or browser-profile database is required.

**This repository contains only four fictional example messages.** Names, addresses and attachments are made up; email addresses use the reserved `.invalid` domain.

## Try it

Download and extract the repository ZIP, then open `index.html` locally. Search for `orchard`, filter by `Travel`, or open **A tiny trip plan** to see a CID image and a text attachment. A GitHub source-code page is not the archive viewer.

For your real mail, select a **separate folder outside this repository** in the Import MBOX tab. Never import private mail into a checkout you intend to publish. The application copies its required files into the destination folder. You can then use that destination's `index.html` independently.

### Two different folder choices

- **Account folder inside the archive**, for example `personal`, is the name of a subfolder and the scope of deduplication. It is not a disk path.
- **Archive root folder** is the folder you choose using the system picker. Select the folder containing `index.html`, or an empty folder. Do not select the account subfolder itself.

Example: selecting an archive root named `MyMail` and entering `personal` creates `MyMail/personal/2025/2025-01/…`.

## Import and update

1. Use desktop Chrome or Edge with the File System Access API.
2. Choose an account folder, choose the archive root, then select one or more MBOX files. Thunderbird files without an extension are accepted. Extract Takeout ZIP files first.
3. Check free disk space yourself, then start the import and keep the tab open.
4. Open `index.html` in the destination folder when finished.

Use the same archive root and account for later overlapping exports. Existing mail is retained. Gmail labels are merged as a union. The same Message-ID with different content remains a separate message. Reimporting the same input does not add messages or attachments.

Use Stop to commit the current batch. After a crash, reimport the source from the beginning: previously committed messages are recognized. Source files are never modified. Run only one writer per archive, including across cloud-synced computers.

## Reading, backup and cloud storage

Copy the **whole archive folder**, including `assets`, both manifests and all account folders. On another computer, make the files available locally and open `index.html`. A cloud provider's web preview is not a supported runtime. For offline use, mark the complete folder as available offline and wait for synchronization to finish.

Backing up after a completed or safely stopped import avoids inconsistent copies. The archive is not encrypted. Do not publish your real archive to GitHub, GitHub Pages or a public cloud share.

## Files and data

```text
index.html                   application interface
assets/                      local source, styles and vendored libraries
archive.js                   generated current manifest (data)
archive.previous.js          generated previous manifest (data)
archive.lock                 import coordination file, no message content
example/
  catalog/                   generated metadata and search indexes
  2025/2025-01/
    email-<sha256>.html       standalone message
    attachments/             ordinary attachment files
  unknown-date/              messages with missing or invalid dates
examples/                    fictional source MBOX fixtures
```

The `.js` extension of catalog files permits loading data through classic scripts under `file://`; it does not make those files application source code. The app does not use `fetch()` to read local JSON or ES modules.

**Dropping an HTML/EML file into a folder does not register it.** The viewer reads the catalog and search indexes. Add messages through the importer. Automatic directory scanning, manual registration and index rebuilding from arbitrary HTML are not implemented.

## Browser support and limits

- Desktop Chrome: the underlying implementation was tested with native directory selection and file writes. This English package has additional automated offline browser and import-engine tests; see `tests/VERIFICATION.md`.
- Desktop Edge: targeted via the same File System Access API, not independently tested here.
- Firefox and Safari: reading is intended to use standard local HTML and classic scripts; not independently verified for this release. Import is not supported without the required filesystem API.
- Cross-platform paths use relative links and ASCII attachment storage names. Linux was not tested on the Windows development machine.
- MBOX is read in 1 MiB chunks, with one message parsed at a time. The per-message limit is 64 MiB. A single line over 64 MiB ends that source file with an error. MIME and decoded DOM representations can consume considerably more memory; allow sufficient RAM.
- Creating many thousands of separate files through the browser can take hours. Search scans prebuilt text shards, not individual message HTML files; the first query on a large archive can take several seconds.
- Dates are grouped by UTC year/month. Local display time can differ. Missing/invalid dates use `unknown-date`.
- MBOX envelope detection validates a date-shaped separator and following headers, supports mboxrd escaping and verified Content-Length boundaries. Unescaped body text that exactly impersonates a full MBOX envelope and header block is inherently ambiguous.
- Original CSS and active content are removed. This is a readable archive, not a byte-for-byte preservation copy of all transport headers, MIME structure or signatures. Retain your source MBOX separately for full fidelity.
- Binary attachment contents are not full-text indexed. Encrypted messages are not decrypted. Embedded-message previews are bounded to three levels.
- Catalog segments are append-only; automatic compaction and deletion are not implemented.
- The supported import workflow is MBOX. EML, Maildir, PST/OST and MSG are not advertised as supported formats.

## Development

No build step is required to run the app. The readable application source is `assets/core.js`, `assets/app.js`, `assets/style.css` and `index.html`.

After changing application files or `GUIDE.html`, run `node scripts/build-bundle.cjs`. This refreshes `assets/bundle.js`, the self-contained installer payload used when importing into a new empty folder. It includes application files only, never the example or private email catalog.

Run `node scripts/check-public.cjs` before publishing. It rejects unexpected top-level folders, non-example catalog accounts and private-looking filesystem paths. This is an additional check, not a substitute for reviewing what you commit.

Open `tests/index.html` in Chrome/Edge to run import tests in a separate empty folder. `examples/example.mbox` contains the four bundled messages. `examples/overlap.mbox` demonstrates one duplicate with updated labels and one new message.

## License

Application code: MIT, see `LICENSE`. Vendored libraries retain their own licenses: PostalMime 4.2.0 (MIT-0) and DOMPurify 3.4.17 (Apache-2.0 OR MPL-2.0). See `THIRD_PARTY_NOTICES.md` and the license files in `assets`.
