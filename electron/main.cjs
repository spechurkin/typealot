const {app, BrowserWindow, shell, ipcMain, dialog, safeStorage} = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const nativeLocale = require('./localization.cjs');
let server;
app.setAppUserModelId('app.typealot.editor');
if (process.env.TYPEALOT_TEST_PROFILE) app.setPath('userData', process.env.TYPEALOT_TEST_PROFILE);
app.whenReady().then(() => {
    const root = path.resolve(__dirname, '../dist');
    server = http.createServer((req, res) => {
        let target;
        try {
            target = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        } catch {
            res.writeHead(400).end();
            return;
        }
        if (target !== root && !target.startsWith(root + path.sep)) {
            res.writeHead(403).end();
            return;
        }
        if (target === root) target = path.join(root, 'index.html');
        fs.readFile(target, (err, body) => {
            if (err) {
                res.writeHead(404).end();
                return;
            }
            const mime = {
                '.html': 'text/html; charset=utf-8',
                '.js': 'text/javascript',
                '.css': 'text/css',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.ico': 'image/x-icon'
            };
            res.writeHead(200, {
                'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
                'Referrer-Policy': 'strict-origin-when-cross-origin',
                'X-Content-Type-Options': 'nosniff'
            });
            res.end(body);
        });
    });
    // Stable origin keeps IndexedDB attached to the same local workspace across launches.
    const port = process.env.TYPEALOT_TEST_PROFILE ? Number(process.env.TYPEALOT_TEST_DESKTOP_PORT || 47831) : 47831;
    server.listen(port, '127.0.0.1', () => {
        const origin = `http://127.0.0.1:${port}`;
        const win = new BrowserWindow({
            width: 1360,
            height: 900,
            minWidth: 360,
            minHeight: 520,
            backgroundColor: '#1b1c1e',
            icon: path.join(root, 'icons/icon-512.png'),
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                preload: path.join(__dirname, 'preload.cjs')
            }
        });
        const stopSyncCache = require('./sync-cache.cjs').configureSyncCache({app, ipcMain, win, origin, safeStorage});
        win.on('closed', stopSyncCache);
        const stopUpdates = require('./updates.cjs').configureUpdates({
            app, ipcMain, win, origin, allowClose: () => {
                closing = true;
            }
        });
        win.on('closed', stopUpdates);
        let closing = false, waiting = false, language = nativeLocale.resolveLanguage(app.getLocale());
        const updateLanguage = (event, value) => {
            if (event.sender === win.webContents) language = nativeLocale.resolveLanguage(value);
        };
        ipcMain.on('typealot:language', updateLanguage);
        let installing = false;
        ipcMain.handle('typealot:install-server', async (event, input) => {
            if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || new URL(event.senderFrame.url).origin !== origin || installing) return {
                ok: false,
                error: 'unavailable'
            };
            installing = true;
            const controller = new AbortController();
            const cancel = () => controller.abort();
            win.webContents.once('destroyed', cancel);
            try {
                const {installServer} = require('./ssh-install.cjs');
                const result = await installServer(input, async ({host, port, fingerprint}) => {
                    const choice = await dialog.showMessageBox(win, {
                        type: 'question',
                        title: 'Typealot',
                        message: nativeLocale.t(language, 'ssh.verifyHost'),
                        detail: nativeLocale.t(language, 'ssh.hostFingerprint', {host, port, fingerprint}),
                        buttons: [nativeLocale.t(language, 'ssh.cancel'), nativeLocale.t(language, 'ssh.trustAndInstall')],
                        defaultId: 0,
                        cancelId: 0
                    });
                    return choice.response === 1;
                }, {signal: controller.signal});
                return {ok: true, ...result};
            } catch (error) {
                const code = ['invalidInput', 'buildMissing', 'cancelled', 'timeout', 'installFailed'].includes(error.message) ? error.message : error.level === 'client-authentication' ? 'authenticationFailed' : 'connectionFailed';
                return {ok: false, error: code, detail: error.detail || ''};
            } finally {
                if (input) input.password = '';
                win.webContents.removeListener('destroyed', cancel);
                installing = false;
            }
        });
        win.on('closed', () => ipcMain.removeHandler('typealot:install-server'));
        win.on('closed', () => ipcMain.removeListener('typealot:language', updateLanguage));
        win.on('close', event => {
            if (closing || !win.webContents.getURL() || win.webContents.isCrashed()) return;
            event.preventDefault();
            if (waiting) return;
            waiting = true;
            const id = require('node:crypto').randomUUID();
            let timer;
            const finish = async ok => {
                ipcMain.removeListener('typealot:flushed', response);
                clearTimeout(timer);
                waiting = false;
                if (ok) {
                    closing = true;
                    win.close();
                    return;
                }
                const choice = await dialog.showMessageBox(win, {
                    type: 'warning',
                    title: 'Typealot',
                    message: nativeLocale.t(language, 'desktop.closeFailed'),
                    detail: nativeLocale.t(language, 'desktop.closeFailedDescription'),
                    buttons: [nativeLocale.t(language, 'desktop.returnToNote'), nativeLocale.t(language, 'desktop.closeWithoutSaving')],
                    defaultId: 0,
                    cancelId: 0
                });
                if (choice.response === 1) {
                    closing = true;
                    win.close();
                }
            };
            const response = (event, result) => {
                if (event.sender === win.webContents && result?.id === id) void finish(!!result.ok);
            };
            ipcMain.on('typealot:flushed', response);
            timer = setTimeout(() => void finish(false), 15000);
            win.webContents.send('typealot:flush', id);
        });
        win.webContents.setWindowOpenHandler(({url}) => {
            try {
                if (['https:', 'http:', 'mailto:'].includes(new URL(url).protocol)) shell.openExternal(url);
            } catch {
            }
            return {action: 'deny'};
        });
        win.webContents.on('will-navigate', (event, url) => {
            if (new URL(url).origin !== origin) event.preventDefault();
        });
        win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        win.webContents.session.webRequest.onBeforeSendHeaders({urls: ['https://www.youtube.com/embed/*', 'https://www.youtube-nocookie.com/embed/*']}, (details, callback) => {
            callback({requestHeaders: {...details.requestHeaders, Referer: 'https://app.typealot.editor/'}});
        });
        win.loadURL(origin);
    });
    server.on('error', err => {
        const language = nativeLocale.resolveLanguage(app.getLocale());
        dialog.showErrorBox(nativeLocale.t(language, 'desktop.startupFailed'), nativeLocale.t(language, 'desktop.portUnavailable', {
            port: 47831,
            error: err.message
        }));
        app.quit();
    });
});
app.on('window-all-closed', () => {
    server?.close();
    app.quit();
});
