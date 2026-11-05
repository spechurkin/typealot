import {cp, mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createHash, randomUUID} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {newerVersion, releaseUrl, resolveManifestUrl} from '../shared/updates.mjs';
import {SERVER_CHECK_INTERVAL} from './update-gate.mjs';

export function decodeBundle(body) {
    const files = JSON.parse(gunzipSync(body, {maxOutputLength: 256 * 1024 * 1024}));
    const names = Object.keys(files);
    for (const name of names) {
        if (!/^(dist\/|scripts\/|electron\/|shared\/|package\.json$|release-config\.json$)/.test(name) || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || typeof files[name] !== 'string') throw Error('Invalid deployment path');
    }
    for (const name of ['package.json', 'dist/index.html', 'scripts/sync-server.mjs', 'scripts/server-backups.mjs', 'scripts/realtime.mjs', 'scripts/server-update.mjs', 'scripts/update-gate.mjs', 'shared/updates.mjs']) if (!files[name]) throw Error('Incomplete release');
    const pkg = JSON.parse(Buffer.from(files['package.json'], 'base64'));
    if (!pkg.version || !pkg.dependencies?.ssh2 || !pkg.dependencies?.ws) throw Error('Invalid server package');
    return files;
}

async function fetchBytes(url, limit) {
    let response;
    for (let n = 0; n < 6; n++) {
        response = await fetch(releaseUrl(url), {redirect: 'manual', signal: AbortSignal.timeout(120000)});
        if (![301, 302, 303, 307, 308].includes(response.status)) break;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) throw Error('Invalid release redirect');
        url = releaseUrl(new URL(location, url).href);
        response = null;
    }
    if (!response) throw Error('Too many release redirects');
    if (!response.ok) throw Error(`Release HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw Error('Release too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

export async function updateServer(options = {}) {
    const root = options.root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (!options.root && (process.platform !== 'linux' || root !== '/opt/typealot')) throw Error('Updater requires the systemd installation at /opt/typealot');
    const now = options.now || Date.now, download = options.download || fetchBytes;
    const delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    const health = options.health || fetch;
    const statePath = options.statePath || '/var/lib/typealot-updater/state.json';
    let config;
    try {
        config = JSON.parse(await readFile(options.configPath || '/etc/typealot-updates.json', 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    if (!config.serverManifest) return;
    const stage = options.stage || '/opt/typealot-next', backup = options.backup || '/opt/typealot-previous';
    const command = options.command || ((name, args) => execFileSync(name, args, {stdio: 'inherit', timeout: 180000}));
    let state = {nextCheckAt: 0, pending: null};
    try {
        state = {...state, ...JSON.parse(await readFile(statePath, 'utf8'))};
    } catch (e) {
        if (e.code !== 'ENOENT') throw e;
    }
    const save = async () => {
        await mkdir(path.dirname(statePath), {recursive: true});
        await writeFile(statePath + '.tmp', JSON.stringify(state), {mode: 0o600});
        await rename(statePath + '.tmp', statePath);
    };
    const control = options.control || (async (action, id) => {
        const {token} = JSON.parse(await readFile('/var/lib/typealot/update-control.json', 'utf8'));
        const target = new URL(config.healthUrl || 'http://127.0.0.1/.well-known/typealot');
        if (!['127.0.0.1', '[::1]'].includes(target.hostname)) throw Error('Local update control required');
        const response = await fetch(new URL('/__typealot/update/' + action, target), {
            method: 'POST',
            headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
            body: JSON.stringify({id}),
            signal: AbortSignal.timeout(5000)
        });
        if (response.status === 409) return false;
        if (!response.ok) throw Error(`Update control HTTP ${response.status}`);
        return true;
    });
    const isIdle = options.isIdle || (async () => {
        const target = new URL(config.healthUrl || 'http://127.0.0.1/.well-known/typealot');
        if (!['127.0.0.1', '[::1]'].includes(target.hostname)) throw Error('Local update control required');
        const response = await fetch(new URL('/__typealot/update', target), {signal: AbortSignal.timeout(5000)});
        if (!response.ok) throw Error(`Update status HTTP ${response.status}`);
        return (await response.json()).idle === true;
    });
    let moved = false, stopped = false, prepared = false;
    const updateId = randomUUID();
    try {
        const current = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
        if (now() >= state.nextCheckAt) {
            const due = state.nextCheckAt || now();
            state.nextCheckAt = due + (Math.floor((now() - due) / SERVER_CHECK_INTERVAL) + 1) * SERVER_CHECK_INTERVAL;
            await save();
            const manifestUrl = await resolveManifestUrl(config.serverManifest, 'server', 'server.json', async url => new Response(await download(String(url), 4 * 1024 * 1024)));
            const manifest = JSON.parse(await download(manifestUrl, 65536));
            state.pending = newerVersion(manifest.version, current.version) ? manifest : null;
            await save();
        }
        const release = state.pending;
        if (!release || !newerVersion(release.version, current.version)) return;
        if (!/^[a-f0-9]{64}$/.test(release.sha256)) throw Error('Invalid checksum');
        if (!await isIdle()) return;
        const body = await download(release.url, 64 * 1024 * 1024);
        if (createHash('sha256').update(body).digest('hex') !== release.sha256) throw Error('Checksum mismatch');
        const files = decodeBundle(body);
        if (JSON.parse(Buffer.from(files['package.json'], 'base64')).version !== release.version) throw Error('Version mismatch');
        await rm(stage, {recursive: true, force: true});
        await mkdir(stage);
        for (const [name, data] of Object.entries(files)) {
            const target = path.join(stage, name);
            await mkdir(path.dirname(target), {recursive: true});
            await writeFile(target, Buffer.from(data, 'base64'));
        }
        await cp(path.join(root, 'runtime'), path.join(stage, 'runtime'), {recursive: true});
        command('npm', ['install', '--prefix', stage, '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund']);
        command(path.join(stage, 'runtime/node'), ['--check', path.join(stage, 'scripts/sync-server.mjs')]);
        if (!await control('prepare', updateId)) return;
        prepared = true;
        await delay(2500);
        await rm(backup, {recursive: true, force: true});
        command('systemctl', ['stop', 'typealot-sync.service']);
        stopped = true;
        await rename(root, backup);
        moved = true;
        await rename(stage, root);
        command('systemctl', ['start', 'typealot-sync.service']);
        let healthy = false;
        for (let n = 0; n < 30; n++) {
            try {
                const r = await health(config.healthUrl || 'http://127.0.0.1/.well-known/typealot', {signal: AbortSignal.timeout(1000)});
                if (r.ok && (await r.json()).serverVersion === release.version) {
                    healthy = true;
                    break;
                }
            } catch {
            }
            await delay(1000);
        }
        if (!healthy) throw Error('Updated server failed readiness check');
        state.pending = null;
        await save();
        console.log(`Typealot server updated to ${release.version}`);
    } catch (error) {
        if (moved) {
            command('systemctl', ['stop', 'typealot-sync.service']);
            await rm(root, {recursive: true, force: true});
            await rename(backup, root);
        }
        if (stopped) command('systemctl', ['start', 'typealot-sync.service']);
        throw error;
    } finally {
        if (prepared) {
            for (let attempt = 0; attempt < 30; attempt++) {
                try {
                    await control('cancel', updateId);
                    break;
                } catch (error) {
                    if (attempt === 29) console.error('Cannot clear update maintenance:', error); else await delay(1000);
                }
            }
        }
        await rm(stage, {recursive: true, force: true});
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) updateServer().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
