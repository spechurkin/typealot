import {_electron as electron, expect} from '@playwright/test';
import {mkdir, readFile, readdir, unlink} from 'node:fs/promises';
import path from 'node:path';

const profile = path.join(process.cwd(), 'test-results', `sync-cache-electron-${Date.now()}`);
await mkdir(profile, {recursive: true});
const launch = () => electron.launch({
    executablePath: process.env.TYPEALOT_TEST_EXECUTABLE || undefined,
    args: process.env.TYPEALOT_TEST_EXECUTABLE ? [] : ['.'],
    env: {...process.env, TYPEALOT_TEST_PROFILE: profile, TYPEALOT_TEST_DESKTOP_PORT: '47839'}
});
let app = await launch();
try {
    const page = await app.firstWindow();
    await expect(page.locator('body')).toBeVisible();
    await page.evaluate(() => localStorage.setItem('typealot.language', 'ru'));
    await page.reload();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Синхронизировать автоматически').uncheck();
    await page.getByLabel('IP или домен сервера').fill('https://private-sync.example:8443');
    await app.evaluate(({safeStorage}) => {
        safeStorage.encryptString('Chromium key reset regression probe');
    });
    const closed = app.waitForEvent('close');
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()).catch(() => {
    });
    await closed;
    const ciphertext = await readFile(path.join(profile, 'sync-cache.v2.enc'));
    expect(ciphertext.includes(Buffer.from('private-sync.example'))).toBe(false);
    expect(ciphertext.includes(Buffer.from('private-sync.example', 'utf16le'))).toBe(false);
    expect((await readdir(profile)).includes('sync-cache.v2.enc.tmp')).toBe(false);
    // Reproduce replacement of Chromium's encryption key during profile maintenance.
    await unlink(path.join(profile, 'Local State'));
    app = await launch();
    const reopened = await app.firstWindow();
    await reopened.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(reopened.getByLabel('IP или домен сервера')).toHaveValue('https://private-sync.example:8443');
    await expect(reopened.getByLabel('Синхронизировать автоматически')).not.toBeChecked();
    await expect(reopened.locator('.sync-settings [role=alert]')).toHaveCount(0);
    console.log('Electron: encrypted Windows cache restored address and automatic preference after immediate close, Chromium key reset and relaunch.');
} finally {
    await app.close();
}
