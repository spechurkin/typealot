import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const {installationScript} = createRequire(import.meta.url)('../electron/ssh-install.cjs');
const linuxPath = value => value.replace(/^([a-z]):/i, (_, drive) => '/mnt/' + drive.toLowerCase()).replaceAll('\\', '/');
const repository = linuxPath(process.cwd());
const archive = linuxPath(path.resolve(process.argv[2] || 'test-results/node-v24.14.1-linux-x64.tar.xz'));
const unit = installationScript('/tmp/test-bundle.json.gz').match(/cat > \/etc\/systemd\/system\/typealot-sync.service <<EOF\n([\s\S]*?)\nEOF/)[1]
    .replaceAll('/opt/typealot', '$testRoot').replaceAll('/var/lib/typealot', '$testRoot/data')
    .replace('TYPEALOT_SYNC_PORT=80', 'TYPEALOT_SYNC_PORT=47867').replace('TYPEALOT_SYNC_HOST=0.0.0.0', 'TYPEALOT_SYNC_HOST=127.0.0.1')
    .replace('ExecStart=$NODE $testRoot/scripts/sync-server.mjs', 'ExecStart=$NODE "$repository/scripts/sync-server.mjs"')
    .replace('User=typealot', 'User=nobody').replace('Group=typealot', 'Group=nogroup').replace('Restart=on-failure', 'Restart=no');
const script = `set -eu
repository=$1
archive=$2
testRoot=$(mktemp -d /run/typealot-systemd-test.XXXXXX)
sourceRoot=$(mktemp -d /root/typealot-runtime-test.XXXXXX)
service=$(basename "$testRoot").service
cleanup(){
    systemctl stop "$service" >/dev/null 2>&1 || true
    rm -f "/run/systemd/system/$service"
    systemctl daemon-reload
    case "$testRoot" in /run/typealot-systemd-test.??????) rm -rf -- "$testRoot";; esac
    case "$sourceRoot" in /root/typealot-runtime-test.??????) rm -rf -- "$sourceRoot";; esac
}
trap cleanup EXIT
chmod 755 "$testRoot"
tar -xJf "$archive" -C "$sourceRoot" --strip-components=1
install -d -m 755 "$testRoot/runtime"
install -d -m 700 -o nobody -g nogroup "$testRoot/data"
write_unit(){
cat > "/run/systemd/system/$service" <<EOF
${unit}
EOF
systemctl daemon-reload
}
NODE=$sourceRoot/bin/node
write_unit
systemctl start "$service" || true
sleep 1
status=$(systemctl show --property=ExecMainStatus --value "$service")
test "$status" = 203 || { journalctl -u "$service" -n 20 --no-pager; echo "Expected 203/EXEC, got $status"; exit 1; }
echo 'Reproduced 203/EXEC with Node inside protected /root.'
install -m 755 "$NODE" "$testRoot/runtime/node"
NODE=$testRoot/runtime/node
write_unit
systemctl reset-failed "$service"
systemctl restart "$service"
if ! "$NODE" --input-type=module -e '
for(let n=0;n<20;n++){
    try{const r=await fetch("http://127.0.0.1:47867/.well-known/typealot");const page=await fetch("http://127.0.0.1:47867/");if((await r.json()).application&&page.ok){console.log("Copied runtime: real systemd service and Typealot HTTP app passed.");process.exit(0);}}catch{}
    await new Promise(resolve=>setTimeout(resolve,500));
}
process.exit(1);'; then journalctl -u "$service" -n 30 --no-pager; exit 1; fi
systemctl is-active --quiet "$service"
`;
const result = spawnSync('wsl.exe', ['-d', 'Ubuntu-24.04', '--', 'bash', '-s', '--', repository, archive], {
    input: script,
    encoding: 'utf8',
    timeout: 60000
});
process.stdout.write(result.stdout || '');
if (result.status !== 0) {
    process.stderr.write(result.stderr || '');
    if (result.error) console.error(result.error);
    process.exitCode = 1;
}
