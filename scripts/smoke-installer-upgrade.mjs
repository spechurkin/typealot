import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, writeFile, access, unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const {build} = require('electron-builder');
const {getMakeNsisPath} = require('app-builder-lib/out/toolsets/windows.js');
const {prepareUpgradeInclude} = require('./nsis-upgrade-script.cjs');
const compiler = await getMakeNsisPath();
const root = process.cwd();
await mkdir('test-results', {recursive: true});
const directory = await mkdtemp(path.resolve('test-results/upgrade-'));
const guid = randomUUID();
const productName = `TypealotUpgradeTest${process.pid}`;
const installed = path.join(directory, productName);
const shortcut = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs', productName + '.lnk');
const fixture = path.join(directory, 'fixture');
await mkdir(fixture);
await mkdir(path.join(fixture, 'resources'));
await writeFile(path.join(directory, 'legacy.nsh'), `; Reproduce the failing legacy uninstaller observed on the installed application.
!macro customUnInit
  SetErrorLevel 2
  Quit
!macroend
`);
const upgradeInclude = await prepareUpgradeInclude(path.join(directory, 'nsis'), path.resolve('build/installer.nsh'));
await writeFile(path.join(directory, 'app.nsi'), `Unicode true
Name "${productName}"
OutFile "${path.join(fixture, productName + '.exe')}"
RequestExecutionLevel user
SilentInstall silent
Section
SectionEnd
`);

function run(file, args, timeout = 60000, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, {
            cwd: root,
            env: {...process.env, ...env},
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        let output = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(Error(`Timed out: ${file}`));
        }, timeout);
        child.stdout.on('data', data => output += data);
        child.stderr.on('data', data => output += data);
        child.on('error', error => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('exit', code => {
            clearTimeout(timer);
            resolve({code, output});
        });
    });
}

const compiled = await run(compiler.path, ['/V2', path.join(directory, 'app.nsi')], 30000, compiler.env);
assert.equal(compiled.code, 0, compiled.output);

async function installer(version, include) {
    await writeFile(path.join(fixture, 'version.txt'), version);
    const output = path.join(directory, version);
    await build({
        prepackaged: fixture, config: {
            appId: `app.typealot.upgrade-test.${guid}`, productName,
            extraMetadata: {name: `typealot-upgrade-test-${guid}`, version},
            directories: {output},
            win: {target: 'nsis', signAndEditExecutable: false},
            nsis: {
                guid,
                include: version === '1.0.0' ? include : upgradeInclude,
                oneClick: false,
                allowToChangeInstallationDirectory: true,
                runAfterFinish: false,
                createDesktopShortcut: false,
                createStartMenuShortcut: true,
                uninstallDisplayName: productName,
                artifactName: 'TypealotUpgradeInstaller.exe'
            }
        }, publish: 'never'
    });
    return path.join(output, 'TypealotUpgradeInstaller.exe');
}

let wasInstalled = false;
try {
    const legacy = await installer('1.0.0', path.join(directory, 'legacy.nsh'));
    const fixed = await installer('1.0.1', path.resolve('build/installer.nsh'));
    const first = await run(legacy, ['/S', '/currentuser', `/D=${installed}`]);
    assert.equal(first.code, 0, first.output);
    wasInstalled = true;
    assert.equal(await readFile(path.join(installed, 'version.txt'), 'utf8'), '1.0.0');
    await access(shortcut);
    await unlink(shortcut);
    const deepDirectory = path.join(installed, 'resources', ...Array(6).fill('legacy-dependency-build-artifacts-0123456789'));
    await mkdir(deepDirectory, {recursive: true});
    const deepFile = path.join(deepDirectory, 'AndroidProtocolHandler.dex');
    assert.ok(deepFile.length > 260);
    await writeFile(deepFile, 'legacy build output');
    console.log('Legacy fixture installed:', installed);
    const upgrade = await run(fixed, ['/S', '/currentuser', '--updated', `/D=${installed}`]);
    assert.equal(upgrade.code, 0, `Legacy to fixed upgrade failed: ${upgrade.code}\n${upgrade.output}`);
    assert.equal(await readFile(path.join(installed, 'version.txt'), 'utf8'), '1.0.1');
    await access(shortcut);
    console.log('Missing Start menu shortcut restored during upgrade.');
    await assert.rejects(access(deepFile), {code: 'ENOENT'});
    console.log('Full NSIS upgrade: original installer/uninstaller -> fixed installer/uninstaller passed.');
    const repeat = await run(fixed, ['/S', '/currentuser', '--updated', `/D=${installed}`]);
    assert.equal(repeat.code, 0, 'Reinstallation with the fixed uninstaller failed');
    await access(shortcut);
    console.log('Repeated installation with the fixed uninstaller passed.');
} finally {
    if (wasInstalled) {
        const uninstaller = path.join(installed, `Uninstall ${productName}.exe`);
        await access(uninstaller);
        const cleanup = await run(uninstaller, ['/S', '/currentuser', `_?=${installed}`]);
        assert.equal(cleanup.code, 0, 'Could not uninstall the isolated test fixture');
        await assert.rejects(access(shortcut), {code: 'ENOENT'});
    }
}
