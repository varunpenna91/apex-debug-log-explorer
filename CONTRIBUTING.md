# Contributing

Thanks for helping improve Apex Debug Log Explorer.

## Local Setup

```bash
npm install
npm run dev -- --port 5173
```

For the desktop shell:

```bash
npm run desktop
```

For the VS Code extension package:

```bash
npm run vscode:package
```

## Development Expectations

- Keep debug log parsing local-first.
- Do not add network upload behavior for log content.
- Prefer Salesforce terminology used in debug logs and Salesforce Setup/Developer tooling.
- Test with large real-world logs when changing parsing, graph layout, or indexes.
- Keep graph nodes meaningful; noisy log events should remain collapsed or shown as evidence, not primary graph nodes.

## Pull Request Checklist

- `npm run build`
- `npm run vscode:package`
- Desktop smoke test with at least one large Salesforce debug log.
- Screenshots updated when user-facing visuals change.
