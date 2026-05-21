# Desktop Installer Packaging

Apex Debug Log Explorer ships desktop installers through GitHub Releases.

## Release Artifacts

The public release workflow builds these installer files:

- `apex-debug-log-explorer-<version>-mac-x64.dmg`
- `apex-debug-log-explorer-<version>-mac-arm64.dmg`
- `apex-debug-log-explorer-<version>-win-x64.exe`
- `apex-debug-log-explorer-<version>.vsix`

The macOS DMGs and Windows EXE are meant for users who want to install and open the app directly. The VSIX is for users who prefer to stay inside VS Code.

## Local Packaging

Run the app from source:

```bash
npm install
npm run desktop
```

Create a local macOS DMG:

```bash
npm run package:mac
```

Create a local Windows installer:

```bash
npm run package:win
```

For Windows, prefer the GitHub Release workflow because it builds the installer on a Windows runner. Building Windows installers from macOS can require extra Wine/NSIS dependencies and is more fragile than native CI packaging.

## GitHub Release Flow

1. Update `CHANGELOG.md` and `docs/releases/v0.1.0.md`.
2. Confirm the app builds:

```bash
npm run build
npm run vscode:package
```

3. Create and push a version tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

4. GitHub Actions runs `.github/workflows/release.yml`.
5. The workflow uploads the DMG, EXE, and VSIX files to the GitHub Release.

## Signing Notes

The initial release artifacts are unsigned.

- macOS users may see a Gatekeeper warning.
- Windows users may see a Microsoft Defender SmartScreen warning.
- Teams that require managed distribution should sign and notarize the macOS build and code-sign the Windows installer before broad rollout.

Unsigned builds are acceptable for early internal validation and GitHub Release testing, but signed builds are recommended before asking a wider team to install the desktop app.
