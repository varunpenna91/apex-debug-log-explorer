# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 0.1.x | Yes |

## Reporting a Vulnerability

Please open a private security advisory in GitHub or contact the repository owner directly.

Do not attach real customer Salesforce debug logs to public issues. Debug logs can contain record identifiers, user information, emails, request payloads, and business data.

## Privacy Model

Apex Debug Log Explorer is designed to parse logs locally:

- Browser/dev mode parses in the browser.
- Desktop mode parses in the local Electron app.
- VS Code mode reads the local file in the extension host and renders it in a local webview.

Do not introduce server upload, telemetry containing log content, or third-party processing without an explicit product decision and documentation update.

## Local Hardening

- Electron renderer isolation and sandboxing must stay enabled.
- External navigation must be limited to normalized `http:` and `https:` URLs.
- The local Electron renderer server must keep CSP, `nosniff`, and `no-referrer` headers.
- File open flows should only accept `.log` and `.txt` files up to 50 MB.
- CI runs `npm run security:audit`, which checks npm advisories and package registry signatures.
