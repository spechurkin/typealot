import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {copyFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const {getMakeNsisPath, getNsisPluginsPath} = require('app-builder-lib/out/toolsets/windows.js');
const {path: compiler, env: compilerEnv} = await getMakeNsisPath();
const plugins = await getNsisPluginsPath();
const root = process.cwd();
await mkdir('test-results', {recursive: true});
const directory = await mkdtemp(path.resolve('test-results/installer-'));
const executable = `Typealot-check-${process.pid}.exe`;
const target = path.join(directory, executable);
const helper = path.join(directory, executable.replace('.exe', ' Helper.exe'));
await copyFile(process.execPath, target);
await copyFile(process.execPath, helper);
const nsisPath = value => value.replaceAll('"', '$\\"');
const source = path.join(directory, 'check.nsi');
await writeFile(source, `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "Typealot process check"
OutFile "${nsisPath(path.join(directory, 'check.exe'))}"
!addplugindir /x86-unicode "${nsisPath(path.join(plugins, 'x86-unicode'))}"
!addincludedir "${nsisPath(path.resolve('node_modules/app-builder-lib/templates/nsis/include'))}"
!include LogicLib.nsh
!include nsProcess.nsh
!define APP_EXECUTABLE_FILENAME "${executable}"
!define PRODUCT_NAME "Typealot"
!define isUpdated '1 == 1'
!include "${nsisPath(path.resolve('build/installer.nsh'))}"
LangString appRunning 1033 "App running"
LangString appCannotBeClosed 1033 "App cannot be closed"
Section
  StrCpy $INSTDIR "$EXEDIR"
  !insertmacro customCheckAppRunning
  FileOpen $0 "$EXEDIR\\passed.txt" w
  FileWrite $0 "passed"
  FileClose $0
  SetErrorLevel 0
SectionEnd
`);

function run(file, args = [], timeout = 35000) {
    return new Promise((resolve, reject) => {
        const child = spawn(file, args, {
            cwd: root,
            env: {...process.env, ...compilerEnv},
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

const compiled = await run(compiler, ['/V2', source]);
assert.equal(compiled.code, 0, compiled.output);
const check = () => run(path.join(directory, 'check.exe'), ['/S']);
assert.equal((await check()).code, 0, 'closed app must not block installation');
assert.equal(await readFile(path.join(directory, 'passed.txt'), 'utf8'), 'passed');

async function withProcess(file, code, verify) {
    const child = spawn(file, ['-e', code], {windowsHide: true, stdio: 'ignore'});
    const exited = new Promise(resolve => child.once('exit', resolve));
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    try {
        await verify(child);
    } finally {
        child.kill();
        await exited;
    }
}

await withProcess(helper, 'setInterval(() => {}, 1000)', async child => {
    assert.equal((await check()).code, 0, 'a similarly named process in the install folder must not block');
    assert.equal(child.exitCode, null, 'the helper must remain running');
});
await withProcess(target, 'setTimeout(() => {}, 2500)', async () => {
    assert.equal((await check()).code, 0, 'updating must wait for the app to exit');
});
await withProcess(target, 'setInterval(() => {}, 1000)', async child => {
    assert.equal((await check()).code, 2, 'a running app must prevent file replacement');
    assert.equal(child.exitCode, null, 'installation must not forcibly terminate the app');
});
console.log('NSIS: closed app, adjacent helper, delayed exit and blocked close passed. No installed application was modified.');
