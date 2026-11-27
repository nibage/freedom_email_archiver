# Technical details

[Back to README](../README.md) · [Offline user guide](../GUIDE.html)

This document describes how the portable application stores, reads and maintains archived email. The user-facing quick start is in the README and Guide.

## Directory structure

```text
freedom_email_archiver/
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

There is **no folder selection for another data root**. Copy or move the **whole `freedom_email_archiver/` folder** between Windows/Linux/pCloud installations. All accounts always remain inside its `archived_emails/` subfolder. A second independent archive can be created by **manually copying the complete application folder** to another location.

## Reading and searching mail

Open `index.html` directly in Chrome or Edge. The local catalog and its search shards are loaded from relative JavaScript files under `archived_emails/`; this works under `file://` **without a server, browser-profile database or a folder permission dialog**. Searches use the saved indexes, not all individual messages.

Click a message to read it. It opens its standalone HTML in the same tab, with relative attachments and image controls, whether or not archive access has been granted. Back to archive or normal browser Back returns to the list. Current message shells respect light/dark mode and saved CID images; older saved pages may retain their original appearance. Imported sender scripts are removed and current message pages enforce a restrictive content security policy. External images automatically load according to the checkbox; turning it off reduces tracking exposure.

## Importing an MBOX

1. Before importing or scanning existing files for the first time, click **Enable archive access**. Chrome/Edge will ask you to select the **folder containing the opened `index.html`** (for example `freedom_email_archiver/`), **not** the MBOX and **not** the `archived_emails/` subfolder. This is a one-time authorization for reading/writing `archived_emails/`, not a separate data-root choice.
2. Choose one or more MBOX files through the MBOX file selector, and select an existing account or **+ New account…**.
3. Click **Start import**. Once the archive is authorized, it begins processing without opening another folder/file picker. If authorization is missing or expired, a clear status asks you to use **Enable archive access**; it never silently launches a chooser.
4. Import reads the selected MBOX and the saved metadata catalog for deduplication, then adds messages to `archived_emails/<account>/`. It does not scan all saved HTML, repair indexes or update old message appearance first. Source MBOX files are never modified. If the catalog is damaged, use **Rebuild index** explicitly before retrying.
5. Go back to Browse. New messages appear in this **same** application; there is no second `index.html` to open.

The one-time operating-system permission picker **cannot safely be bypassed by a local HTML page** and is used only by **Enable archive access**, never by **Start import**, **Check existing** or **Rebuild index**. It grants access to the application directory; it is not a data-root selector. Chrome does not disclose an absolute filesystem path to the page, so the application checks the folder's name and files rather than claiming to verify the absolute path.

## Automatic account synchronization

On startup and when archive access is enabled, the application enumerates account directories and reconciles the main manifest. Removed accounts are dropped from the current and backup manifests under the existing exclusive writer lock. The surviving metadata/search shards and all saved HTML, attachments and EML files remain untouched. Unique message counts come from per-account index pointers or metadata, not summed shard lengths (label updates can repeat a message ID).

Each account can contain `catalog/account-index.json`, a small pointer to its currently published metadata/search shards. The app creates or updates it after a successful catalog load with write access, including after imports and rebuilds. Existing archives get these pointers on the first authorized synchronization. Copied accounts with a valid pointer are checked against their metadata, search shards and saved filenames without reading message bodies. Older accounts without a pointer can be adopted only if the existing shards are unambiguous and cover exactly the saved message filenames; old overlapping or incomplete shards require an explicit rebuild. Renamed accounts are not automatically rewritten because the stored paths and embedded account IDs must remain consistent.

No change means no catalog write. Without write access, the app uses an in-memory view and skips unavailable indexes. A failed or busy writer leaves reconciliation deferred; existing messages remain readable where possible. If an account folder is temporarily absent because of a sync service, its files are not deleted by the app; restoring a complete indexed folder allows it to be adopted again. Ensure synced files are available offline before writing.

## Copying, replacing or merging saved email folders

To move mail without its original MBOX, make a complete backup, then copy the account directories (for example `personal/`, `work/`) **into `archived_emails/`**. You may replace the entire `archived_emails/` directory to swap to another mail library. When merging folders, preserve existing files and resolve any Windows file-copy name conflicts carefully rather than blindly overwriting them.

The operations are independent:

| Action | Reads | Changes |
| --- | --- | --- |
| **Start import** | Selected MBOX files and saved catalog | New messages/attachments, necessary duplicate label/EML metadata and incremental indexes |
| **Check existing** | Saved HTML, catalog and attachment/EML references in archived_emails/ | Nothing; no writer lock |
| **Rebuild index** (formerly Reimport only existing) | Saved HTML physically present under all accounts | Catalog and text-search indexes only |

After copying, removing or merging account folders, use **Rebuild index** with no MBOX selected. It adds copied messages and drops stale catalog references without modifying or deleting saved HTML, attachments or EML files. The old catalog stays published until the replacement validates; an incomplete or invalid rebuild is not published. This operation works even when no old message appearance needs updating.

**Check existing** makes one read-only pass through saved HTML and validates catalog/search shards and local attachment/original references. It reports unindexed messages, stale catalog references, malformed/unreadable HTML and missing files. It does not silently repair anything or inspect the appearance version. Both Check existing and Rebuild index count saved HTML filenames and display processing progress without rewriting message files. Folder authorization is still required to enumerate local directories; the action never opens a new picker.

A healthy normal MBOX import does not inspect unrelated HTML or run either maintenance operation. Its existing catalog preserves earlier indexed mail omitted from a new export. Changes inside existing accounts become visible after an explicit index rebuild; whole-account additions and removals are reconciled automatically when possible. Duplicate messages with older appearance are skipped too. A changed label or optional EML retention may still update that particular duplicate's metadata.

### Recovering saved emails without an index

If you have saved email HTML files and attachments but no working catalog, back them up first. Copy only the email account folders into `freedom_email_archiver/archived_emails/`, keeping their year/month, attachment and EML subfolders. Open `freedom_email_archiver/index.html`, click **Enable archive access**, select the application folder and choose **Rebuild index**. The app creates a fresh catalog from the saved HTML without changing the messages.

## Backup and browser support

Back up the **whole `freedom_email_archiver/` tree**: `index.html`, `assets/`, `archived_emails/`, optional EML files and all catalogs. Wait for synced folders to be fully available offline before importing. No login, CDN, telemetry, cloud API or server is needed. The data is **not encrypted**, so keep private backups protected.

Chrome/Edge desktop is required for local MBOX import and filesystem catalog rebuilding. Reading already indexed HTML and catalogs uses ordinary local classic scripts and relative paths, but Firefox/Safari have not been fully verified. A message is limited to 64 MiB. Large imports are streamed, and complex HTML may differ from Thunderbird after sanitization. Keep the source MBOX separately for high-fidelity source preservation or signature verification.

## Development

See [Testing and verification](../tests/VERIFICATION.md) for automated tests, test fixtures and screenshot capture. The production app loads its local source files directly; no build or installation is required.

## Original message preservation

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

## Writer lock and cancellation

Import and full rebuilding use bounded, cancellable writer acquisition. If another process or sync drive stalls the lock for 30 seconds, the action reports a lock timeout instead of waiting indefinitely; a lock that resolves after cancellation is closed. Import does not perform pre-import HTML recovery. The Stop controls are specific to each operation.

The exclusive writer uses `archived_emails/archive.lock`. The file may remain after the writer is released; its existence alone does not mean a lock is held. This is not a distributed lock across synced computers.
