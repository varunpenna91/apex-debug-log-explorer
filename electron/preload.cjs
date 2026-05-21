const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('apexDebugLogExplorer', {
  openLogFile: () => ipcRenderer.invoke('log-file:open'),
  onOpenLogShortcut: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('menu:open-log', listener);
    return () => ipcRenderer.removeListener('menu:open-log', listener);
  }
});
