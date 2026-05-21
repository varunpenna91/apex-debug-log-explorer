# Apex Debug Log Explorer

Explore Salesforce Apex debug logs as a local interactive execution graph inside VS Code.

## Features

- Open Salesforce `.log` or `.txt` debug logs from Command Palette.
- Open the current editor file directly.
- Right-click supported log files in Explorer.
- Analyze Apex, triggers, Flow interviews, Flow elements, DML, SOQL, Async Apex, email, callouts, and exceptions.
- Keep log contents local to VS Code. No Salesforce login and no server upload.

## Commands

- `Apex Debug Log Explorer: Open Log`
- `Apex Debug Log Explorer: Open Current File`

## Install From Marketplace

```bash
code --install-extension penna-vibe-code-apps.apex-debug-log-explorer
```

## Install From VSIX

1. Download `apex-debug-log-explorer-<version>.vsix`.
2. Open VS Code.
3. Run `Extensions: Install from VSIX...`.
4. Select the downloaded `.vsix`.
5. Open a Salesforce debug log and run `Apex Debug Log Explorer: Open Current File`.

Command-line install:

```bash
code --install-extension apex-debug-log-explorer-0.1.1.vsix
```

## Privacy

The extension reads local files and renders the bundled webview locally. It does not upload debug log content.

## Notes

This tool complements Salesforce Apex Replay Debugger and Apex Log Analyzer-style tooling. It is focused on transaction graph navigation and after-the-fact log triage.
