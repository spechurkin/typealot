import {gcm} from '@noble/ciphers/aes.js';
import {del, get, set, update} from 'idb-keyval';
import type {SyncSettings} from './sync';

const cacheKey = 'typealot.sync.encrypted.v1';
const encryptionKey = 'typealot.sync.key.v1';
type Preferences = Pick<SyncSettings, 'url' | 'automatic'>;
let pending: Promise<void> = Promise.resolve();
let revision = 0;

async function deviceKey(): Promise<Uint8Array> {
    await update<Uint8Array>(encryptionKey, key => key ?? crypto.getRandomValues(new Uint8Array(32)));
    const key = await get<Uint8Array>(encryptionKey);
    if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('Invalid sync cache key');
    return key;
}

export async function loadSyncSettings(): Promise<Preferences | undefined> {
    await pending;
    // Legacy records could include credentials; never copy them into the new cache.
    await del('typealot.sync');
    const desktop = typeof window !== 'undefined' && window.typealotDesktop;
    let value: unknown;
    if (desktop) {
        const text = await desktop.loadSyncCache();
        if (text === null) return;
        value = JSON.parse(text);
    } else {
        const record = await get<{ iv: Uint8Array; ciphertext: Uint8Array }>(cacheKey);
        if (!record) return;
        const key = await get<Uint8Array>(encryptionKey);
        if (!key) throw new Error('Missing sync cache key');
        value = JSON.parse(new TextDecoder().decode(gcm(key, record.iv).decrypt(record.ciphertext)));
    }
    if (!value || typeof value !== 'object' || !('url' in value) || typeof value.url !== 'string' ||
        !('automatic' in value) || typeof value.automatic !== 'boolean') throw new Error('Invalid sync cache');
    return {url: value.url, automatic: value.automatic};
}

export function saveSyncSettings(settings: Preferences): Promise<void> {
    const version = ++revision;
    const text = JSON.stringify({url: settings.url, automatic: settings.automatic});
    const write = pending.catch(() => {
    }).then(async () => {
        if (version !== revision) return;
        const desktop = typeof window !== 'undefined' && window.typealotDesktop;
        if (desktop) {
            await desktop.saveSyncCache(text);
            await del(cacheKey);
        } else {
            const key = await deviceKey();
            const iv = crypto.getRandomValues(new Uint8Array(12));
            await set(cacheKey, {iv, ciphertext: gcm(key, iv).encrypt(new TextEncoder().encode(text))});
        }
        await del('typealot.sync');
    });
    pending = write;
    return write;
}

export const flushSyncSettings = () => pending;
