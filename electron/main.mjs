import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, isAbsolute, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const MAX_LOG_FILE_BYTES = 50 * 1024 * 1024;
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';";
const SECURITY_HEADERS = {
  'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

let mainWindow;
let rendererServer;

function safeExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

function createWindow(rendererUrl) {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 980,
    minWidth: 1120,
    minHeight: 740,
    title: 'Apex Debug Log Explorer',
    backgroundColor: '#071016',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = safeExternalUrl(url);
    if (externalUrl) {
      shell.openExternal(externalUrl);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== rendererUrl) {
      event.preventDefault();
      const externalUrl = safeExternalUrl(url);
      if (externalUrl) {
        shell.openExternal(externalUrl);
      }
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  mainWindow.loadURL(rendererUrl);
}

function mimeTypeFor(filePath) {
  switch (extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

async function startRendererServer() {
  if (rendererServer) {
    const address = rendererServer.address();
    return `http://127.0.0.1:${address.port}/`;
  }

  const distRoot = join(appRoot, 'dist');

  rendererServer = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? '';
      if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host)) {
        response.writeHead(403, SECURITY_HEADERS);
        response.end('Forbidden');
        return;
      }

      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
      const pathname = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname);
      const filePath = normalize(join(distRoot, pathname));
      const relativePath = relative(distRoot, filePath);

      if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
        response.writeHead(403, SECURITY_HEADERS);
        response.end('Forbidden');
        return;
      }

      try {
        const bytes = await readFile(filePath);
        response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': mimeTypeFor(filePath) });
        response.end(bytes);
      } catch {
        const bytes = await readFile(join(distRoot, 'index.html'));
        response.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' });
        response.end(bytes);
      }
    } catch (error) {
      response.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Unable to load application.');
    }
  });

  await new Promise((resolve, reject) => {
    rendererServer.once('error', reject);
    rendererServer.listen(0, '127.0.0.1', resolve);
  });

  const address = rendererServer.address();
  return `http://127.0.0.1:${address.port}/`;
}

function installMenu() {
  const template = [
    {
      label: 'Apex Debug Log Explorer',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Log...',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-log')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function installContextMenu(window) {
  window.webContents.on('context-menu', (_event, params) => {
    const template = [];

    if (params.selectionText) {
      template.push({ role: 'copy', label: 'Copy' });
    }

    if (params.isEditable) {
      if (template.length > 0) {
        template.push({ type: 'separator' });
      }
      template.push(
        { role: 'cut', label: 'Cut' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select All' }
      );
    } else {
      if (template.length > 0) {
        template.push({ type: 'separator' });
      }
      template.push({ role: 'selectAll', label: 'Select All' });
    }

    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window });
    }
  });
}

ipcMain.handle('log-file:open', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { canceled: false, error: 'The main window is not available.' };
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open Salesforce Debug Log',
    properties: ['openFile'],
    filters: [
      { name: 'Salesforce Logs', extensions: ['log', 'txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  try {
    const extension = extname(filePath).toLowerCase();
    if (extension !== '.log' && extension !== '.txt') {
      return {
        canceled: false,
        error: 'Select a Salesforce debug log with a .log or .txt extension.'
      };
    }
    const details = await stat(filePath);
    if (!details.isFile()) {
      return {
        canceled: false,
        error: 'Select a Salesforce debug log file.'
      };
    }
    if (details.size > MAX_LOG_FILE_BYTES) {
      return {
        canceled: false,
        error: 'This log is larger than 50 MB. Trim the debug log before opening it.'
      };
    }
    const text = await readFile(filePath, 'utf8');
    return {
      canceled: false,
      fileName: basename(filePath),
      text
    };
  } catch (error) {
    return {
      canceled: false,
      error: error instanceof Error ? error.message : 'Unable to read the selected log file.'
    };
  }
});

app.whenReady().then(async () => {
  app.on('web-contents-created', (_event, contents) => {
    contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
      callback(false);
    });
  });

  const rendererUrl = await startRendererServer();
  installMenu();
  createWindow(rendererUrl);
  if (mainWindow) {
    installContextMenu(mainWindow);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(rendererUrl);
      if (mainWindow) {
        installContextMenu(mainWindow);
      }
    }
  });
});

app.on('before-quit', () => {
  rendererServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
