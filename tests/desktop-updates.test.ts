import {afterEach, expect, it, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {startUpdateChecks, UPDATE_INTERVAL} from '../shared/updates.mjs';

afterEach(() => vi.useRealTimers());
it('checks packaged desktop builds on schedule and protects download/install IPC', async () => {
    vi.useFakeTimers();
    const updater = Object.assign(new EventEmitter(), {
        checkForUpdates: vi.fn().mockResolvedValue(null),
        downloadUpdate: vi.fn().mockResolvedValue([]),
        quitAndInstall: vi.fn(),
        autoDownload: true,
        autoInstallOnAppQuit: true
    });
    const handlers = new Map<string, Function>();
    const ipcMain = {
        handle: (name: string, handler: Function) => handlers.set(name, handler),
        removeHandler: (name: string) => handlers.delete(name)
    };
    const win = {isDestroyed: () => false, webContents: {send: vi.fn(), mainFrame: {}}};
    const origin = 'http://127.0.0.1:47831';
    const event = {sender: win.webContents, senderFrame: win.webContents.mainFrame};
    Object.assign(event.senderFrame, {url: origin});
    const allowClose = vi.fn();
    const module = {exports: {} as { configureUpdates: Function }};
    // Substitute only the lazy module loader, keeping the production controller and scheduler intact.
    const source = readFileSync('electron/updates.cjs', 'utf8').replace("import('../shared/updates.mjs')", 'Promise.resolve({startUpdateChecks})');
    new Function('require', 'module', 'startUpdateChecks', 'setImmediate', source)(() => ({autoUpdater: updater}), module, startUpdateChecks, (fn: () => void) => setTimeout(fn, 0));
    const stop = module.exports.configureUpdates({app: {isPackaged: true}, ipcMain, win, origin, allowClose});
    await vi.advanceTimersByTimeAsync(0);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(handlers.get('typealot:update-install')!(event)).toBe(false);
    updater.emit('update-available', {version: '0.2.0'});
    expect(await handlers.get('typealot:update-download')!({...event, sender: {}})).toBe(false);
    expect(await handlers.get('typealot:update-download')!(event)).toBe(true);
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1);
    updater.emit('update-downloaded', {version: '0.2.0'});
    expect(handlers.get('typealot:update-state')!(event)).toMatchObject({status: 'ready', version: '0.2.0'});
    expect(handlers.get('typealot:update-install')!(event)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(allowClose).toHaveBeenCalledOnce();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
    stop();
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(handlers.size).toBe(0);
});
