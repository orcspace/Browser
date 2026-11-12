const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('browser', Object.freeze({
  state: () => ipcRenderer.invoke('browser:state'),
  action: (name, data) => ipcRenderer.invoke('browser:action', name, data),
  subscribe: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('browser:update', listener);
    return () => ipcRenderer.removeListener('browser:update', listener);
  }
}));
