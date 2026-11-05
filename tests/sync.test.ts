import {describe, expect, it} from 'vitest';
import {initialWorkspace} from '../src/model';
import {
    digestWorkspace,
    discoverServer,
    discoverWorkspace,
    synchronize,
    syncServerId,
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
        if (result.kind === 'synced') expect(result.serverSnapshot).not.toBe(true);
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
    it('replaces stale device content on first contact, including all server deletions', async () => {
        const local = initialWorkspace(), server = structuredClone(local);
        local.notes.push({...local.notes[0], id: 'deleted-note', title: 'Stale file'});
        local.folders.push({id: 'deleted-folder', name: 'Stale folder', parentId: null});
        local.boards.push({...structuredClone(local.boards[0]), id: 'deleted-board'});
        local.attachments.push({
            id: 'deleted-attachment',
            name: 'old.txt',
            mime: 'text/plain',
            data: 'data:text/plain;base64,b2xk'
        });
        local.boards[0].nodes.push({...structuredClone(local.boards[0].nodes[0]), id: 'deleted-object'});
        local.boards[0].edges.push({id: 'deleted-edge', source: 'card', target: 'deleted-object'});
        local.boards[0].title = 'Stale board edit';
        local.profile.handle = 'My device';
        local.theme = 'light';
        const r = remote(server), calls: string[] = [];
        const result = await synchronize(local, config, async (url, init) => {
            calls.push(init.method!);
            return r.transport(url, init);
        });
        expect(calls).toEqual(['GET', 'GET']);
        expect(result.kind).toBe('synced');
        if (result.kind === 'synced') expect(result.serverSnapshot).toBe(true);
        expect(result.workspace.notes).toEqual(server.notes);
        expect(result.workspace.folders).toEqual(server.folders);
        expect(result.workspace.boards).toEqual(server.boards);
        expect(result.workspace.attachments).toEqual([]);
        expect(result.workspace.profile).toEqual(local.profile);
        expect(result.workspace.theme).toBe('light');
        expect(r.read()).toEqual(server);
    });
    it('accepts an empty server workspace instead of restoring the device files', async () => {
        const local = initialWorkspace(),
            server = {...structuredClone(local), notes: [], folders: [], boards: [], attachments: []};
        const r = remote(server), result = await synchronize(local, config, r.transport);
        expect(result.workspace.notes).toEqual([]);
        expect(result.workspace.boards).toEqual([]);
        expect(result.workspace.folders).toEqual([]);
        expect(r.read()).toEqual(server);
    });
    it('stops before upload when server deletions collide with offline edits', async () => {
        const base = initialWorkspace();
        base.attachments.push({id: 'file', name: 'old.txt', mime: 'text/plain', data: 'data:text/plain;base64,b2xk'});
        const local = structuredClone(base), server = structuredClone(base);
        server.notes = [];
        server.attachments = [];
        server.boards[0].nodes = [];
        local.notes[0].title = 'Offline edit to deleted file';
        local.attachments[0].name = 'Offline rename';
        local.boards[0].nodes[0].position.x = 500;
        local.boards[0].title = 'New board title';
        const r = remote(server), result = await synchronize(local, {...config, base}, r.transport);
        expect(result.kind).toBe('conflict');
        if (result.kind !== 'conflict') throw new Error('Expected a conflict');
        expect(result.conflicts.map(file => file.kind || 'notes').sort()).toEqual(['attachments', 'boards', 'notes']);
        expect(result.workspace.notes[0].title).toBe('Offline edit to deleted file');
        expect(result.workspace.attachments[0].name).toBe('Offline rename');
        expect(result.workspace.boards[0].nodes[0].position.x).toBe(500);
        expect(r.read()).toEqual(server);
    });
    it('uses the persisted baseline after restart to upload offline edits and deletions', async () => {
        const base = initialWorkspace();
        base.notes.push({...structuredClone(base.notes[0]), id: 'deleted-offline'});
        base.attachments.push({id: 'file', name: 'file.txt', mime: 'text/plain', data: 'data:text/plain;base64,b2xk'});
        const local = structuredClone(base), server = structuredClone(base);
        local.notes[0].title = 'Offline title';
        local.notes = local.notes.filter(note => note.id !== 'deleted-offline');
        local.attachments[0].data = 'data:text/plain;base64,bmV3';
        server.boards[0].title = 'Server board title';
        local.syncState = {
            server: await syncServerId(config.url),
            base,
            digest: await digestWorkspace(base),
            etag: '"old"'
        };
        const r = remote(server);
        const result = await synchronize(JSON.parse(JSON.stringify(local)), config, r.transport);
        expect(result.kind).toBe('synced');
        expect(r.read()?.notes.map(note => note.title)).toEqual(['Offline title']);
        expect(r.read()?.attachments[0].data).toBe('data:text/plain;base64,bmV3');
        expect(r.read()?.boards[0].title).toBe('Server board title');
        expect(r.read()?.syncState).toBeUndefined();
        expect(await digestWorkspace(local)).toBe(await digestWorkspace({...local, syncState: undefined}));
    });
    it('never uses the baseline of another server', async () => {
        const base = initialWorkspace(), local = structuredClone(base), server = structuredClone(base);
        local.notes[0].title = 'Old server data';
        server.notes[0].title = 'New server data';
        local.syncState = {
            server: await syncServerId('https://other.example'),
            base,
            digest: await digestWorkspace(base),
            etag: '"old"'
        };
        const result = await synchronize(local, config, remote(server).transport);
        expect(result.workspace.notes[0].title).toBe('New server data');
    });
    it('protects legacy offline files when a saved connection has no baseline yet', async () => {
        const local = initialWorkspace(), server = structuredClone(local);
        local.notes[0].title = 'Unsynced legacy edit';
        local.attachments.push({
            id: 'file',
            name: 'offline.txt',
            mime: 'text/plain',
            data: 'data:text/plain;base64,eA=='
        });
        const r = remote(server);
        const result = await synchronize(local, {...config, protectLocal: true}, r.transport);
        expect(result.kind).toBe('conflict');
        if (result.kind !== 'conflict') throw new Error('Expected a conflict');
        expect(result.local.notes[0].title).toBe('Unsynced legacy edit');
        expect(result.conflicts.map(file => file.kind || 'notes')).toEqual(['notes', 'attachments']);
        expect(r.read()).toEqual(server);
    });
    it('never uploads if the mandatory server read fails', async () => {
        const methods: string[] = [];
        await expect(synchronize(initialWorkspace(), config, async (url, init) => {
            methods.push(init.method!);
            return url.endsWith('/.well-known/typealot')
                ? new Response(JSON.stringify({workspace: '/workspace'}))
                : new Response(null, {status: 503});
        })).rejects.toThrow('errors.syncReadHttp');
        expect(methods).toEqual(['GET', 'GET']);
    });
    it('re-reads server deletions after a concurrent write instead of retrying a stale upload', async () => {
        const base = initialWorkspace(), local = structuredClone(base), r = remote(base);
        local.boards[0].title = 'Local board';
        let raced = false;
        const result = await synchronize(local, {...config, base}, async (url, init) => {
            if (init.method === 'PUT' && !raced) {
                raced = true;
                r.change({...structuredClone(base), notes: []});
            }
            return r.transport(url, init);
        });
        expect(result.kind).toBe('synced');
        expect(raced).toBe(true);
        expect(r.read()?.notes).toEqual([]);
        expect(r.read()?.boards[0].title).toBe('Local board');
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
