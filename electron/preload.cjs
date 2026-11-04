const {contextBridge, ipcRenderer} = require('electron');
window.addEventListener('DOMContentLoaded', () => {
    const sendLanguage = () => ipcRenderer.send('typealot:language', document.documentElement.lang);
    new MutationObserver(sendLanguage).observe(document.documentElement, {attributes: true, attributeFilter: ['lang']});
    sendLanguage();
});
contextBridge.exposeInMainWorld('typealotDesktop', {
    loadSyncCache: () => ipcRenderer.invoke('typealot:sync-cache-load'),
    saveSyncCache: text => ipcRenderer.invoke('typealot:sync-cache-save', text),
    updateState: () => ipcRenderer.invoke('typealot:update-state'),
    downloadUpdate: () => ipcRenderer.invoke('typealot:update-download'),
    installUpdate: () => ipcRenderer.invoke('typealot:update-install'),
    onUpdate: handler => {
        const listener = (_event, state) => handler(state);
        ipcRenderer.on('typealot:update', listener);
        return () => ipcRenderer.removeListener('typealot:update', listener);
    },
    installServer: input => ipcRenderer.invoke('typealot:install-server', input),
    onBeforeClose: handler => {
        const listener = async (_event, id) => {
            try {
                await handler();
                ipcRenderer.send('typealot:flushed', {id, ok: true});
            } catch {
                ipcRenderer.send('typealot:flushed', {id, ok: false});
            }
        };
        ipcRenderer.on('typealot:flush', listener);
        return () => ipcRenderer.removeListener('typealot:flush', listener);
    }
});
