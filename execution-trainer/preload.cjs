const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('trainer', {
  windowAction: action => ipcRenderer.invoke('window-action', action),
  list: () => ipcRenderer.invoke('trainer', 'list'),
  create: input => ipcRenderer.invoke('trainer', 'create', input),
  complete: id => ipcRenderer.invoke('trainer', 'complete', id)
});
