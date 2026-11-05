import {_android as android, expect} from '@playwright/test';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';

const exec = promisify(execFile), root = process.cwd();
const properties = await fs.readFile(path.join(root, 'android', 'local.properties'), 'utf8').catch(() => '');
const sdk = process.env.ANDROID_HOME || properties.match(/^sdk\.dir=(.*)$/m)?.[1].replace(/\\(.)/g, '$1').trim();
if (!sdk) throw Error('Set ANDROID_HOME or android/local.properties');
const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
const serial = process.env.TYPEALOT_ANDROID_SERIAL || 'emulator-5554';
const run = async (...args) => (await exec(adb, ['-s', serial, ...args], {maxBuffer: 12 * 1024 * 1024})).stdout;
const api = Number((await run('shell', 'getprop', 'ro.build.version.sdk')).trim());
if (!Number.isInteger(api) || api < 29) throw Error(`Typealot requires Android 10+ (API 29+); device reports API ${api}`);
if (process.env.TYPEALOT_ANDROID_API && api !== Number(process.env.TYPEALOT_ANDROID_API)) throw Error(`Expected API ${process.env.TYPEALOT_ANDROID_API}, connected device is API ${api}`);
console.log(`Testing Android API ${api} on ${serial}`);
const webViewState = await run('shell', 'dumpsys', 'webviewupdate');
const webViewVersion = Number(webViewState.match(/Current WebView package \(name, version\): \([^,]+, (\d+)\./)?.[1]);
const config = JSON.parse(await fs.readFile(path.join(root, 'android', 'app', 'src', 'main', 'assets', 'capacitor.config.json'), 'utf8'));
const requiredWebView = config.android?.minWebViewVersion;
if (!Number.isInteger(requiredWebView)) throw Error('Run npm run android:assets to prepare the Android WebView configuration');
if (!Number.isInteger(webViewVersion) || webViewVersion < requiredWebView) throw Error(`Full editor test requires WebView ${requiredWebView}+; device reports ${webViewVersion}. Update the device WebView first.`);
await run('install', '-r', path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
await run('shell', 'am', 'start', '-n', 'app.typealot.editor/.MainActivity');
let pid = '';
for (let i = 0; i < 30 && !pid; i++) {
    pid = await run('shell', 'pidof', '-s', 'app.typealot.editor').then(value => value.trim()).catch(() => '');
    if (!pid) await new Promise(r => setTimeout(r, 500));
}
const device = (await android.devices({omitDriverInstall: true})).find(d => d.serial() === serial);
if (!device) throw Error('Android test device unavailable');
try {
    let page = await (await device.webView({pkg: 'app.typealot.editor'}, {timeout: 20000})).page();
    if (await page.locator('dialog[open]').count()) await page.getByRole('button', {
        name: 'Закрыть',
        exact: true
    }).click();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    if (!page.url().startsWith('https://app.typealot.editor')) throw Error('Unexpected Android application origin');
    await page.getByLabel('Заголовок заметки').click();
    let keyboardVisible = false;
    for (let i = 0; i < 20; i++) {
        const ime = await run('shell', 'dumpsys', 'input_method');
        if (/mInputShown=true|isInputViewShown=true/.test(ime)) {
            keyboardVisible = true;
            break;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    if (!keyboardVisible) throw Error('Android software keyboard did not open');
    console.log('Android application loaded; software keyboard opened');
    await page.getByLabel('Заголовок заметки').fill('Android persistence check');
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await run('shell', 'input', 'keyevent', '4');
    await page.getByRole('button', {name: 'Открыть навигацию', exact: true}).click();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByRole('button', {
        name: 'Закрыть навигацию',
        exact: true
    }).click({position: {x: (await page.evaluate(() => innerWidth)) - 5, y: 350}});
    await page.getByRole('button', {name: 'Экспортировать всё', exact: true}).click();
    let shared = false;
    for (let i = 0; i < 40; i++) {
        const activity = await run('shell', 'dumpsys', 'activity', 'activities');
        const resumed = activity.split('\n').filter(line => /topResumedActivity|mResumedActivity/.test(line)).join('\n');
        if (/ChooserActivity|ResolverActivity/.test(resumed)) {
            shared = true;
            break;
        }
        await new Promise(r => setTimeout(r, 250));
    }
    if (!shared) throw Error('Native Android export did not open the system share sheet');
    await run('shell', 'input', 'keyevent', '4');
    await run('shell', 'am', 'start', '-n', 'app.typealot.editor/.MainActivity');
    page = await (await device.webView({pkg: 'app.typealot.editor'}, {timeout: 20000})).page();
    await page.reload();
    await page.getByRole('button', {name: 'Открыть навигацию', exact: true}).click();
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await page.getByRole('button', {name: 'Android persistence check', exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Место для ваших мыслей');
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await fs.mkdir(path.join(root, 'test-results'), {recursive: true});
    const shot = await exec(adb, ['-s', serial, 'exec-out', 'screencap', '-p'], {
        encoding: 'buffer',
        maxBuffer: 12 * 1024 * 1024
    });
    await fs.writeFile(path.join(root, 'test-results', `android-api-${api}.png`), shot.stdout);
    console.log('Android: real WebView, local saving, navigation and native file export passed.');
} finally {
    await device.close();
}
