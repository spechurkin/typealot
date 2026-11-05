import {afterEach, expect, it, vi} from 'vitest';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
// @ts-expect-error Server-only module.
import {createUpdateGate, IDLE_INTERVAL, SERVER_CHECK_INTERVAL} from '../../server/update-gate.mjs';
// @ts-expect-error Server-only module.
import {updateServer} from '../../server/server-update.mjs';

const temporary: string[] = [];
afterEach(async () => {
    for (const directory of temporary.splice(0)) await rm(directory, {recursive: true, force: true});
});

it('waits five minutes after activity and completion, freezes new work, and recovers an expired lease', () => {
    let time = 1000;
    const notify = vi.fn();
    const gate = createUpdateGate({now: () => time, notify});
    time += IDLE_INTERVAL - 1;
    expect(gate.prepare('one')).toBe(false);
    gate.activity();
    time += IDLE_INTERVAL - 1;
    expect(gate.prepare('one')).toBe(false);
    const done = gate.begin();
    time += IDLE_INTERVAL + 1;
    expect(gate.prepare('one')).toBe(false);
    done();
    done();
    expect(gate.status().pending).toBe(0);
    time += IDLE_INTERVAL;
    expect(gate.prepare('one')).toBe(true);
    expect(gate.begin()).toBeNull();
    expect(gate.prepare('two')).toBe(false);
    gate.cancel('two');
    expect(gate.status().updating).toBe(true);
    const restarted = createUpdateGate({now: () => time, initialLease: {id: 'one', expiresAt: time + 100}});
    expect(restarted.begin()).toBeNull();
    time += 101;
    expect(restarted.status().updating).toBe(false);
    gate.cancel('one');
    expect(gate.status().updating).toBe(false);
    expect(notify).toHaveBeenCalled();
});

async function fixture() {
    await mkdir('test-results', {recursive: true});
    const directory = await mkdtemp(path.resolve('test-results/update-'));
    temporary.push(directory);
    const root = path.join(directory, 'app');
    await mkdir(path.join(root, 'runtime'), {recursive: true});
    await writeFile(path.join(root, 'runtime/node'), 'test runtime');
    await writeFile(path.join(root, 'package.json'), JSON.stringify({version: '1.0.0'}));
    const configPath = path.join(directory, 'config.json');
    await writeFile(configPath, JSON.stringify({serverManifest: 'https://example.test/server.json'}));
    const files: Record<string, string> = {};
    for (const name of ['dist/index.html', 'scripts/sync-server.mjs', 'scripts/server-backups.mjs', 'scripts/realtime.mjs', 'scripts/server-update.mjs', 'scripts/update-gate.mjs', 'shared/updates.mjs']) files[name] = Buffer.from('test content').toString('base64');
    files['package.json'] = Buffer.from(JSON.stringify({
        version: '1.1.0',
        dependencies: {ssh2: '1', ws: '1'}
    })).toString('base64');
    const bundle = gzipSync(JSON.stringify(files));
    const release = {
        version: '1.1.0',
        url: 'https://example.test/bundle',
        sha256: createHash('sha256').update(bundle).digest('hex')
    };
    const download = vi.fn(async (url: string) => url.endsWith('server.json') ? Buffer.from(JSON.stringify(release)) : bundle);
    const control = vi.fn(async (_action: string, _id: string) => true);
    const command = vi.fn();
    let clock = 1000;
    const options = {
        root,
        configPath,
        stage: path.join(directory, 'next'),
        backup: path.join(directory, 'previous'),
        statePath: path.join(directory, 'state.json'),
        now: () => clock,
        download,
        command,
        control,
        isIdle: async () => true,
        delay: async () => {
        },
        health: async () => new Response(JSON.stringify({serverVersion: '1.1.0'}))
    };
    return {
        options, download, control, command, release, advance: (delta: number) => {
            clock += delta;
        }
    };
}

it('persists the six-hour check schedule and retries a pending update after idle without fetching the manifest again', async () => {
    const f = await fixture();
    f.control.mockResolvedValue(false);
    await updateServer(f.options);
    expect(f.command.mock.calls.some(call => call[0] === 'systemctl')).toBe(false);
    f.advance(60000);
    f.control.mockResolvedValue(true);
    await updateServer(f.options);
    expect(f.download.mock.calls.filter(call => call[0].endsWith('server.json'))).toHaveLength(1);
    expect(JSON.parse(await readFile(path.join(f.options.root, 'package.json'), 'utf8')).version).toBe('1.1.0');
    expect(f.control.mock.calls.map(call => call[0])).toEqual(['prepare', 'prepare', 'cancel']);
    await updateServer(f.options);
    expect(f.download).toHaveBeenCalledTimes(3);
    f.advance(SERVER_CHECK_INTERVAL);
    await updateServer(f.options);
    expect(f.download.mock.calls.filter(call => call[0].endsWith('server.json'))).toHaveLength(2);
});

it('verifies the checksum before entering maintenance or stopping the server', async () => {
    const f = await fixture();
    f.release.sha256 = '0'.repeat(64);
    await expect(updateServer(f.options)).rejects.toThrow('Checksum mismatch');
    expect(f.control).not.toHaveBeenCalled();
    expect(f.command).not.toHaveBeenCalled();
});

it('keeps the release pending while users are active without downloading or installing its package', async () => {
    const f = await fixture();
    f.options.isIdle = async () => false;
    await updateServer(f.options);
    f.advance(60000);
    await updateServer(f.options);
    expect(f.download).toHaveBeenCalledTimes(1);
    expect(f.command).not.toHaveBeenCalled();
    f.options.isIdle = async () => true;
    await updateServer(f.options);
    expect(f.download).toHaveBeenCalledTimes(2);
    expect(f.control.mock.calls.map(call => call[0])).toEqual(['prepare', 'cancel']);
});

it('rolls back a failed release and releases maintenance', async () => {
    const f = await fixture();
    f.options.health = async () => new Response('{}', {status: 503});
    await expect(updateServer(f.options)).rejects.toThrow('readiness');
    expect(JSON.parse(await readFile(path.join(f.options.root, 'package.json'), 'utf8')).version).toBe('1.0.0');
    expect(f.control.mock.calls.at(-1)?.[0]).toBe('cancel');
    expect(f.command.mock.calls.filter(call => call[0] === 'systemctl').map(call => call[1][0])).toEqual(['stop', 'start', 'stop', 'start']);
});
