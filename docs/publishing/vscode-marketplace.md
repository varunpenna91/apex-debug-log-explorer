# VS Code Marketplace Publishing

This guide publishes **Apex Debug Log Explorer** as a VS Code extension.

Official reference: [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension).

## One-Time Setup

1. Create or choose a Visual Studio Marketplace publisher.
2. Confirm `extensions/vscode-apex-debug-log-explorer/package.json` uses that publisher id:

```json
{
  "publisher": "penna-vibe-code-apps",
  "name": "apex-debug-log-explorer"
}
```

3. If your publisher id is different, update the `publisher` value and update any Marketplace URLs in README and release notes.
4. Create an Azure DevOps personal access token with Marketplace `Manage` permission.
5. Add the token to GitHub repository secrets as `VSCE_PAT`.

## Publish From GitHub Actions

1. Open the GitHub repository.
2. Go to Actions.
3. Run **Publish VS Code Marketplace**.
4. After it succeeds, verify:

```text
https://marketplace.visualstudio.com/items?itemName=penna-vibe-code-apps.apex-debug-log-explorer
```

## Publish Locally

```bash
npm install
npm run vscode:package
VSCE_PAT=<token> npm run vscode:publish
```

Print the Marketplace URL from the current extension manifest:

```bash
npm run vscode:marketplace-url
```

## Release Notes

After Marketplace publishing succeeds, the GitHub Release should include both install paths:

- Desktop installers from GitHub Releases for macOS and Windows.
- VS Code install from Marketplace, with VSIX fallback for restricted environments.

## Marketplace Listing Checklist

- Clear display name: `Apex Debug Log Explorer`
- Local-first positioning: no Salesforce login, no server upload
- Screenshots from `docs/media/`
- Install and command usage
- Known limitations around truncated debug logs
- Security note that log contents are parsed locally
- Not affiliated with Salesforce unless formal approval exists
