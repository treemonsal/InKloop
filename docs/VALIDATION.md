# Validation

## Automated checks

- Production TypeScript check and Vite static build.
- Model checks: backup roundtrip preserving stroke pressure and submissions; invalid/malformed/duplicate-ID backups; active-page references; safe original chat URLs; erasing through a segment; structured and plain-text AI replies; bilingual handoff prompt preserving exact transcription and sample boundaries.
- DOM integration with Happy DOM and fake IndexedDB: insert a task, write a Pencil stroke, confirm database persistence, undo/redo, create an independent submission snapshot, import transcription/feedback/next task, create a next-task page, preserve the previous submission, and ignore finger contact in Pencil-only mode.
- Profile integration: cancel without replacing earlier references, complete all four samples, persist the complete profile, and keep calibration strokes out of the notebook.
- Static offline bundle: build-specific cache key; full precache of entry modules, lazy Markdown/math modules, styles, WOFF2 fonts, icons and manifest.
- Successful private production deployment, source pushed to both the user's GitHub repository and the Sites source repository. The deployment-generated screenshot was inspected: welcome dialog renders correctly with no visible clipping at its captured 1200 × 750 size.

Canvas geometry and clipboard/Share Sheet are mocked in DOM tests. These tests do not establish physical Pencil latency, Safari palm behavior, real image paste into the original apps, iPadOS Home Screen installation, actual offline browser behavior or visual layout at every breakpoint. Those require browser/device testing. No real handwriting recognition quality or accuracy rate is claimed.

## Private MCP bridge

Server tests exercise authenticated upload, workspace publication, inline image retrieval, per-user isolation, origin rejection, response writes, task delivery, stable event cursors, and MCP discovery. Model-provider calls are absent. Real ChatGPT plugin installation/tool discovery and hosted R2 provisioning are verified separately during publication.

## Free original-chat workflow

No external AI requests, API keys, paid replacement model or credential harvesting are present. Users explicitly transfer a generated PNG and prompt into the original provider and copy the reply back. Normal subscription and image-upload limits remain applicable. The ChatGPT MCP plugin exchanges explicitly submitted images, tasks and responses. It does not automatically send messages to or scrape existing chat interfaces. Claude remains a manual handoff.

## Repository naming

The application and installed PWA are named Inkloop. Source is in the user-provided repository `treemonsal/3d-Zimmer`; the connected GitHub toolset supports content and Git updates but has no repository rename operation. The CLI's GitHub API access is forbidden in this environment. Git pushes to the existing repository succeeded. No repository-name change is claimed.
