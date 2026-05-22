# Changelog

## 0.1.8 - Marketplace Overview Cleanup

- Remove the decorative icon image from the GitHub README and VS Code Marketplace overview.
- Keep the branded icon as the desktop app icon and VS Code extension icon.

## 0.1.7 - Brand Icon

- Add the Apex Debug Log Explorer brand icon to the desktop app, VS Code extension, README, and release media.
- Configure native Electron icons for macOS, Windows, and Linux packaging.
- Update Marketplace README image cache keys for the new branded release.

## 0.1.6 - Marketplace Screenshot Cache Bust

- Add versioned screenshot URLs so VS Code and Marketplace stop showing cached pre-sanitized images.

## 0.1.5 - Sanitized Public Screenshots

- Replace README and VS Code Marketplace screenshots with sanitized captures from a masked Salesforce debug log.
- Add a reusable media-log sanitizer for future public screenshots.

## 0.1.4 - Marketplace Listing Detail

- Expand the VS Code Marketplace README with product capabilities, screenshots, privacy notes, and right-click open flows.

## 0.1.3 - VS Code Sidebar Focus

- Automatically collapse the VS Code sidebar when Apex Debug Log Explorer opens its webview.

## 0.1.2 - VS Code Context Menu Fix

- Add `Open with Apex Debug Log Explorer` to the editor right-click menu for open `.log` and `.txt` files.
- Rename the current-file command so the context menu reads like a normal VS Code file action.

## 0.1.1 - Desktop Packaging Fix

- Ad-hoc sign macOS desktop builds to avoid Electron launch failures on private DMG installs.
- Updated GitHub Release packaging notes for macOS quarantine and signing expectations.

## 0.1.0 - Initial Public Preview

- Branded the product as Apex Debug Log Explorer.
- Added interactive Salesforce debug log execution graph.
- Added DML, SOQL, Errors, Email, and Callouts indexes.
- Added graph filters for Triggers, Flows, Errors, Apex Actions, Async Apex, and Callouts.
- Added Electron desktop shell.
- Added VS Code extension packaging scaffold.
- Added macOS DMG and Windows NSIS EXE installer packaging.
- Added VS Code Marketplace publishing scripts and manual publishing workflow.
- Added GitHub Actions CI and release workflows.
