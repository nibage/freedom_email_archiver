# Freedom Email Archiver

A local, offline MBOX email archiver. **The application and email data live in separate folders.** Open the application's `index.html` from a locally available folder, then select one data root using Chrome/Edge's File System Access picker. One running app instance browses and imports into **one selected root** and all its accounts; selecting another root replaces the loaded catalog. The app **never copies `index.html`, `assets/` or a launcher** into your data root.

This public repository contains only fictional example messages. Never import private email into a checkout you plan to publish.

## Structure

```text
Freedom_Email_Archiver/                 <-- app, stored wherever you prefer
  index.html
  GUIDE.html
  assets/                               <-- app JavaScript, CSS, icons

My_Email_Data/                          <-- data root, selected in the app
  catalog/                              <-- new data-only manifest & indexes
    archive.js
    archive.previous.js
  personal/
    catalog/                            <-- message metadata and search shards
    2025/2025-01/
      email-<stable-id>.html
      attachments/
      originals/                        <-- optional saved EML
  work/
    2026/2026-11/
      email-<stable-id>.html
  archive.lock                           <-- created during a write operation
```

**New imports do not install an application copy or create a root `index.html` in the data folder.** Older archives that already contain `__email_archiver/index.html` or a root-level app remain readable in place through their existing catalogs. Nothing is deleted or moved automatically. A second independent app copy can be made **manually**; each copy can remember its own most recently selected data folder in the browser.

## First use and later imports

1. Use desktop Chrome or Edge. Open the **application** `index.html` by double-clicking it. The built-in fictional demo is shown until you select your own data root.
2. Click **Choose data folder** (in Browse or Import). This one folder becomes the active root for **both** tabs. The selection is read-only; it does not create an archive or recursively scan your mail. You may need to reselect the folder if browser permissions are lost.
3. For a new MBOX import, click **Import**, choose the source MBOX files and select an existing account or **+ New account…**. **Start import** safely checks any existing HTML and indexes before importing to the selected account. Source MBOX files are read only; interrupted imports can be retried.
4. Return to **Browse archive** in the same app. Search, filters, account dropdown, and email links now use the selected **data root**, not the directory containing the program.
5. For future overlapping exports, select the same data root and account. Existing messages are retained and deduplicated; Gmail labels are merged. The original MBOX is not deleted.

A root can have any number of email accounts, but one app tab has just one active root. Choosing another folder unloads the old catalog and replaces the visible messages/accounts. A remembered folder handle is a browser preference, **not** the authoritative mail store. All mail, attachments and indexes remain in the selected data root.

## Browsing messages from another folder

The browser's File System Access API does not disclose an absolute Windows path for a selected folder, so constructing a cross-folder `file://` URL is not reliable. The app instead reads saved HTML and attachment files using the selected folder handle and displays the message inside a **sandboxed same-tab viewer**. The iframe has no script permission or same-origin access. Supported inline CID pictures are resolved to temporary local Blob URLs; downloaded attachments and optional original EML copies are local too. Temporary Blob URLs are revoked when leaving the message. Sender-provided JavaScript is not executed.

The application keeps the current search/filter/page when you return from the in-app message viewer. Light/dark theme follows the app; the mail body preserves its saved formatting. **Load external images automatically** is checked by default. Turn it off to avoid remote requests unless you explicitly click **Load external images**. Remote images may identify you to their host; they require connectivity. Unknown or edited saved HTML lacking valid embedded archive metadata is rejected by the integrated reader instead of being executed.

Each `email-*.html` file is also independently readable when opened directly from its data folder; its relative attachments remain there. Its old **Back to archive** link may no longer point to the separate application, so use the application's Browse toolbar for navigation. Existing legacy archived pages remain on disk unchanged.

## Check existing, reimport only existing and catalog recovery

**Check existing** performs the longer **read-only** scan of all selected account folders and existing catalogs, then checks saved HTML appearance. It does not copy application files or write to the selected root.

**Reimport only existing** repairs missing catalog entries and refreshes only recognized old HTML reader shells from saved files; it does **not** need the MBOX. The original saved email body, attachments and EML originals are preserved. A write lock is acquired only when a page needs modification. Use a complete backup before repairs; stop/retry is supported.

**Start import** runs catalog recovery and supported existing-HTML refresh before reading the new MBOX. Once that succeeds, new messages are added to the selected account. Healthy indexes and already-current HTML are not regenerated unnecessarily. The UI shows separate progress for existing saved messages and MBOX import. Only one writer should operate on a data root at once, including across synced devices.

## Backups, portability and privacy

Back up the **entire data root** (account folders, `catalog/`, and any legacy `assets/catalog/` or `__email_archiver/` folders that already exist). Back up the application separately. After moving data to another computer, open an app copy and select that data root. Sync-drive copies must be fully available offline; a cloud provider's website preview is not a runtime. No server, login, telemetry, CDN or cloud API is used.

The application is not an encrypted mail vault: protect the data folder and backups. For archiving correctness, preserve the original MBOX independently, especially for signatures or forensic use. The maximum individual message size is 64 MiB. Long imports are streamed rather than loading the entire MBOX into RAM. Not all complex HTML will match Thunderbird.

**Windows Defender:** the app cannot disable Windows security notifications. Inspect Windows Security → Protection history if Controlled folder access or another rule blocks file writes; do not disable protection or broadly exclude your emails. Folder selection and Check existing are read only.

## Supported browsers and current limits

- **Chrome / Edge desktop:** File System Access API for selecting, browsing, searching and importing data stored outside the app directory. Re-selecting a folder might require renewed browser permission.
- **Other browsers:** standalone saved HTML mail is readable directly, but the app's selected-root workflow requires File System Access support; Firefox/Safari are not verified for external-folder browsing.
- Some older saved mail without valid embedded metadata cannot be loaded in the isolated selected-root viewer, although it remains readable by directly opening the HTML file.
- Sandboxed embedded-message preview links may download as files rather than open inside the viewer. Absolute filesystem links cannot be reconstructed from a directory picker.
- Application source files must be updated in the app directory; updating the app does not silently rewrite data roots. The legacy `assets/bundle.js` is retained for source compatibility but **is not loaded or copied by the app**.

## Development and tests

`node tests/eml-node.cjs`, `node tests/importer-lazy-node.cjs`, `node tests/catalog-sync-node.cjs`, `node tests/data-root-viewer-node.cjs` and the other Node checks exercise saved-mail deduplication, catalog recovery, and cross-folder message isolation. Run `node scripts/build-bundle.cjs` only when maintaining the unused legacy source bundle; it is **not** an installer anymore. GitHub Actions runs the full check suite. Actual Chrome/Edge behavior on Windows/Linux and large synced data roots still requires real-browser validation.

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
