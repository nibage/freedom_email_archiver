# Freedom Email Archiver

A self-contained, offline archive of exported MBOX email. **The application always uses its own `archived_emails/` folder.** It never selects a different data root, copies itself into another folder or runs a server.

The public repository ships four fictional demonstration messages and their attachments under `archived_emails/example/`, with the demonstration catalog under `archived_emails/catalog/`. Do not put real mail in a Git checkout you publish.

## Directory structure

```text
email_archiver_root/
├── index.html                 ← Double-click this to read
├── GUIDE.html
├── assets/                    ← Application code, styles, icons
└── archived_emails/           ← All authoritative mail data
    ├── catalog/
    │   ├── archive.js         ← Current searchable manifest
    │   └── archive.previous.js
    ├── example/                ← Four fictional demonstration messages
    │   ├── catalog/
    │   └── 2025/
    ├── personal/
    │   ├── catalog/           ← Metadata and search shards
    │   ├── 2024/
    │   └── 2025/
    │       └── 2025-01/
    │           ├── email-<stable-id>.html
    │           ├── attachments/
    │           └── originals/  ← Optional EML copies
    ├── work/
    │   ├── catalog/
    │   └── 2026/
    └── archive.lock           ← Created during a write operation
```

There is **no folder selection for another data root**. Copy or move the **whole `email_archiver_root/` folder** between Windows/Linux/pCloud installations. All accounts always remain inside its `archived_emails/` subfolder. A second independent archive can be created by **manually copying the complete application folder** to another location.

## Reading mail

Open `index.html` directly in Chrome or Edge. The local catalog and its search shards are loaded from relative JavaScript files under `archived_emails/`; this works under `file://` **without a server, browser-profile database or a folder permission dialog**. Searches use the saved indexes, not all individual messages.

Click a message to read it. Without a granted folder handle, it opens its standalone HTML with its relative attachments and image controls; normal browser Back returns to the list. After the application folder is authorized during a write operation, the integrated sandboxed same-tab viewer is also available. The message shell respects light/dark mode and saved CID images, while sender scripts are blocked. External images automatically load according to the checkbox; turning it off reduces tracking exposure.

## Importing an MBOX

1. Before importing or scanning existing files for the first time, click **Enable archive access**. Chrome/Edge will ask you to select the **folder containing the opened `index.html`** (for example `email_archiver_root/`), **not** the MBOX and **not** the `archived_emails/` subfolder. This is a one-time authorization for reading/writing `archived_emails/`, not a separate data-root choice.
2. Choose one or more MBOX files through the MBOX file selector, and select an existing account or **+ New account…**.
3. Click **Start import**. Once the archive is authorized, it begins processing without opening another folder/file picker. If authorization is missing or expired, a clear status asks you to use **Enable archive access**; it never silently launches a chooser.
4. Import reads the selected MBOX and the saved metadata catalog for deduplication, then adds messages to `archived_emails/<account>/`. It does not scan all saved HTML, repair indexes or update old message appearance first. Source MBOX files are never modified. If the catalog is damaged, use **Rebuild index** explicitly before retrying.
5. Go back to Browse. New messages appear in this **same** application; there is no second `index.html` to open.

The one-time operating-system permission picker **cannot safely be bypassed by a local HTML page** and is used only by **Enable archive access**, never by **Start import**, **Check existing** or **Rebuild index**. It grants access to the application directory; it is not a data-root selector. Chrome does not disclose an absolute filesystem path to the page, so the application checks the folder's name and files rather than claiming to verify the absolute path.

## Copying, replacing or merging saved email folders

To move mail without its original MBOX, make a complete backup, then copy the account directories (for example `personal/`, `work/`) **into `archived_emails/`**. You may replace the entire `archived_emails/` directory to swap to another mail library. When merging folders, preserve existing files and resolve any Windows file-copy name conflicts carefully rather than blindly overwriting them.

The operations are independent:

| Action | Reads | Changes |
| --- | --- | --- |
| **Start import** | Selected MBOX files and saved catalog | New messages/attachments, necessary duplicate label/EML metadata and incremental indexes |
| **Check existing** | Saved HTML, catalog and attachment/EML references in archived_emails/ | Nothing; no writer lock |
| **Rebuild index** (formerly Reimport only existing) | Saved HTML physically present under all accounts | Catalog and text-search indexes only |
| **Update message appearance** under Optional appearance maintenance | Saved HTML reader shells | Recognized old message shells only; original body bytes and attachment files are preserved |

After copying, removing or merging account folders, use **Rebuild index** with no MBOX selected. It adds copied messages and drops stale catalog references without modifying or deleting saved HTML, attachments or EML files. The old catalog stays published until the replacement validates; an incomplete or invalid rebuild is not published. This operation works even when no old message appearance needs updating.

**Check existing** makes one read-only pass through saved HTML and validates catalog/search shards and local attachment/original references. It reports unindexed messages, stale catalog references, malformed/unreadable HTML and missing files. It does not silently repair anything or inspect the appearance version. Folder authorization is still required to enumerate local directories; the action never opens a new picker.

A healthy normal MBOX import does not inspect unrelated HTML or run either maintenance operation. Its existing catalog preserves earlier indexed mail omitted from a new export. Manual filesystem changes become visible after an explicit index rebuild. Duplicate messages with older appearance are skipped too; choose optional appearance maintenance if desired. A changed label or optional EML retention may still update that particular duplicate's metadata.

### Recovering from a deleted `__email_archiver` folder

If you still have `account/year/month/email-*.html` files and attachments from an older archive but deleted its separate `__email_archiver/` program/index folder, first back them up. Place **only the account folders** inside the new `email_archiver_root/archived_emails/` folder, retaining year/month and attachment subfolders. Do not copy an old root-level app or `__email_archiver/` into the new app. Then open the new `index.html`, click **Enable archive access** once, and choose **Rebuild index**. It reconstructs a fresh catalog from the saved HTML, or explains if damaged files prevent recovery.

## Backup and browser support

Back up the **whole `email_archiver_root/` tree**: `index.html`, `assets/`, `archived_emails/`, optional EML files and all catalogs. Wait for synced folders to be fully available offline before importing. No login, CDN, telemetry, cloud API or server is needed. The data is **not encrypted**, so keep private backups protected.

Chrome/Edge desktop is required for local MBOX import and filesystem catalog rebuilding. Reading already indexed HTML and catalogs uses ordinary local classic scripts and relative paths, but Firefox/Safari have not been fully verified. A message is limited to 64 MiB. Large imports are streamed, and complex HTML may differ from Thunderbird after sanitization. Keep the source MBOX separately for high-fidelity source preservation or signature verification.

## Development

The project uses Node test fixtures containing only fictional email. GitHub Actions checks standalone email rendering, MBOX deduplication, full catalog recovery, fixed-root permission behavior and the absence of app self-copying. `assets/bundle.js` is a dormant legacy source bundle and is **not loaded or copied**. Manual Chrome/Edge tests on Windows and a backed-up real archive are still necessary.

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

The **Rebuild index** tool preserves valid EML references from self-describing HTML, reports missing original files, and does not rewrite EML content. Keep source MBOX backups if cryptographic evidence matters. Always test on a copied archive before a large private import.

### Browser regression checks

The browser flow test opens the actual local index.html with networking disabled, clicks its controls and uses a disposable on-disk filesystem adapter. It covers old HTML without embedded metadata after authorization, CID images, first/repeated/overlapping imports, full-text search, Check existing, catalog rebuilding, rapid Start clicks, cancellation, manual folder merges, read-only file integrity and independent appearance maintenance. It also executes the 75-check browser import-engine suite. The adapter is test-only: production import still uses the native File System Access API and still requires explicit folder authorization.

For development only, install Playwright and its Chromium binary, then run:

```sh
npm install --no-save --package-lock=false playwright@1.62.1
npx playwright install chromium
node tests/browser-flow.cjs
node tests/writer-lock-node.cjs
```

Set CHROME_PATH to use an installed Chrome executable instead of Playwright Chromium. No Node or Playwright installation is required to use the archive. Tests create only fictional data in a temporary directory.

Import and full rebuilding use bounded, cancellable writer acquisition. If another process or sync drive stalls the lock for 30 seconds, the action reports a lock timeout instead of waiting indefinitely; a lock that resolves after cancellation is closed. Import does not perform pre-import HTML recovery. The Stop controls are specific to each operation.
