# Email Archive

A portable, offline email archive for exported MBOX files. Open the archive's `__email_archiver/index.html` (or the legacy root `index.html`) directly in a desktop browser. No server, account, CDN, cloud API or browser-profile database is required.

**This repository contains only four fictional example messages.** Names, addresses and attachments are made up; email addresses use the reserved `.invalid` domain.

## Try it

Download and extract the repository ZIP, then open `index.html` locally. Search for `orchard`, filter by `Travel`, or open **A tiny trip plan** to see a CID image and a text attachment. A GitHub source-code page is not the archive viewer.

For your real mail, click the **green Import button** and select a **separate folder outside this repository** in the import workspace. Never import private mail into a checkout you intend to publish. For a new destination, the application installs its viewer under `__email_archiver/`. Open that folder's `index.html` independently. Previously created root-level viewers remain supported.

### Two different folder choices

- **Account folder inside the archive**, for example `personal`, is the name of a subfolder and the scope of deduplication. It is not a disk path.
- **Archive root folder** is the parent folder containing `__email_archiver/` and your account folders, or an empty folder for a new archive. Old archives with a root-level `index.html` remain supported. Do not select `__email_archiver/` or the account subfolder.

Example: selecting an empty archive root named `MyMail` and entering `personal` creates `MyMail/__email_archiver/index.html` and `MyMail/personal/2025/2025-01/…`.

## Import and update

1. Use desktop Chrome or Edge with the File System Access API.
2. Choose an account folder, choose the archive root, then select one or more MBOX files. Thunderbird files without an extension are accepted. Extract Takeout ZIP files first.
3. Check free disk space yourself, then start the import and keep the tab open.
4. Open `__email_archiver/index.html` in a new destination when finished, or the existing root-level `index.html` for a legacy archive. Selecting a root in the importer also refreshes the visible account counts, but individual messages should be opened from the destination viewer.

Use the same archive root and account for later overlapping exports. The optional EML policy can preserve signed/encrypted, Starred and Important messages; reimporting the same MBOX automatically refreshes the HTML appearance of existing messages with the current safe renderer. Existing mail is retained. Gmail labels are merged as a union. The same Message-ID with different content remains a separate message. Reimporting the same input does not add messages or attachments, but it does refresh their saved HTML and may take longer.

Use Stop to commit the current batch. After a crash, reimport the source from the beginning: previously committed messages are recognized. Source files are never modified. Run only one writer per archive, including across cloud-synced computers.

## Incremental import and legacy messages

New imports automatically generate self-contained HTML messages with the current image loading and navigation controls. The experimental **Update saved email reader controls** section has been removed from the interface. If older saved emails lack these features, reimport the original MBOX into the same account on a backed-up archive; their saved HTML is now refreshed automatically. Rebuilding the search catalog alone does **not** change HTML reader scripts.

The import form is followed immediately by an **activity panel** for import progress or catalog-repair progress. The next section below it is **Rebuild the catalog**. The Browse filters use four equal-width columns: Search spans two, From/To dates have matching smaller sizes, and **Clear filters** is a normal button.

## Light and dark interface themes

Use the **Dark mode / Light mode** switch in the top-right header of the offline archive. Light mode follows the brick-red and soft-grey palette; dark mode uses charcoal panels and an amber/orange accent. The selected mode is kept in the browser's local storage when available, so opening the same archive again retains your choice. If the browser disables local storage, the switch still works for the currently open page. The offline Guide follows the same setting.

The theme changes **only the archive application and its Guide**, not the original HTML contents of saved emails. This is deliberate: the archived messages retain their own fonts, colors and formatting so they remain human-readable without any special program. No email content, attachments, search catalog, or archive directory structure is modified when switching themes.

## Reading preferences and navigation

The Browse archive toolbar has **Load external images automatically** checked by default. For messages generated with this reader version, links from the archive open the message with remote images loaded automatically when online. Uncheck it to keep remote images blocked and use the per-message **Load external images** button instead. External image requests can disclose your IP address and email-open tracking identifiers to remote services; uncheck the option for privacy-sensitive messages. A direct standalone `email-*.html` opening without the viewer's preference parameter remains blocked by default.

The preference uses optional tab-scoped browser session storage, not the mail catalog or private cloud. The viewer remembers the current search filters, page and scroll location when opening a message; the Back link in newly generated message pages uses the browser's previous history entry, and the viewer also offers a session-scoped scroll restoration fallback when an older message opens the catalog through its ordinary link. Browser storage/privacy settings may prevent the fallback; Chrome's Back button remains an alternative. Older already-saved HTML pages do not yet contain the updated image auto-load and history-aware script; restoring those per-message controls requires regenerating their HTML from the MBOX or a separate HTML-only upgrade.

## Unified import and catalog repair

Click the **green Import button in the upper-right navigation** to switch to the import workspace in the **same `index.html`**. The importer and **Repair catalog** are visually separate panels on one page and use one **Import folder root** selection. Click **Browse archive** to return to the list; selecting a target never changes the opened viewer.

The default destination is the archive containing the **currently opened `index.html`** (shown as **Self archive**). The browser stores a remembered directory handle and account choice **separately for each viewer path** in optional IndexedDB. It never silently selects the last folder used by another archive, and selecting a different destination only changes this tab's current target, not its future default. There is no *Use recent archive* button. Click **Import folder root** to grant access to the current archive or to explicitly choose another folder. Changing it invalidates an earlier catalog-repair preview. Chrome cannot derive a filesystem handle or grant write permission from a local HTML page's location alone. If this viewer has not been granted access before, you must choose its root folder once. Chrome may prompt again at **Start import** or **Preview folder scan**.

The app displays its **Self archive** path on first opening (even before directory access), and once permitted its selected root name (`emails/`), viewer path and indexed message count. The File System Access API **does not disclose the absolute local filesystem path** for an arbitrary chosen directory, so the UI does not invent one. Only the folder handle and account name are stored as optional browser preferences; email contents remain in your archive. Browsing remains portable without any browser profile.

To **test recovery** on a duplicate archive without the original MBOX, leave every `email-*.html`, attachment and account catalog intact. Rename `__email_archiver/assets/catalog/archive.js` to `archive.js.bak` and `archive.previous.js` to `archive.previous.js.bak` inside that duplicate, then choose its parent root under Import → Preview folder scan → Rebuild search catalog. For legacy root viewers the manifests are under `assets/catalog/`. A missing-catalog warning before rebuild is expected. You can also delete the entire copied viewer `assets/catalog/` directory to test recreating it. The preview now reads each saved HTML page, validates repairability and reports problems before enabling Rebuild. The standard, non-destructive test is simply to run Rebuild without renaming anything.

Rebuild changes only the catalog inside the currently selected root; it does not move or rewrite HTML messages or attachments. Open that root's own viewer to browse it. Back up the whole archive before any rebuild.

## Reading, backup and cloud storage

Copy the **whole archive root**, including `__email_archiver`, both manifests and all account folders (or `index.html` and `assets` for a legacy archive). On another computer, make the files available locally and open `index.html`. A cloud provider's web preview is not a supported runtime. For offline use, mark the complete folder as available offline and wait for synchronization to finish.

Backing up after a completed or safely stopped import avoids inconsistent copies. The archive is not encrypted. Do not publish your real archive to GitHub, GitHub Pages or a public cloud share.

## Files and data

```text
__email_archiver/
  index.html                 application interface
  GUIDE.html
  assets/                    local application source and libraries
    archive.lock             import coordination file
    catalog/
      archive.js             current manifest (data)
      archive.previous.js    previous manifest (data)
example/
  catalog/                   generated metadata and search indexes
  2025/2025-01/
    email-<sha256>.html       standalone message
    attachments/             ordinary attachment files
  unknown-date/              messages with missing or invalid dates
examples/                    fictional source MBOX fixtures
```

New archives keep generated manifests under `__email_archiver/assets/catalog/`, with year/month HTML pages and attachments in sibling account folders. **Existing archives are not moved automatically**: root-level `index.html`, root-level `archive.lock` and `assets/catalog/` (or older root-level manifests) continue to work and new imports keep their existing layout. New archives keep the lock inside `__email_archiver/`.

The `.js` extension of catalog files permits loading data through classic scripts under `file://`; it does not make those files application source code. The app does not use `fetch()` to read local JSON or ES modules.

**Use the **Repair catalog** tab to scan the year/month folders and rebuild metadata/search shards from existing `email-<sha256>.html` pages. A preview validates every recognized HTML page, lists unreadable/invalid examples and blocks rebuild if it finds errors or duplicate IDs. Rebuild does not rewrite HTML or attachments. HTML generated by this version embeds its own metadata; older standalone pages can recover basic records from readable header fields when possible (without inventing MIME originals). A rebuild cannot restore original MIME bytes or lost formatting. Dropping unrelated HTML/EML files into an archive does not register them.** The viewer reads the catalog and search indexes. Add messages through the importer. Automatic registration of arbitrary manually added HTML/EML messages is not supported.

## Browser support and limits

- Desktop Chrome: the underlying implementation was tested with native directory selection and file writes. This English package has additional automated offline browser and import-engine tests; see `tests/VERIFICATION.md`.
- Desktop Edge: targeted via the same File System Access API, not independently tested here.
- Firefox and Safari: reading is intended to use standard local HTML and classic scripts; not independently verified for this release. Import is not supported without the required filesystem API.
- Cross-platform paths use relative links and ASCII attachment storage names. Linux was not tested on the Windows development machine.
- MBOX is read in 1 MiB chunks, with one message parsed at a time. The per-message limit is 64 MiB. A single line over 64 MiB ends that source file with an error. MIME and decoded DOM representations can consume considerably more memory; allow sufficient RAM.
- Creating many thousands of separate files through the browser can take hours. Search scans prebuilt text shards, not individual message HTML files; the first query on a large archive can take several seconds.
- Dates are grouped by UTC year/month. Local display time can differ. Missing/invalid dates use `unknown-date`.
- MBOX envelope detection validates a date-shaped separator and following headers, supports mboxrd escaping and verified Content-Length boundaries. Unescaped body text that exactly impersonates a full MBOX envelope and header block is inherently ambiguous.
- The renderer preserves a bounded set of safe inline colors, typography, table formatting and supported CSS rules. It still removes active HTML, untrusted scripts, CSS network URLs and unsupported styles. Some complex newsletters will therefore not match Thunderbird exactly. Retain the source MBOX for full fidelity.
- External HTTP(S) images in standalone pages opened directly are **blocked on opening**; archive links honor the checked-by-default remote-image preference. When not auto-loaded, each message with remote images has a **Load external images** button; using it may reveal your IP address or open a tracking pixel. Embedded CID images and bounded inline raster data images remain local and offline.
- To improve messages already imported with the earlier renderer, reselect the original MBOX files. The importer now automatically rewrites their HTML while preserving deduplication, attachment files and Gmail labels. Missing image placeholders describe their likely reason (remote image, missing inline CID attachment, or unsupported source); they do not prove an email is malicious. Without the original MBOX, discarded formatting cannot be reconstructed. Keep a backup before an upgrade.
- Binary attachment contents are not full-text indexed. Encrypted messages are not decrypted. Embedded-message previews are bounded to three levels.
- Catalog segments are append-only; automatic compaction and deletion are not implemented.
- The supported import workflow is MBOX. EML, Maildir, PST/OST and MSG are not advertised as supported formats.

## Development

No build step is required to run the app. The readable application source is `assets/mail-renderer.js`, `assets/eml.js`, `assets/core.js`, `assets/reindex.js`, `assets/app.js`, `assets/style.css` and `index.html`.

After changing application files or `GUIDE.html`, run `node scripts/build-bundle.cjs`. This refreshes `assets/bundle.js`, the self-contained installer payload used when importing into a new empty folder. It includes application files only, never the example or private email catalog.

Run `node scripts/check-public.cjs` before publishing. It rejects unexpected top-level folders, non-example catalog accounts and private-looking filesystem paths. This is an additional check, not a substitute for reviewing what you commit.

Open `tests/index.html` in Chrome/Edge to run import and reindex tests in a separate empty folder. The new sibling-folder viewer layout, same-tab message navigation and stop/resume behavior should also be verified in a real browser before migrating any production archives. `examples/example.mbox` contains the four bundled messages. `examples/overlap.mbox` demonstrates one duplicate with updated labels and one new message.

## License

Application code: MIT, see `LICENSE`. Vendored libraries retain their own licenses: PostalMime 4.2.0 (MIT-0) and DOMPurify 3.4.17 (Apache-2.0 OR MPL-2.0). See `THIRD_PARTY_NOTICES.md` and the license files in `assets`.

### Original MIME data and cryptographic verification

Each newly imported HTML email includes an inert JSON record with decoded message headers, content-type, top-level MIME encoding, attachment hashes/CIDs, labels and indexing metadata. This supports catalog rebuilding from standalone HTML. It is **not an original RFC 5322 email**: MIME boundaries, per-part transfer bytes and any cryptographic signed byte sequence cannot be reconstructed reliably. DKIM signature headers alone do not prove long-term authenticity; S/MIME and PGP/MIME verification need the signed original content, signature and appropriate keys/certificates. Keep the MBOX for legal/evidentiary or signature verification use; this version does not promise byte-for-byte EML preservation. Always back up before catalog repair, and do not run import and repair simultaneously.

## Optional original EML preservation (selected categories)

During MBOX import, the three independent EML retention checkboxes are: **Signed/encrypted** (checked by default), **Gmail Starred** (unchecked by default), and **Gmail Important** (unchecked by default). Each of the optional label checkboxes warns that EML requires additional disk space; Gmail automatically flags many messages Important, so this can increase archive size considerably. Check either or both if needed. These settings apply to new copies written by that import; unticking later does not delete any EML already preserved. HTML reading copies and normal attachment files are always created.

When enabled, a second file is stored only for these categories:

- S/MIME and OpenPGP/MIME signed or encrypted MIME messages (identified by MIME types), plus detected inline PGP signed/encrypted blocks.
- Gmail messages whose `X-Gmail-Labels` includes `Important` or `Starred` (case-insensitive; including backslash-prefixed forms).
- Ordinary **DKIM-only messages do not qualify**: most modern mail is DKIM-signed, so keeping all of them would defeat the space-saving policy.

Example: `personal/2025/2025-03/email-<stable-id>.html` is always readable in a browser, while selected messages additionally have `personal/2025/2025-03/originals/email-<stable-id>.eml`. The HTML links to the source EML and its SHA-256 fingerprint, and embeds the checksum in its inert metadata. This is **not an EML viewer**: download the EML and open it in a mail application if needed.

### Reliability and provenance

The EML is created from the MBOX message **without parsing and re-serializing its headers or MIME content**. The MBOX envelope separator is removed and MBOXrd `>From ` escaping is reversed **only in the message body**. Apart from this restoration, byte sequences, original line endings, transfer encodings and MIME boundaries are retained. The app computes SHA-256, writes the EML, reads it back and verifies the length and checksum **before** writing an HTML/catalog reference. On a repeated overlapping import, existing EML copies are checked and reused rather than duplicated; a missing/corrupt copy is rewritten and verified. If an already archived HTML-only message is later imported with an Important/Starred label, it can gain a companion EML without gaining a duplicate HTML message. A failed EML verification stops that import without falsely marking the EML as preserved. Interrupted imports may leave unindexed/orphan temporary output; retrying the MBOX is designed to recover using stable paths.

**Limits:** The saved EML is a representation extracted from the MBOX, *not necessarily byte-identical to a message as originally transported over SMTP*. Gmail Takeout or Thunderbird may already have modified headers, line endings or MIME data. MBOX delimiter/newline behavior can also affect exact signed bytes. SHA-256 confirms the saved copy's integrity against the recorded checksum; it **does not validate DKIM, S/MIME, or OpenPGP signatures**. Signature/crypto classification is based on recognizable MIME types, PGP armor and Gmail labels, not a complete cryptographic audit. Some signed messages could be missed; select the Important/Starred label or retain the original MBOX for stronger preservation. The 64 MiB per-message limit still applies. This retention policy cannot create EML from HTML alone; use the original MBOX if you want to add original-format copies to an existing archive.

Dependency-free unit checks for EML byte extraction, real SHA-256 verification, corruption handling and selected MIME categories can be run with `node tests/eml-node.cjs` (Node 20+). For full native File System Access import tests, open `tests/index.html` in desktop Chrome/Edge and choose a disposable empty test folder.

The **Repair catalog** tool preserves valid EML references from self-describing HTML, reports missing original files, and does not rewrite EML content. Keep source MBOX backups if cryptographic evidence matters. Always test on a copied archive before a large private import.
