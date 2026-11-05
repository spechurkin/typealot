import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';

const root = process.cwd();
await mkdir(path.join(root, 'test-results'), {recursive: true});
const profile = await mkdtemp(path.join(root, 'test-results', 'packaged-update-profile-'));
const freePort = async () => {
    const listener = createServer();
    await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    return port;
};
const debugPort = await freePort(), appPort = await freePort();
let logs = '', launchError;
const output = process.env.TYPEALOT_DESKTOP_OUTPUT || path.join('release/desktop', `win32-${process.arch}`);
const unpacked = process.arch === 'ia32' ? 'win-ia32-unpacked' : 'win-unpacked';
const child = spawn(process.env.TYPEALOT_DESKTOP_EXECUTABLE || path.resolve(root, output, unpacked, 'Typealot.exe'), [`--remote-debugging-port=${debugPort}`], {
    env: {
        ...process.env,
        TYPEALOT_TEST_PROFILE: profile,
        TYPEALOT_TEST_DESKTOP_PORT: String(appPort)
    }, stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', chunk => {
    logs += chunk;
});
child.stderr.on('data', chunk => {
    logs += chunk;
});
child.on('error', error => {
    launchError = error;
});
let browser;
try {
    let ready = false;
    for (let n = 0; n < 30; n++) {
        if (launchError) throw launchError;
        try {
            const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
            if (r.ok) {
                ready = true;
                break;
            }
        } catch {
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!ready) throw Error('Packaged app debugger unavailable: ' + logs);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    const context = browser.contexts()[0];
    const page = context.pages()[0] || await context.waitForEvent('page', {timeout: 30000});
    await expect(page.locator('.document')).toBeVisible({timeout: 30000});
    await page.evaluate(() => localStorage.setItem('typealot.language', 'ru'));
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible({timeout: 30000});
    const state = await page.evaluate(() => window.typealotDesktop.updateState());
    expect(['idle', 'available', 'error']).toContain(state.status);
    await page.getByLabel('Заголовок заметки').fill('Packaged update verification');
    await expect(page.locator('.save-status')).toHaveText('Сохранено');
    console.log('Packaged desktop executable: startup, updater IPC and workspace saving passed. Remote installation was not performed.');
} catch (error) {
    console.error('Packaged app output:', logs);
    throw error;
} finally {
    await browser?.close();
    child.kill();
}
