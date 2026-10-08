const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nsw2', {
    getState: () => ipcRenderer.invoke('state:get'),
    onState: callback => {
        const listener = (_event, state) => callback(state);
        ipcRenderer.on('state', listener);
        return () => ipcRenderer.removeListener('state', listener);
    },
    setConfig: patch => ipcRenderer.invoke('config:set', patch),
    refresh: () => ipcRenderer.invoke('poll:refresh'),
    login: () => ipcRenderer.invoke('auth:login'),
    loginWithUrl: url => ipcRenderer.invoke('auth:login-url', url),
    logout: () => ipcRenderer.invoke('auth:logout'),
    openExternal: url => ipcRenderer.invoke('shell:open', url),
    openDiscordAssets: () => ipcRenderer.invoke('shell:open-assets'),
    window: {
        minimize: () => ipcRenderer.send('window:minimize'),
        toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
        close: () => ipcRenderer.send('window:close'),
    },
});
