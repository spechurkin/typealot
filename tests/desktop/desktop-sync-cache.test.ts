import {createRequire} from 'node:module';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';

const {configureSyncCache} = createRequire(import.meta.url)('../../electron/sync-cache.cjs');
const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true});
});

function setup(available = true, backend = 'dpapi', platform = 'linux') {
    const output = path.join(process.cwd(), 'test-results');
    mkdirSync(output, {recursive: true});
    const directory = mkdtempSync(path.join(output, 'typealot-sync-cache-'));
    directories.push(directory);
    const handlers = new Map<string, (...args: any[]) => any>();
    const frame = {url: 'http://127.0.0.1:47831/'};
    const contents = {mainFrame: frame};
    const event = {sender: contents, senderFrame: frame};
    const safeStorage = {
        isEncryptionAvailable: () => available,
        getSelectedStorageBackend: () => backend,
        encryptString: vi.fn(() => Buffer.from('encrypted-by-test-backend')),
        decryptString: vi.fn(() => '{"url":"sync.example","automatic":false}')
    };
    const protection = {
        protect: vi.fn(async (data: Buffer) => Buffer.from('dpapi:' + data.toString('base64'))),
        unprotect: vi.fn(async (data: Buffer) => {
            if (!data.toString().startsWith('dpapi:')) throw new Error('Invalid ciphertext');
            return Buffer.from(data.toString().slice(6), 'base64');
        })
    };
    const stop = configureSyncCache({
        app: {getPath: () => directory},
        ipcMain: {
            handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler),
            removeHandler: (name: string) => handlers.delete(name)
        },
        win: {webContents: contents}, origin: 'http://127.0.0.1:47831', safeStorage, platform, protection
    });
    return {directory, event, handlers, safeStorage, stop};
}

it('writes through the OS encryption backend, strips extra fields and removes IPC handlers on close', async () => {
    const {directory, event, handlers, safeStorage, stop} = setup();
    const save = handlers.get('typealot:sync-cache-save')!;
    const load = handlers.get('typealot:sync-cache-load')!;
    expect(await load(event)).toBeNull();
    await save(event, JSON.stringify({url: 'sync.example', automatic: false, password: 'secret'}));
    expect(safeStorage.encryptString).toHaveBeenCalledWith('{"url":"sync.example","automatic":false}');
    expect(readFileSync(path.join(directory, 'sync-cache.v1.enc'), 'utf8')).toBe('encrypted-by-test-backend');
    expect(JSON.parse(await load(event))).toEqual({url: 'sync.example', automatic: false});
    stop();
    expect(handlers.size).toBe(0);
});

it('migrates Windows legacy data and restores the encrypted backup after primary corruption', async () => {
    const {directory, event, handlers, safeStorage} = setup(false, 'basic_text', 'win32');
    const load = handlers.get('typealot:sync-cache-load')!;
    const save = handlers.get('typealot:sync-cache-save')!;
    writeFileSync(path.join(directory, 'sync-cache.v1.enc'), 'legacy');
    expect(JSON.parse(await load(event))).toEqual({url: 'sync.example', automatic: false});
    expect(existsSync(path.join(directory, 'sync-cache.v2.enc'))).toBe(true);
    expect(readFileSync(path.join(directory, 'sync-cache.v1.enc'), 'utf8')).toBe('legacy');
    safeStorage.decryptString.mockImplementation(() => {
        throw new Error('Chromium key changed');
    });
    await save(event, '{"url":"new.example","automatic":true}');
    await save(event, '{"url":"latest.example","automatic":false}');
    expect(JSON.parse(await load(event))).toEqual({url: 'latest.example', automatic: false});
    writeFileSync(path.join(directory, 'sync-cache.v2.enc'), 'damaged');
    expect(JSON.parse(await load(event))).toEqual({url: 'new.example', automatic: true});
});

it('leaves unreadable legacy Windows ciphertext untouched and reports the error', async () => {
    const {directory, event, handlers, safeStorage} = setup(true, 'dpapi', 'win32');
    writeFileSync(path.join(directory, 'sync-cache.v1.enc'), 'unreadable legacy');
    safeStorage.decryptString.mockImplementation(() => {
        throw new Error('Chromium key changed');
    });
    await expect(handlers.get('typealot:sync-cache-load')!(event)).rejects.toThrow('Chromium key changed');
    expect(readFileSync(path.join(directory, 'sync-cache.v1.enc'), 'utf8')).toBe('unreadable legacy');
    expect(existsSync(path.join(directory, 'sync-cache.v2.enc'))).toBe(false);
});

it('rejects untrusted frames and unavailable OS encryption without a plaintext fallback', () => {
    const {event, handlers, safeStorage} = setup();
    const save = handlers.get('typealot:sync-cache-save')!;
    const text = '{"url":"sync.example","automatic":true}';
    expect(() => save({...event, sender: {}}, text)).toThrow('Unavailable');
    expect(() => save({...event, senderFrame: {url: 'https://untrusted.example'}}, text)).toThrow('Unavailable');
    expect(safeStorage.encryptString).not.toHaveBeenCalled();
    for (const {event: otherEvent, handlers: otherHandlers} of [setup(false), setup(true, 'basic_text')]) {
        expect(() => otherHandlers.get('typealot:sync-cache-save')!(otherEvent, text)).toThrow('Encryption unavailable');
    }
});
