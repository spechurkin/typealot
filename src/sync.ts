import {LocalizedError} from './i18n';
import {sha256Hex} from './crypto';
import {validateWorkspace, type Workspace} from './model';
import {type FileConflict, mergeWorkspaces} from './merge';

export type SyncSettings = {
    url: string;
    automatic: boolean;
    administration?: boolean;
    digest?: string;
    etag?: string;
    base?: Workspace;
    session?: string
};
export type SyncTransport = (url: string, init: RequestInit) => Promise<Response>;
export type ServerConnection = { workspace: string; realtime?: string };
export type SyncResult =
    { kind: 'synced'; workspace: Workspace; digest: string; etag: string; connection?: ServerConnection }
    | {
    kind: 'conflict';
    remote: Workspace;
    workspace: Workspace;
    conflicts: FileConflict[];
    etag: string;
    connection?: ServerConnection
};
export const defaultSync: SyncSettings = {url: '', automatic: true};

export function syncUrl(raw: string): string {
    const address = raw.trim();
    const explicitScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(address);
    const url = new URL(explicitScheme ? address : `http://${address}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.search || url.pathname !== '/') throw new LocalizedError('errors.syncAddress');
    return url.href;
}

export async function discoverWorkspace(raw: string, transport: SyncTransport = fetch): Promise<string> {
    return (await discoverServer(raw, transport)).workspace;
}

export async function discoverServer(raw: string, transport: SyncTransport = fetch): Promise<ServerConnection> {
    const base = syncUrl(raw);
    const response = await transport(new URL('/.well-known/typealot', base).href, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new LocalizedError('errors.syncDiscoveryHttp', {status: response.status});
    const manifest = await response.json();
    if (typeof manifest.workspace !== 'string' || !manifest.workspace) throw new LocalizedError('errors.syncPathMissing');
    const endpoint = new URL(manifest.workspace, base);
    if (endpoint.origin !== new URL(base).origin || endpoint.username || endpoint.password || endpoint.hash) throw new LocalizedError('errors.syncPathInvalid');
    let realtime: string | undefined;
    if (typeof manifest.realtime === 'string') {
        const socket = new URL(manifest.realtime, base);
        const origin = new URL(socket.href);
        if (origin.protocol === 'wss:') origin.protocol = 'https:'; else if (origin.protocol === 'ws:') origin.protocol = 'http:';
        if (origin.origin !== new URL(base).origin || socket.username || socket.password || socket.hash) throw new LocalizedError('errors.syncPathInvalid');
        socket.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:';
        realtime = socket.href;
    }
    return {workspace: endpoint.href, realtime};
}

export function portableWorkspace(w: Workspace): Workspace {
    return {
        ...w,
        profile: {name: '', handle: '', show: false},
        theme: 'dark',
        sidebar: true,
        sidebarWidth: 260,
        markdown: false,
        boards: w.boards.map(b => ({
            ...b,
            viewport: {x: 0, y: 0, zoom: 1},
            nodes: b.nodes.map(({selected, dragging, measured, resizing, draggable, deletable, ...n}) => n),
            edges: b.edges.map(({selected, ...e}) => e)
        }))
    };
}

export async function digestWorkspace(w: Workspace): Promise<string> {
    const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, value]) => [k, canonical(value)])) : v;
    return sha256Hex(JSON.stringify(canonical(portableWorkspace(w))));
}

async function readRemote(endpoint: string, transport: SyncTransport) {
    const response = await transport(endpoint, {
        method: 'GET',
        credentials: 'omit',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000)
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new LocalizedError('errors.syncReadHttp', {status: response.status});
    const remote = validateWorkspace(await response.json());
    const etag = response.headers.get('ETag');
    if (!etag || etag.startsWith('W/')) throw new LocalizedError('errors.syncETagRequired');
    return {remote, etag};
}

export async function uploadWorkspace(w: Workspace, config: SyncSettings, etag: string | null, transport: SyncTransport = fetch): Promise<SyncResult> {
    return writeRemote(w, await discoverWorkspace(config.url, transport), etag, transport, config.session);
}

async function writeRemote(w: Workspace, endpoint: string, etag: string | null, transport: SyncTransport, session?: string): Promise<SyncResult> {
    const response = await transport(endpoint, {
        method: 'PUT',
        credentials: 'omit',
        headers: {'Content-Type': 'application/json', ...(session ? {'X-Typealot-Session': session} : {}), ...(etag ? {'If-Match': etag} : {'If-None-Match': '*'})},
        body: JSON.stringify(portableWorkspace(w)),
        signal: AbortSignal.timeout(20000)
    });
    if (response.status === 412) throw new LocalizedError('errors.syncRemoteChanged');
    if (!response.ok) throw new LocalizedError('errors.syncWriteHttp', {status: response.status});
    const next = response.headers.get('ETag');
    if (!next || next.startsWith('W/')) throw new LocalizedError('errors.syncETagMissing');
    return {kind: 'synced', workspace: w, digest: await digestWorkspace(w), etag: next};
}

export async function synchronize(w: Workspace, config: SyncSettings, transport: SyncTransport = fetch): Promise<SyncResult> {
    const connection = await discoverServer(config.url, transport);
    const current = await digestWorkspace(w);
    for (let attempt = 0; attempt < 6; attempt++) {
        const remote = await readRemote(connection.workspace, transport);
        try {
            if (!remote) return {
                ...await writeRemote(w, connection.workspace, null, transport, config.session),
                connection
            };
            const hash = await digestWorkspace(remote.remote);
            if (hash === current) return {kind: 'synced', workspace: w, digest: current, etag: remote.etag, connection};
            const base = config.base || (current === config.digest ? w : hash === config.digest ? remote.remote : undefined);
            const merged = mergeWorkspaces(base, w, remote.remote);
            if (merged.conflicts.length) return {
                kind: 'conflict',
                remote: remote.remote,
                workspace: merged.workspace,
                conflicts: merged.conflicts,
                etag: remote.etag,
                connection
            };
            const digest = await digestWorkspace(merged.workspace);
            if (digest === hash) return {
                kind: 'synced',
                workspace: merged.workspace,
                digest,
                etag: remote.etag,
                connection
            };
            return {
                ...await writeRemote(merged.workspace, connection.workspace, remote.etag, transport, config.session),
                connection
            };
        } catch (error) {
            if (!(error instanceof LocalizedError) || error.key !== 'errors.syncRemoteChanged' || attempt === 5) throw error;
        }
    }
    throw new LocalizedError('errors.syncRemoteChanged');
}
