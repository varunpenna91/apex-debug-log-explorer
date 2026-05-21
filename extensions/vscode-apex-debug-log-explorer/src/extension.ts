import * as vscode from 'vscode';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';

const MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.log', '.txt']);

type PendingLog = {
  fileName: string;
  text: string;
  sourceUri?: string;
};

type WebviewMessage = {
  type?: string;
};

let panel: vscode.WebviewPanel | undefined;
let pendingLog: PendingLog | undefined;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('apexDebugLogExplorer.openLog', async () => {
      const fileUri = await pickLogFile();
      if (!fileUri) {
        return;
      }
      await openLogUri(context, fileUri);
    }),
    vscode.commands.registerCommand('apexDebugLogExplorer.openCurrentFile', async (resource?: vscode.Uri) => {
      const fileUri = resource ?? vscode.window.activeTextEditor?.document.uri;
      if (!fileUri) {
        vscode.window.showWarningMessage('Open a Salesforce debug log file first.');
        return;
      }
      await openLogUri(context, fileUri);
    })
  );
}

export function deactivate() {
  panel?.dispose();
  panel = undefined;
  pendingLog = undefined;
}

async function pickLogFile(): Promise<vscode.Uri | undefined> {
  const picked = await vscode.window.showOpenDialog({
    title: 'Open Salesforce Debug Log',
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      'Salesforce Debug Logs': ['log', 'txt'],
      'All Files': ['*']
    }
  });
  return picked?.[0];
}

async function openLogUri(context: vscode.ExtensionContext, uri: vscode.Uri): Promise<void> {
  try {
    validateLogExtension(uri);
    const text = await readLogText(uri);
    if (Buffer.byteLength(text, 'utf8') > MAX_LOG_FILE_BYTES) {
      throw new Error('This log is larger than 50 MB. Trim the debug log before opening it.');
    }
    pendingLog = {
      fileName: basename(uri.fsPath || uri.path) || 'Salesforce debug log',
      text,
      sourceUri: uri.toString()
    };
    const webviewPanel = ensurePanel(context);
    webviewPanel.reveal(vscode.ViewColumn.One);
    sendPendingLog(webviewPanel);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to open the selected debug log.';
    vscode.window.showErrorMessage(`Apex Debug Log Explorer: ${message}`);
  }
}

async function readLogText(uri: vscode.Uri): Promise<string> {
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument?.uri.toString() === uri.toString()) {
    return activeDocument.getText();
  }
  if (uri.scheme !== 'file') {
    throw new Error('Only local Salesforce debug log files are supported.');
  }
  const details = await stat(uri.fsPath);
  if (!details.isFile()) {
    throw new Error('Select a Salesforce debug log file.');
  }
  if (details.size > MAX_LOG_FILE_BYTES) {
    throw new Error('This log is larger than 50 MB. Trim the debug log before opening it.');
  }
  return readFile(uri.fsPath, 'utf8');
}

function validateLogExtension(uri: vscode.Uri): void {
  const extension = extname(uri.fsPath || uri.path).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Select a Salesforce debug log with a .log or .txt extension.');
  }
}

function ensurePanel(context: vscode.ExtensionContext): vscode.WebviewPanel {
  if (panel) {
    return panel;
  }

  const webviewDist = vscode.Uri.joinPath(context.extensionUri, 'webview-dist');
  panel = vscode.window.createWebviewPanel(
    'apexDebugLogExplorer',
    'Apex Debug Log Explorer',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [webviewDist]
    }
  );

  panel.webview.html = buildWebviewHtml(panel.webview, context.extensionUri);
  panel.webview.onDidReceiveMessage(
    async (message: WebviewMessage) => {
      if (message.type === 'ready') {
        sendPendingLog(panel);
        return;
      }
      if (message.type === 'openLog') {
        const fileUri = await pickLogFile();
        if (fileUri) {
          await openLogUri(context, fileUri);
        }
      }
    },
    undefined,
    context.subscriptions
  );
  panel.onDidDispose(
    () => {
      panel = undefined;
    },
    undefined,
    context.subscriptions
  );

  return panel;
}

function sendPendingLog(targetPanel: vscode.WebviewPanel | undefined): void {
  if (!targetPanel || !pendingLog) {
    return;
  }
  void targetPanel.webview.postMessage({
    type: 'loadLog',
    ...pendingLog
  });
}

function buildWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const webviewDist = vscode.Uri.joinPath(extensionUri, 'webview-dist');
  const assetsRoot = vscode.Uri.joinPath(webviewDist, 'assets');
  const nonce = createNonce();
  const scriptTags: string[] = [];
  const preloadTags: string[] = [];
  const styleTags: string[] = [];

  const indexPath = vscode.Uri.joinPath(webviewDist, 'index.html');
  const indexHtml = readFileSync(indexPath.fsPath, 'utf8');

  for (const match of indexHtml.matchAll(/<script[^>]+src="\.\/assets\/([^"]+)"[^>]*><\/script>/g)) {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, match[1]));
    scriptTags.push(`<script type="module" nonce="${nonce}" src="${uri}"></script>`);
  }
  for (const match of indexHtml.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/assets\/([^"]+)"[^>]*>/g)) {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, match[1]));
    preloadTags.push(`<link rel="modulepreload" href="${uri}">`);
  }
  for (const match of indexHtml.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/assets\/([^"]+)"[^>]*>/g)) {
    const uri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, match[1]));
    styleTags.push(`<link rel="stylesheet" href="${uri}">`);
  }

  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `worker-src ${webview.cspSource} blob:`,
    `connect-src ${webview.cspSource}`
  ].join('; ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="${csp}">
    <title>Apex Debug Log Explorer</title>
    ${preloadTags.join('\n    ')}
    ${styleTags.join('\n    ')}
  </head>
  <body>
    <div id="root"></div>
    ${scriptTags.join('\n    ')}
  </body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return nonce;
}
