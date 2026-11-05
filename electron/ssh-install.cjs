const {Client} = require('ssh2');
const {createHash} = require('node:crypto');
const {readFile, readdir} = require('node:fs/promises');
const {gzipSync} = require('node:zlib');
const path = require('node:path');

const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";

async function deploymentBundle() {
    const root = path.resolve(__dirname, '..'), files = {};
    const add = async (name, source = name) => {
        let body;
        try {
            body = await readFile(path.join(root, source));
        } catch (error) {
            if (source === name || error.code !== 'ENOENT') throw error;
            body = await readFile(path.join(root, name));
        }
        files[name] = body.toString('base64');
    };
    // Existing updaters and systemd units require these deployment paths.
    await Promise.all(['sync-server', 'server-backups', 'realtime', 'server-update', 'update-gate'].map(name => add(`scripts/${name}.mjs`, `server/${name}.mjs`)));
    await Promise.all(['scripts/dev/ssh-browser.cjs', 'electron/ssh-install.cjs'].map(name => add(name)));
    const walk = async directory => {
        for (const entry of await readdir(path.join(root, directory), {withFileTypes: true})) {
            const name = directory + '/' + entry.name;
            if (entry.isDirectory()) await walk(name); else if (entry.isFile()) await add(name);
        }
    };
    await walk('shared');
    try {
        await walk('dist');
        if (!files['dist/index.html']) throw Error();
    } catch {
        throw Error('buildMissing');
    }
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const dependencies = Object.fromEntries(['ssh2', 'ws', 'yjs', 'y-protocols', 'lib0', '@tiptap/y-tiptap', '@noble/hashes'].map(name => [name, pkg.dependencies[name]]));
    files['package.json'] = Buffer.from(JSON.stringify({
        name: 'typealot-server',
        version: pkg.serverVersion || pkg.version,
        appVersion: pkg.appVersion || pkg.version,
        private: true,
        type: 'module',
        engines: {node: '>=20.19.0'},
        dependencies
    })).toString('base64');
    let releaseConfig = {serverManifest: 'https://github.com/spechurkin/typealot/releases/download/server-latest/server.json'};
    try {
        releaseConfig = JSON.parse(await readFile(path.join(root, 'release-config.json'), 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    if (process.env.TYPEALOT_RELEASE_URL) {
        const {releaseUrl} = await import('../shared/updates.mjs');
        releaseConfig.serverManifest = new URL('server.json', releaseUrl(process.env.TYPEALOT_RELEASE_URL)).href;
    }
    files['release-config.json'] = Buffer.from(JSON.stringify(releaseConfig)).toString('base64');
    return gzipSync(JSON.stringify(files));
}

function installationScript(archive) {
    return `set -eu
diagnostics() {
    echo 'Typealot service diagnostics:' >&2
    systemctl status typealot-sync.service --no-pager --full >&2 || true
    journalctl -u typealot-sync.service -n 40 --no-pager >&2 || true
}
test "$(uname -s)" = Linux || { echo 'Linux required' >&2; exit 1; }
command -v systemctl >/dev/null || { echo 'systemd required' >&2; exit 1; }
test -d /run/systemd/system || { echo 'systemd must be running' >&2; exit 1; }
if ! command -v node >/dev/null || ! node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>20||major===20&&minor>=19?0:1)'; then
    command -v apt-get >/dev/null || { echo 'Install Node.js 20.19+ first on this Linux distribution' >&2; exit 1; }
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y nodejs npm
fi
node -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major>20||major===20&&minor>=19?0:1)' || { echo 'Node.js 20.19+ required' >&2; exit 1; }
getent group typealot >/dev/null 2>&1 || groupadd --system typealot
id typealot >/dev/null 2>&1 || useradd --system --gid typealot --home-dir /var/lib/typealot --shell /usr/sbin/nologin typealot
install -d -m 755 /opt/typealot
install -d -m 700 -o typealot -g typealot /var/lib/typealot
node -e 'const fs=require("fs"),path=require("path"),zlib=require("zlib");
const files=JSON.parse(zlib.gunzipSync(fs.readFileSync(process.argv[1])));
for(const [name,data]of Object.entries(files)){
    if(!/^(dist\\/|scripts\\/|electron\\/|shared\\/|release-config\\.json$|package\\.json$)/.test(name)||name.split("/").some(part=>part===".."||!part))throw Error("Invalid deployment path");
    const target=path.join("/opt/typealot",name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(data,"base64"),{mode:0o644});
}' ${quote(archive)}
node --check /opt/typealot/scripts/sync-server.mjs
if ! command -v npm >/dev/null; then
    command -v apt-get >/dev/null || { echo 'Install npm first' >&2; exit 1; }
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y npm
fi
cd /opt/typealot
npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
SOURCE_NODE=$(node -p 'process.execPath')
install -d -m 755 /opt/typealot/runtime
install -m 755 "$SOURCE_NODE" /opt/typealot/runtime/node.new
/opt/typealot/runtime/node.new --version
mv -f /opt/typealot/runtime/node.new /opt/typealot/runtime/node
NODE=/opt/typealot/runtime/node
cat > /etc/systemd/system/typealot-sync.service <<EOF
[Unit]
Description=Typealot synchronization
After=network.target
[Service]
Type=simple
User=typealot
Group=typealot
WorkingDirectory=/var/lib/typealot
Environment=TYPEALOT_SYNC_DIRECTORY=/var/lib/typealot
Environment=TYPEALOT_SYNC_HOST=0.0.0.0
Environment=TYPEALOT_SYNC_PORT=80
Environment=PATH=/opt/typealot/runtime:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE /opt/typealot/scripts/sync-server.mjs
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/typealot
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
if [ ! -f /etc/typealot-updates.json ]; then
    install -m 600 /opt/typealot/release-config.json /etc/typealot-updates.json
else
    node -e 'const fs=require("fs"),file="/etc/typealot-updates.json",config=JSON.parse(fs.readFileSync(file)),incoming=JSON.parse(fs.readFileSync("/opt/typealot/release-config.json"));if(!config.serverManifest&&incoming.serverManifest){config.serverManifest=incoming.serverManifest;fs.writeFileSync(file,JSON.stringify(config),{mode:0o600});}'
fi
cat > /etc/systemd/system/typealot-update.service <<EOF
[Unit]
Description=Update Typealot server
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
Environment=PATH=/opt/typealot/runtime:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/flock -n /opt/typealot-update.lock $NODE /opt/typealot/scripts/server-update.mjs
TimeoutStartSec=10min
EOF
cat > /etc/systemd/system/typealot-update.timer <<EOF
[Unit]
Description=Check Typealot server releases independently
[Timer]
OnBootSec=2min
OnCalendar=*-*-* *:*:00
AccuracySec=1s
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now typealot-update.timer
systemctl enable typealot-sync.service
systemctl reset-failed typealot-sync.service || true
if ! systemctl restart typealot-sync.service; then diagnostics; exit 1; fi
if ! "$NODE" --input-type=module -e '
let ready=false;
let reason="No HTTP response";
for(let n=0;n<30;n++){
    try{const r=await fetch("http://127.0.0.1/.well-known/typealot",{signal:AbortSignal.timeout(1000)});const app=await fetch("http://127.0.0.1/",{signal:AbortSignal.timeout(1000)});if(r.ok&&app.ok&&(await r.json()).workspace==="/workspace"){ready=true;break;}reason="Discovery HTTP "+r.status+", app HTTP "+app.status;}catch(error){reason=error.cause?.code||error.message;}
    await new Promise(resolve=>setTimeout(resolve,1000));
}
if(!ready){console.error("Typealot HTTP readiness check failed: "+reason);process.exit(1);}'
then diagnostics; exit 1; fi
if ! systemctl is-active --quiet typealot-sync.service; then diagnostics; exit 1; fi
`;
}

function validate(input) {
    if (!input || typeof input.host !== 'string' || !input.host.trim() || input.host.length > 253 || /[\s/@?#]/.test(input.host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535 || typeof input.username !== 'string' || !input.username.trim() || input.username.length > 256 || typeof input.password !== 'string' || !input.password || /[\r\n\0]/.test(input.password)) throw Error('invalidInput');
}

async function installServer(input, verifyHost, options = {}) {
    validate(input);
    const bundle = await deploymentBundle();
    const client = new Client();
    const signal = options.signal;
    let password = input.password;
    let failed;
    const execute = (command, stdin = '') => new Promise((resolve, reject) => {
        client.exec(command, (error, stream) => {
            if (error) {
                reject(error);
                return;
            }
            let output = '';
            const append = data => {
                output = (output + data.toString()).slice(-8192);
            };
            stream.on('data', append);
            stream.stderr.on('data', append);
            stream.on('error', reject);
            stream.on('close', code => code === 0 ? resolve(output) : reject(Object.assign(Error('installFailed'), {detail: output.split(password).join('[redacted]')})));
            stream.end(stdin);
        });
    });
    let rejectConnection;
    const aborted = () => {
        failed = Error('cancelled');
        rejectConnection?.(failed);
        client.destroy();
    };
    const timeout = setTimeout(() => {
        failed = Error('timeout');
        rejectConnection?.(failed);
        client.destroy();
    }, options.timeoutMs || 10 * 60 * 1000);
    signal?.addEventListener('abort', aborted, {once: true});
    try {
        if (signal?.aborted) throw Error('cancelled');
        await new Promise((resolve, reject) => {
            rejectConnection = reject;
            client.on('ready', resolve).on('error', error => {
                failed ||= error;
                reject(failed);
            });
            client.connect({
                host: input.host.trim(),
                port: input.port,
                username: input.username.trim(),
                password,
                readyTimeout: 30000,
                hostVerifier: (key, callback) => {
                    const fingerprint = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
                    Promise.resolve(verifyHost({host: input.host.trim(), port: input.port, fingerprint})).then(ok => {
                        if (!ok) failed = Error('cancelled');
                        callback(!!ok);
                    }, () => {
                        failed = Error('cancelled');
                        callback(false);
                    });
                }
            });
        });
        const root = (await execute('id -u')).trim() === '0';
        const temporary = (await execute('mktemp -d /tmp/typealot-install.XXXXXXXX')).trim();
        if (!/^\/tmp\/typealot-install\.[a-zA-Z0-9]+$/.test(temporary)) throw Error('installFailed');
        const archive = temporary + '/bundle.json.gz';
        try {
            await execute('umask 077; cat > ' + quote(archive), bundle);
            const script = installationScript(archive);
            await execute(root ? '/bin/sh -c ' + quote(script) : "sudo -k -S -p '' /bin/sh -c " + quote(script), root ? '' : password + '\n');
        } finally {
            await execute('unlink ' + quote(archive) + '; rmdir ' + quote(temporary)).catch(() => {
            });
        }
        if (failed) throw failed;
        return {host: input.host.trim(), port: 80};
    } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', aborted);
        password = '';
        if (client.config) client.config.password = undefined;
        client.end();
        client.destroy();
    }
}

async function inspectServer(input) {
    validate({...input, username: 'probe', password: 'probe'});
    const client = new Client();
    try {
        return await new Promise((resolve, reject) => {
            client.on('error', reject);
            client.connect({
                host: input.host.trim(), port: input.port, username: 'typealot-probe', readyTimeout: 20000,
                hostVerifier: key => {
                    resolve('SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, ''));
                    return false;
                }
            });
        });
    } finally {
        client.destroy();
    }
}

module.exports = {installServer, installationScript, validate, inspectServer, deploymentBundle};
