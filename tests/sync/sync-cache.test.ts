import {beforeEach, expect, it, vi} from 'vitest';
import {flushSyncSettings, loadSyncSettings, saveSyncSettings} from '../../src/sync/sync-cache';

const records = vi.hoisted(() => new Map<string, unknown>());
vi.mock('idb-keyval', () => ({
    get: async (key: string) => records.get(key),
    set: async (key: string, value: unknown) => {
        records.set(key, structuredClone(value));
    },
    del: async (key: string) => {
        records.delete(key);
    },
    update: async (key: string, fn: (value: unknown) => unknown) => {
        records.set(key, fn(records.get(key)));
    }
}));

beforeEach(async () => {
    await flushSyncSettings().catch(() => {
    });
    records.clear();
    vi.unstubAllGlobals();
});

it('encrypts and restores only the address and automatic preference, without WebCrypto subtle', async () => {
    const random = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('crypto', {getRandomValues: random});
    const config = {
        url: 'https://private.example:8443',
        automatic: false,
        administration: true,
        token: 'secret',
        base: {}
    };
    records.set('typealot.sync', config);
    await saveSyncSettings(config);
    expect(JSON.stringify([...records.values()])).not.toContain('private.example');
    expect(records.has('typealot.sync')).toBe(false);
    expect(await loadSyncSettings()).toEqual({url: config.url, automatic: false});
});

it('uses a fresh nonce and keeps rapid edits in order, including clearing the address', async () => {
    await saveSyncSettings({url: '192.168.1.10', automatic: true});
    const first = records.get('typealot.sync.encrypted.v1');
    await saveSyncSettings({url: '192.168.1.10', automatic: true});
    expect(records.get('typealot.sync.encrypted.v1')).not.toEqual(first);
    await Promise.all([
        saveSyncSettings({url: '192.168.1.11', automatic: true}),
        saveSyncSettings({url: '', automatic: false})
    ]);
    expect(await loadSyncSettings()).toEqual({url: '', automatic: false});
});

it('rejects tampered data and missing keys without destroying the saved ciphertext', async () => {
    await saveSyncSettings({url: 'sync.example', automatic: true});
    const record = records.get('typealot.sync.encrypted.v1') as { ciphertext: Uint8Array };
    record.ciphertext[0] ^= 1;
    await expect(loadSyncSettings()).rejects.toThrow();
    expect(records.has('typealot.sync.encrypted.v1')).toBe(true);
    records.delete('typealot.sync.key.v1');
    await expect(loadSyncSettings()).rejects.toThrow('Missing sync cache key');
});

it('uses the desktop encrypted cache without storing a browser key or plaintext', async () => {
    let text: string | null = null;
    vi.stubGlobal('window', {
        typealotDesktop: {
            saveSyncCache: async (value: string) => {
                text = value;
            },
            loadSyncCache: async () => text
        }
    });
    await saveSyncSettings({url: '10.0.0.1', automatic: false});
    expect(records.size).toBe(0);
    expect(await loadSyncSettings()).toEqual({url: '10.0.0.1', automatic: false});
});
