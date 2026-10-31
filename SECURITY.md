# Security model

Treat messages as untrusted input. The importer uses vendored DOMPurify with an explicit HTML element/attribute allow-list, additional URL/CID restrictions and an output Content Security Policy. It does not insert message bodies into the live application DOM. UI metadata is assigned through textContent. Message links open with noopener/noreferrer.

Remote content is removed by default. The app has no networking or telemetry functionality. Deliberately clicking an external link may open a website. Attachments remain arbitrary files, not antivirus-verified documents; active extensions receive `.download`. Encrypted mail is not decrypted.

Catalog scripts are trusted generated archive data. Do not replace the application's scripts or catalogs with untrusted code. The archive is plain text and ordinary files, not encrypted storage.

The exclusive file writer is a local concurrency guard. It is not a distributed lock between cloud-synced computers. Backup after a completed or safely stopped import, and keep previous backups.

Do not publish private email data, logs or index shards in a Git repository. Use a separate archive root outside this checkout. If reporting a bug, use synthetic fixtures and remove personal data from diagnostics. No security contact address or hosted service is assumed by this project.
