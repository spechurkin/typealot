function configureUpdates({app, ipcMain, win, origin, allowClose}) {
    if (!app.isPackaged) return () => {
    };
    const {autoUpdater} = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    let state = {status: 'idle'}, downloading = false, ready = false;
    const publish = next => {
        state = next;
        if (!win.isDestroyed()) win.webContents.send('typealot:update', state);
    };
    autoUpdater.on('update-available', info => publish({status: ready ? 'ready' : 'available', version: info.version}));
    autoUpdater.on('update-downloaded', info => {
        ready = true;
        publish({status: 'ready', version: info.version});
    });
    autoUpdater.on('error', () => publish({...state, status: 'error'}));
    const trusted = event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === origin;
    ipcMain.handle('typealot:update-state', event => trusted(event) ? state : null);
    ipcMain.handle('typealot:update-download', async event => {
        if (!trusted(event) || downloading || !['available', 'error'].includes(state.status) || !state.version) return false;
        downloading = true;
        publish({...state, status: 'downloading'});
        try {
            await autoUpdater.downloadUpdate();
            return true;
        } catch {
            publish({...state, status: 'error'});
            return false;
        } finally {
            downloading = false;
        }
    });
    ipcMain.handle('typealot:update-install', event => {
        if (!trusted(event) || !ready) return false;
        // The renderer saves its workspace before requesting installation; the window close guard saves again.
        setImmediate(() => {
            allowClose();
            autoUpdater.quitAndInstall();
        });
        return true;
    });
    let stop = () => {
    }, disposed = false;
    import('../shared/updates.mjs').then(({startUpdateChecks}) => {
        if (!disposed) stop = startUpdateChecks(async () => {
            if (!downloading && !ready) await autoUpdater.checkForUpdates();
        });
    });
    return () => {
        disposed = true;
        stop();
        for (const name of ['state', 'download', 'install']) ipcMain.removeHandler('typealot:update-' + name);
        autoUpdater.removeAllListeners();
    };
}

module.exports = {configureUpdates};
