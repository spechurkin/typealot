import http from 'node:http';
import https from 'node:https';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {attachRealtime} from './realtime.mjs';
import {createUpdateGate} from './update-gate.mjs';
import {
    createServerBackups,
    DEFAULT_RETENTION_MONTHS,
    scheduleServerBackups,
    validRetentionMonths
} from './server-backups.mjs';

const packageInfo = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const appVersion = packageInfo.appVersion || packageInfo.version;
const serverVersion = packageInfo.serverVersion || packageInfo.version;
const browserSsh = createRequire(import.meta.url)('./ssh-browser.cjs').sshMiddleware({localOnly: false});
const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const serveApp = async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(404).end();
        return;
    }
    let target;
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        target = path.resolve(webRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    } catch {
        res.writeHead(400).end();
        return;
    }
    if (!target.startsWith(webRoot + path.sep)) {
        res.writeHead(404).end();
        return;
    }
    try {
        const body = await readFile(target);
        const types = {
            '.html': 'text/html; charset=utf-8',
            '.js': 'text/javascript; charset=utf-8',
            '.css': 'text/css; charset=utf-8',
            '.svg': 'image/svg+xml',
            '.png': 'image/png',
            '.ico': 'image/x-icon',
            '.json': 'application/json'
        };
        res.writeHead(200, {
            'Content-Type': types[path.extname(target)] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'strict-origin-when-cross-origin',
            'Cache-Control': 'no-store'
        }).end(req.method === 'HEAD' ? undefined : body);
    } catch {
        res.writeHead(404).end();
    }
};

const directory = path.resolve(process.env.TYPEALOT_SYNC_DIRECTORY || '.typealot-sync');
await mkdir(directory, {recursive: true});
const filename = path.join(directory, 'workspace.json'), configFile = path.join(directory, 'server-config.json');
let config = {maxUploadMb: 150, backupCount: 12, backupRetentionMonths: DEFAULT_RETENTION_MONTHS};
try {
    config = {...config, ...JSON.parse(await readFile(configFile, 'utf8'))};
} catch (e) {
    if (e.code !== 'ENOENT') throw e;
}
if (!validRetentionMonths(config.backupRetentionMonths)) config.backupRetentionMonths = DEFAULT_RETENTION_MONTHS;
const backups = createServerBackups({directory, getConfig: () => config});
await backups.initialize();
await backups.prune();
const hash = data => `"${createHash('sha256').update(data).digest('hex')}"`;
let queue = Promise.resolve();
let realtime;
const maintenanceFile = path.join(directory, 'update-maintenance.json');
let initialLease = null;
try {
    initialLease = JSON.parse(await readFile(maintenanceFile, 'utf8'));
} catch (e) {
    if (e.code !== 'ENOENT') throw e;
}
const updateGate = createUpdateGate({initialLease, notify: state => realtime?.maintenance(state)});
const controlToken = randomUUID();
await writeFile(path.join(directory, 'update-control.json'), JSON.stringify({token: controlToken}), {mode: 0o600});
const enqueue = task => {
    const done = updateGate.begin();
    if (!done) return Promise.reject(Error('Server updating'));
    queue = queue.catch(() => {
    }).then(task).finally(done);
    return queue;
};
scheduleServerBackups(enqueue, backups, error => console.error('Server backup failed:', error));
const persist = async body => {
    const temp = path.join(directory, `${randomUUID()}.tmp`);
    await writeFile(temp, body);
    await rename(temp, filename);
    return hash(body);
};
const json = (res, status, data) => res.writeHead(status, {'Content-Type': 'application/json'}).end(JSON.stringify(data));
const readBody = async (req, limit) => {
    const chunks = [];
    let size = 0;
    for await(const chunk of req) {
        size += chunk.length;
        if (size > limit) throw Object.assign(Error('Request too large'), {status: 413});
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
};
const exists = async () => {
    try {
        await readFile(filename);
        return true;
    } catch (e) {
        if (e.code === 'ENOENT') return false;
        throw e;
    }
};
const administrative = async (req, res) => {
    if (req.url === '/admin/config' && req.method === 'GET') {
        await queue;
        json(res, 200, {...config, workspaceExists: await exists()});
        return;
    }
    if (req.url === '/admin/config' && req.method === 'PATCH') {
        let input;
        try {
            input = JSON.parse(await readBody(req, 8192));
        } catch {
            json(res, 400, {error: 'Неверные настройки'});
            return;
        }
        if (!Number.isInteger(input.maxUploadMb) || input.maxUploadMb < 1 || input.maxUploadMb > 150 || !Number.isInteger(input.backupCount) || input.backupCount < 1 || input.backupCount > 50) {
            json(res, 400, {error: 'Недопустимые ограничения'});
            return;
        }
        const retention = input.backupRetentionMonths === undefined ? config.backupRetentionMonths : input.backupRetentionMonths;
        if (!validRetentionMonths(retention)) {
            json(res, 400, {error: 'Недопустимый срок хранения'});
            return;
        }
        const next = {maxUploadMb: input.maxUploadMb, backupCount: input.backupCount, backupRetentionMonths: retention};
        await enqueue(async () => {
            await writeFile(configFile, JSON.stringify(next));
            config = next;
            await backups.prune();
        });
        json(res, 200, {...config, workspaceExists: await exists()});
        return;
    }
    json(res, 404, {error: 'Неизвестная команда'});
};
const handle = async (req, res) => {
    if (req.url?.startsWith('/__typealot/ssh')) return browserSsh(req, res, () => res.writeHead(404).end());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Match, If-None-Match, X-Typealot-Session');
    res.setHeader('Access-Control-Expose-Headers', 'ETag');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
        res.writeHead(204).end();
        return;
    }
    if (req.url === '/__typealot/update' && req.method === 'GET') {
        json(res, 200, updateGate.status());
        return;
    }
    if (req.url === '/__typealot/activity' && req.method === 'POST') {
        updateGate.activity();
        res.writeHead(204).end();
        return;
    }
    if (req.url === '/__typealot/update/prepare' || req.url === '/__typealot/update/cancel') {
        if (req.method !== 'POST' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || req.headers.authorization !== `Bearer ${controlToken}`) {
            res.writeHead(403).end();
            return;
        }
        const input = JSON.parse(await readBody(req, 1024));
        if (typeof input.id !== 'string' || input.id.length > 100) {
            res.writeHead(400).end();
            return;
        }
        if (req.url.endsWith('/cancel')) {
            if (updateGate.status().updateId === input.id) {
                await unlink(maintenanceFile).catch(e => {
                    if (e.code !== 'ENOENT') throw e;
                });
                updateGate.cancel(input.id);
            }
            json(res, 200, updateGate.status());
            return;
        }
        const prepared = updateGate.prepare(input.id);
        if (prepared) {
            const state = updateGate.status();
            try {
                await writeFile(maintenanceFile + '.tmp', JSON.stringify({
                    id: state.updateId,
                    expiresAt: state.expiresAt
                }), {mode: 0o600});
                await rename(maintenanceFile + '.tmp', maintenanceFile);
            } catch (e) {
                updateGate.cancel(input.id);
                throw e;
            }
        }
        json(res, prepared ? 200 : 409, updateGate.status());
        return;
    }
    if (req.url === '/__typealot/version' && req.method === 'GET') {
        json(res, 200, {version: appVersion, serverVersion});
        return;
    }
    if (req.url?.startsWith('/admin/')) return administrative(req, res);
    if (req.url === '/.well-known/typealot' && req.method === 'GET') {
        json(res, 200, {workspace: '/workspace', realtime: '/realtime', application: true, appVersion, serverVersion});
        return;
    }
    if (req.url !== '/workspace') return serveApp(req, res);
    if (req.method === 'GET') {
        await queue.catch(() => {
        });
        try {
            const body = await readFile(filename);
            res.writeHead(200, {'Content-Type': 'application/json', 'ETag': hash(body)}).end(body);
        } catch (e) {
            res.writeHead(e.code === 'ENOENT' ? 404 : 500).end();
        }
        return;
    }
    if (req.method !== 'PUT') {
        res.writeHead(405).end();
        return;
    }
    const body = await readBody(req, config.maxUploadMb * 1024 * 1024);
    let value;
    try {
        value = JSON.parse(body);
        if (value.version !== 1 || !Array.isArray(value.notes) || !Array.isArray(value.boards) || !Array.isArray(value.attachments) || !Array.isArray(value.folders)) throw Error();
    } catch {
        res.writeHead(400).end();
        return;
    }
    await enqueue(async () => {
        let previous;
        try {
            previous = await readFile(filename);
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
        }
        if (previous ? req.headers['if-match'] !== hash(previous) : req.headers['if-none-match'] !== '*') {
            res.writeHead(412).end();
            return;
        }
        if (previous && !realtime.checkWorkspace(JSON.parse(previous.toString()), value, req.headers['x-typealot-session'])) {
            json(res, 423, {error: 'Object is being edited'});
            return;
        }
        const etag = await persist(body);
        res.writeHead(200, {'ETag': etag}).end();
        realtime?.changed(etag);
    });
};
const listener = (req, res) => {
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !['/__typealot/activity', '/__typealot/update/prepare', '/__typealot/update/cancel'].includes(req.url);
    if (mutation) {
        const done = updateGate.begin();
        if (!done) {
            res.writeHead(503, {'Access-Control-Allow-Origin': '*', 'Retry-After': '5'}).end();
            return;
        }
        res.once('finish', done);
        res.once('close', done);
    }
    void handle(req, res).catch(e => {
        if (!res.headersSent) json(res, e.status || 500, {error: e.status === 413 ? 'Слишком большой запрос' : 'Ошибка сервера'}); else if (!res.writableEnded) res.end();
    });
};
const cert = process.env.TYPEALOT_SYNC_CERT, key = process.env.TYPEALOT_SYNC_KEY;
const server = cert && key ? https.createServer({
    cert: await readFile(cert),
    key: await readFile(key)
}, listener) : http.createServer(listener);
realtime = attachRealtime(server, {
    updateGate,
    enqueue,
    read: async () => {
        try {
            return JSON.parse(await readFile(filename, 'utf8'));
        } catch (e) {
            if (e.code === 'ENOENT') return null;
            throw e;
        }
    },
    write: async workspace => {
        const body = Buffer.from(JSON.stringify(workspace));
        if (body.length > config.maxUploadMb * 1024 * 1024) throw Error('Workspace too large');
        return persist(body);
    },
    maxBytes: () => config.maxUploadMb * 1024 * 1024
});
const port = Number(process.env.TYPEALOT_SYNC_PORT || 47832);
server.listen(port, process.env.TYPEALOT_SYNC_HOST || '127.0.0.1', () => console.log(`Typealot sync listening on ${port}; /workspace`));
