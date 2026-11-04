import {describe, expect, it} from 'vitest';
import {initialWorkspace} from '../src/model';
import {
    digestWorkspace,
    discoverServer,
    discoverWorkspace,
    synchronize,
    type SyncSettings,
    type SyncTransport,
    syncUrl
} from '../src/sync';

function remote(initial?: ReturnType<typeof initialWorkspace>) {
    let value = initial, version = 1;
    const transport: SyncTransport = async (_url, init) => {
        if (_url.endsWith('/.well-known/typealot')) return new Response(JSON.stringify({workspace: '/workspace'}));
        if (init.method === 'GET') return value ? new Response(JSON.stringify(value), {headers: {ETag: `"${version}"`}}) : new Response(null, {status: 404});
        const headers = init.headers as Record<string, string>;
        if (value ? headers['If-Match'] !== `"${version}"` : headers['If-None-Match'] !== '*') return new Response(null, {status: 412});
        value = JSON.parse(String(init.body));
        version++;
        return new Response(null, {headers: {ETag: `"${version}"`}});
    };
    return {
        transport, read: () => value, change: (w: typeof initial) => {
            value = w;
            version++;
        }
    };
}

const config: SyncSettings = {url: 'https://sync.example', automatic: false};
describe('synchronization without data loss', () => {
    it('creates remote workspace including media and attachments', async () => {
        const w = initialWorkspace(), r = remote();
        w.notes[0].content.content!.push({
            type: 'media',
            attrs: {
                provider: 'youtube',
                canonicalUrl: 'https://youtu.be/dQw4w9WgXcQ',
                externalId: 'dQw4w9WgXcQ',
                contentType: 'video',
                start: 0,
                compact: false
            }
        });
        const result = await synchronize(w, config, r.transport);
        expect(result.kind).toBe('synced');
        expect(r.read()?.notes).toEqual(w.notes);
    });
    it('uploads only when remote still matches the common base', async () => {
        const base = initialWorkspace(), r = remote(base), local = structuredClone(base);
        local.notes[0].title = 'local';
        const result = await synchronize(local, {...config, digest: await digestWorkspace(base)}, r.transport);
        expect(result.kind).toBe('synced');
        expect(r.read()?.notes[0].title).toBe('local');
    });
    it('downloads independent remote edits when local is unchanged', async () => {
        const base = initialWorkspace(), other = structuredClone(base);
        other.notes[0].title = 'remote';
        const r = remote(other);
        const result = await synchronize(base, {...config, digest: await digestWorkspace(base)}, r.transport);
        expect(result.kind).toBe('synced');
        if (result.kind === 'synced') expect(result.workspace.notes[0].title).toBe('remote');
    });
    it('stops only on incompatible changes to the same known file', async () => {
        const base = initialWorkspace(), local = structuredClone(base), other = structuredClone(base);
        local.notes[0].title = 'local';
        other.notes[0].title = 'remote';
        const r = remote(other);
        expect((await synchronize(local, {
            ...config,
            base,
            digest: await digestWorkspace(base)
        }, r.transport)).kind).toBe('conflict');
        expect(r.read()?.notes[0].title).toBe('remote');
    });
    it('loads first-contact server data without a warning', async () => {
        const base = initialWorkspace(), other = structuredClone(base);
        other.notes[0].title = 'existing';
        const r = remote(other), result = await synchronize(base, config, r.transport);
        expect(result.kind).toBe('synced');
        expect(result.workspace.notes[0].title).toBe('existing');
        expect(r.read()?.notes[0].title).toBe('existing');
    });
    it('requires an ETag and rejects executable or credentialed endpoints', async () => {
        await expect(synchronize(initialWorkspace(), config, async (url) => new Response(JSON.stringify(url.endsWith('/.well-known/typealot') ? {workspace: '/workspace'} : initialWorkspace())))).rejects.toThrow('ETag');
        for (const url of ['javascript:alert(1)', 'https://user:pass@example.com']) await expect(synchronize(initialWorkspace(), {
            ...config,
            url
        }, remote().transport)).rejects.toThrow();
    });
    it('ignores transient canvas selection in content digests', async () => {
        const a = initialWorkspace(), b = structuredClone(a);
        b.boards[0].nodes[0].selected = true;
        expect(await digestWorkspace(a)).toBe(await digestWorkspace(b));
    });
});

describe('server discovery', () => {
    it('accepts same-origin WSS discovery and rejects cross-origin and credentialed sockets', async () => {
        const transport = (realtime: string): SyncTransport => async () => new Response(JSON.stringify({
            workspace: '/workspace',
            realtime
        }));
        expect((await discoverServer('https://sync.example', transport('wss://sync.example/realtime'))).realtime).toBe('wss://sync.example/realtime');
        for (const endpoint of ['wss://other.example/realtime', 'wss://user:password@sync.example/realtime', 'ws://sync.example/realtime']) await expect(discoverServer('https://sync.example', transport(endpoint))).rejects.toThrow('errors.syncPathInvalid');
    });
    it('accepts IP, domain, port and explicit HTTPS without a file path', () => {
        expect(syncUrl('192.168.1.10')).toBe('http://192.168.1.10/');
        expect(syncUrl('sync.example')).toBe('http://sync.example/');
        expect(syncUrl('127.0.0.1:47845')).toBe('http://127.0.0.1:47845/');
        expect(syncUrl('https://sync.example')).toBe('https://sync.example/');
        for (const address of ['https://sync.example/file', 'https://sync.example?secret=x', 'https://u:p@sync.example']) expect(() => syncUrl(address)).toThrow();
    });
    it('discovers a custom path and never sends credentials', async () => {
        const calls: string[] = [];
        const transport: SyncTransport = async (url, init) => {
            calls.push(url);
            expect(init.credentials).toBe('omit');
            expect(new Headers(init.headers).has('Authorization')).toBe(false);
            if (url.endsWith('/.well-known/typealot')) return new Response(JSON.stringify({workspace: '/files/custom.json'}));
            if (init.method === 'GET') return new Response(null, {status: 404});
            return new Response(null, {headers: {ETag: '"new"'}});
        };
        await synchronize(initialWorkspace(), config, transport);
        expect(calls).toEqual(['https://sync.example/.well-known/typealot', 'https://sync.example/files/custom.json', 'https://sync.example/files/custom.json']);
    });
    it('rejects cross-origin or missing discovery paths', async () => {
        for (const manifest of [{workspace: 'https://other.example/file'}, {}]) await expect(discoverWorkspace(config.url, async () => new Response(JSON.stringify(manifest)))).rejects.toThrow();
    });
});
