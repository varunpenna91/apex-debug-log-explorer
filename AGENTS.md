# AI Agent Instructions

You are assisting on **Apex Debug Log Explorer**, a local-first Salesforce Apex debug log visualizer with a React/Vite frontend, Electron desktop shell, and VS Code extension.

## Startup Checks

- Always verify the current workspace and branch before work:

```bash
pwd
git status --short --branch
```

- Prefer `rg` and `rg --files` for code and file searches.
- This repo currently does not contain `docs/ai-workflow.md`, `docs/apex-standards.md`, or `docs/testing-standards.md`. If those files are added later, read the relevant one before planning or editing.
- Do not guess Salesforce parser behavior. Check the sample logs, parser code, and rendered UI before changing log semantics.

## Project Shape

- Main app: `src/App.tsx`
- Salesforce log parser: `src/lib/salesforceLogParser.ts`
- Electron shell: `electron/main.mjs`, `electron/preload.cjs`
- VS Code extension: `extensions/vscode-apex-debug-log-explorer`
- Public screenshots: `docs/media`
- Desktop packaging docs: `docs/packaging/desktop-installers.md`
- VS Code publishing docs: `docs/publishing/vscode-marketplace.md`
- Release notes source: `docs/releases`

## Common Commands

```bash
npm run build
npm run desktop
npm run vscode:package
npm run security:audit
```

Use `npm run vscode:package` before testing or installing a local VSIX. The generated VSIX is written to `release/apex-debug-log-explorer-<version>.vsix`.

## Privacy And Release Media

- Never commit raw Salesforce debug logs, customer/company log data, PATs, org IDs, emails, real class names, real Flow names, or screenshots captured from unsanitized logs.
- Public screenshots must be generated from sanitized logs only.
- Use the sanitizer before public screenshot capture:

```bash
node scripts/sanitize-debug-log-for-media.mjs /path/to/source.log /tmp/sanitized-apex-debug.log
```

- Check screenshots visually before committing. The expected public placeholders are names such as `ApexClass`, `CustomObject`, `FlowItem`, `BusinessToken`, and generic Salesforce standard objects like `Case`.
- If VS Code Marketplace or GitHub renders an old screenshot, update the Marketplace README image URLs with a version query string such as the current release version and publish a patch version. Marketplace and VS Code cache image URLs aggressively.

## Versioning And Publishing

- Keep the root `package.json`, `package-lock.json`, and `extensions/vscode-apex-debug-log-explorer/package.json` versions aligned.
- Bump the extension version for Marketplace-facing README or metadata changes. Marketplace may not refresh content without a version publish.
- Marketplace publisher id: `penna-vibe-code-apps`.
- Extension id: `penna-vibe-code-apps.apex-debug-log-explorer`.
- GitHub repo: `https://github.com/varunpenna91/apex-debug-log-explorer`.
- VS Code Marketplace URL: `https://marketplace.visualstudio.com/items?itemName=penna-vibe-code-apps.apex-debug-log-explorer`.
- Publish through the GitHub Actions workflow `Publish VS Code Marketplace` when possible. It uses the GitHub secret `VSCE_PAT`.
- Do not print, store, or commit PAT values. If a token appears in chat or logs, recommend rotation.
- After publishing, `vsce show` and VS Code may lag behind the workflow logs. Trust the workflow log if it says `Published ... vX.Y.Z`, but tell the user Marketplace propagation can take a few minutes.

## VS Code Extension Notes

- The extension reads local `.log` and `.txt` files and sends `{ fileName, text, sourceUri }` to the bundled webview.
- Supported entry points:
  - Command Palette: `Apex Debug Log Explorer: Open Log`
  - Command Palette/current file: `Open with Apex Debug Log Explorer`
  - Explorer context menu for `.log` and `.txt`
  - Editor right-click menu for open `.log` and `.txt`
- When the webview opens, the extension intentionally runs `workbench.action.closeSidebar` so the graph has more room.
- If the user cannot see a newly published version, install the local VSIX directly:

```bash
code --install-extension "/absolute/path/to/release/apex-debug-log-explorer-<version>.vsix" --force
```

Then ask them to run `Developer: Reload Window` in VS Code.

## Desktop Packaging Notes

- Current macOS desktop builds are ad-hoc signed, not Apple Developer ID signed or Apple-notarized.
- macOS Gatekeeper may show:
  - `"Apex Debug Log Explorer.app" is damaged and can't be opened`
  - `Apple could not verify "Apex Debug Log Explorer.app" is free of malware`
- For local/private installs, users can open via Privacy & Security > Open Anyway, or clear quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/Apex Debug Log Explorer.app"
open "/Applications/Apex Debug Log Explorer.app"
```

- For broad public desktop distribution, recommend Apple Developer ID signing + notarization and Windows code signing.

## Parser And UX Guardrails

- The app’s value is graph-first cause-and-effect navigation for Salesforce transactions. Preserve that focus.
- Do not show `USER_DEBUG` as graph nodes. Treat debug output as raw evidence/inspector context.
- Flow terminology:
  - Flow interview = the actual Flow run.
  - Flow element = a specific element inside that Flow.
  - Avoid showing runtime wrapper nodes when they add no meaningful downstream details.
- SOQL/DML counts in graph nodes should be explainable in Salesforce language:
  - Local counts belong to the node that directly owns the query/DML.
  - Downstream counts are rollups from children and should not be confused with local execution.
- When a left-panel DML/SOQL/error/email/callout row is selected, open the parent path and focus the exact node where it happened.
- If a group is selected, zoom/fit so all matching nodes are visible where practical, and provide a clear path back to story context.
- Avoid duplicate error noise: show the exact throw site prominently and use parent indicators only to explain downstream failure, not to imply every parent threw the exception.

## Git And Release Hygiene

- Do not revert user changes unless explicitly requested.
- Use `apply_patch` for manual file edits.
- Before committing, run the most relevant verification for the change:
  - Docs-only: `git diff --check`
  - Extension/package changes: `npm run vscode:package`
  - App/parser changes: `npm run build`
  - Security-sensitive changes: `npm run security:audit`
- Keep README, VS Code extension README, release notes, and screenshots consistent when changing public product messaging.
