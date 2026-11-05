import {_electron as electron, expect} from '@playwright/test';
import path from 'node:path';
import {mkdir, mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:net';

const root = process.cwd();
await mkdir(path.join(root, 'test-results'), {recursive: true});
const profile = await mkdtemp(path.join(root, 'test-results', 'electron-profile-'));
const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
const launch = () => electron.launch({
    args: ['.'],
    env: {...process.env, TYPEALOT_TEST_PROFILE: profile, TYPEALOT_TEST_DESKTOP_PORT: String(port)}
});
let app = await launch();
try {
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await expect(page.locator('.document')).toBeVisible({timeout: 30000});
    await page.evaluate(() => localStorage.setItem('typealot.language', 'ru'));
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible({timeout: 30000});
    expect(errors).toEqual([]);
    const closeTitle = `Close persistence ${Date.now()}`;
    await page.getByLabel('Заголовок заметки').fill(closeTitle);
    const closed = app.waitForEvent('close', {timeout: 30000});
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()).catch(() => {
    });
    await closed;
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByLabel('Заголовок заметки')).toHaveValue(closeTitle, {timeout: 30000});
    await reopened.getByRole('button', {name: 'Холсты', exact: true}).click();
    await expect(reopened.locator('.react-flow__handle')).toHaveCount(4);
    await reopened.screenshot({path: 'test-results/electron.png'});
    console.log('Electron: immediate close persisted the latest title; reopened document and four canvas connection handles passed.');
} finally {
    await app.evaluate(({app}) => app.exit(0)).catch(() => app.process().kill());
}
