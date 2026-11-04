import {afterEach, describe, expect, it} from 'vitest';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const require = createRequire(import.meta.url);
const {Server} = require('ssh2');
const {installServer, installationScript, validate, deploymentBundle} = require('../electron/ssh-install.cjs');
const hostKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs1', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'}
}).privateKey;
const cleanup: Array<() => void> = [];
afterEach(() => {
    cleanup.splice(0).forEach(fn => fn());
});

async function server(root = true, fail = false) {
    const commands: string[] = [], inputs: string[] = [], connections: any[] = [];
    const ssh = new Server({hostKeys: [hostKey]}, (client: any) => {
        connections.push(client);
        client.on('error', () => {
        });
        client.on('authentication', (ctx: any) => ctx.method === 'password' && ctx.username === 'operator' && ctx.password === 'one-use-secret' ? ctx.accept() : ctx.reject());
        client.on('ready', () => client.on('session', (accept: any) => {
            const session = accept();
            session.on('exec', (accept: any, _reject: any, info: any) => {
                commands.push(info.command);
                const stream = accept();
                if (info.command.startsWith('mktemp')) {
                    stream.write('/tmp/typealot-install.test\n');
                    stream.exit(0);
                    stream.end();
                    return;
                }
                if (info.command === 'id -u') {
                    stream.write(root ? '0\n' : '1000\n');
                    stream.exit(0);
                    stream.end();
                    return;
                }
                let input = '';
                stream.on('data', (chunk: Buffer) => {
                    input += chunk.toString();
                });
                stream.on('end', () => {
                    inputs.push(input);
                    if (fail && info.command.startsWith('sudo')) stream.stderr.write('one-use-secret: rejected');
                    stream.exit(fail && info.command.startsWith('sudo') ? 1 : 0);
                    stream.end();
                });
            });
        }));
    });
    await new Promise<void>(resolve => ssh.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => {
        connections.forEach(client => client.end());
        ssh.close();
    });
    return {
        commands,
        inputs,
        config: {host: '127.0.0.1', port: ssh.address().port, username: 'operator', password: 'one-use-secret'}
    };
}

describe('one-use SSH installation', () => {
    it('packages the web app and the backend needed for browser SSH installations', async () => {
        const files = JSON.parse(gunzipSync(await deploymentBundle()).toString());
        for (const name of ['dist/index.html', 'scripts/sync-server.mjs', 'scripts/server-backups.mjs', 'scripts/update-gate.mjs', 'scripts/server-update.mjs', 'scripts/ssh-browser.cjs', 'electron/ssh-install.cjs']) expect(files[name]).toBeTruthy();
        expect(Object.keys(files).some(name => /^dist\/assets\/.*\.js$/.test(name))).toBe(true);
        const dependencies = JSON.parse(Buffer.from(files['package.json'], 'base64').toString()).dependencies;
        expect(Object.keys(dependencies).sort()).toEqual(['@noble/hashes', '@tiptap/y-tiptap', 'lib0', 'ssh2', 'ws', 'y-protocols', 'yjs']);
        for (const name of ['scripts/realtime.mjs', 'shared/collaboration.mjs', 'shared/board-patches.mjs']) expect(files[name]).toBeTruthy();
        expect(Object.keys(files).some(name => /workspace|test-results|\.typealot-sync/.test(name))).toBe(false);
    });
    it('authenticates over real SSH, verifies the host and transfers the bundled server', async () => {
        const remote = await server();
        const fingerprints: string[] = [];
        expect(await installServer(remote.config, ({fingerprint}: any) => {
            fingerprints.push(fingerprint);
            return true;
        })).toEqual({host: '127.0.0.1', port: 80});
        expect(fingerprints[0]).toMatch(/^SHA256:[a-zA-Z0-9+/]+$/);
        expect(remote.commands[0]).toBe('id -u');
        expect(remote.commands[3]).toContain('typealot-sync.service');
        expect(remote.commands.join('')).not.toContain(remote.config.password);
        expect(remote.inputs[1]).toBe('');
    });
    it('sends the sudo password through stdin without putting it in the command', async () => {
        const remote = await server(false);
        await installServer(remote.config, () => true);
        expect(remote.commands[3]).toMatch(/^sudo -k -S/);
        expect(remote.commands[3]).not.toContain(remote.config.password);
        expect(remote.inputs[1]).toBe('one-use-secret\n');
    });
    it('rejects incorrect credentials before sending installation commands', async () => {
        const remote = await server();
        await expect(installServer({...remote.config, password: 'wrong'}, () => true)).rejects.toThrow();
        expect(remote.commands).toEqual([]);
    });
    it('does not authenticate or install when the host is rejected', async () => {
        const remote = await server();
        await expect(installServer(remote.config, () => false)).rejects.toThrow();
        expect(remote.commands).toEqual([]);
    });
    it('reports failure and redacts the password in remote output', async () => {
        const remote = await server(false, true);
        const error = await installServer(remote.config, () => true).catch((error: any) => error);
        expect(error.message).toBe('installFailed');
        expect(error.detail).toBe('[redacted]: rejected');
    });
    it('validates ports and line breaks before connecting', () => {
        for (const patch of [{port: 0}, {port: 65536}, {host: 'host/path'}, {password: 'secret\ncommand'}]) expect(() => validate({
            host: 'localhost',
            port: 22,
            username: 'user',
            password: 'test', ...patch
        })).toThrow('invalidInput');
    });
    it('keeps data outside program files and verifies discovery before success', () => {
        const script = installationScript('console.log("payload")');
        expect(script).toContain('/var/lib/typealot');
        expect(script).toContain('/.well-known/typealot');
        expect(script).toContain('systemctl is-active');
        expect(script).toContain('OnCalendar=*-*-* *:*:00');
        expect(script).toContain('Persistent=true');
        expect(script).toContain('flock -n /opt/typealot-update.lock');
        expect(script).toContain('if(!config.serverManifest&&incoming.serverManifest)');
        expect(script).not.toMatch(/rm\s|SYNC_TOKEN|ADMIN_PASSWORD/);
    });
});
