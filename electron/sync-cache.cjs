const fs = require('node:fs');
const path = require('node:path');

function configureSyncCache({app, ipcMain, win, origin, safeStorage, platform = process.platform, protection}) {
    const legacy = path.join(app.getPath('userData'), 'sync-cache.v1.enc');
    const windows = platform === 'win32';
    const filename = windows ? path.join(app.getPath('userData'), 'sync-cache.v2.enc') : legacy;
    const dpapi = windows ? protection || require('./windows-protection.cjs') : null;
    let pending = Promise.resolve();
    const serial = action => {
        const operation = pending.catch(() => {
        }).then(action);
        pending = operation;
        return operation;
    };
    const authorize = event => {
        if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame ||
            new URL(event.senderFrame.url).origin !== origin) throw new Error('Unavailable');
        if (!windows && (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text'))
            throw new Error('Encryption unavailable');
    };
    const decode = async bytes => windows ? (await dpapi.unprotect(bytes)).toString('utf8') : safeStorage.decryptString(bytes);
    const write = async text => {
        const ciphertext = windows ? await dpapi.protect(Buffer.from(text, 'utf8')) : safeStorage.encryptString(text);
        fs.mkdirSync(path.dirname(filename), {recursive: true});
        let previous;
        try {
            const bytes = fs.readFileSync(filename);
            try {
                await decode(bytes);
                previous = bytes;
            } catch {
            }
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (previous) {
            fs.writeFileSync(filename + '.bak.tmp', previous, {mode: 0o600});
            fs.renameSync(filename + '.bak.tmp', filename + '.bak');
        }
        fs.writeFileSync(filename + '.tmp', ciphertext, {mode: 0o600});
        fs.renameSync(filename + '.tmp', filename);
    };
    const read = async () => {
        try {
            return await decode(fs.readFileSync(filename));
        } catch (error) {
            try {
                return await decode(fs.readFileSync(filename + '.bak'));
            } catch {
            }
            if (!windows) {
                if (error.code === 'ENOENT') return null;
                throw error;
            }
            try {
                const text = safeStorage.decryptString(fs.readFileSync(legacy));
                await write(text);
                return text;
            } catch (legacyError) {
                if (error.code === 'ENOENT' && legacyError.code === 'ENOENT') return null;
                throw error.code === 'ENOENT' ? legacyError : error;
            }
        }
    };
    ipcMain.handle('typealot:sync-cache-load', event => {
        authorize(event);
        return serial(read);
    });
    ipcMain.handle('typealot:sync-cache-save', (event, text) => {
        authorize(event);
        if (typeof text !== 'string' || text.length > 16384) throw new Error('Invalid sync cache');
        const value = JSON.parse(text);
        if (typeof value?.url !== 'string' || typeof value?.automatic !== 'boolean') throw new Error('Invalid sync cache');
        return serial(() => write(JSON.stringify({url: value.url, automatic: value.automatic})));
    });
    return () => {
        ipcMain.removeHandler('typealot:sync-cache-load');
        ipcMain.removeHandler('typealot:sync-cache-save');
    };
}

module.exports = {configureSyncCache};
