import {_electron as electron, expect} from '@playwright/test';
import path from 'node:path';

const root = process.cwd();
const launch = () => electron.launch({
    args: ['.'],
    env: {...process.env, TYPEALOT_TEST_PROFILE: path.join(root, 'test-results', 'electron-profile')}
});
let app = await launch();
try {
    const page = await app.firstWindow();
    await page.evaluate(() => localStorage.setItem('typealot.language', 'ru'));
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    const closeTitle = `Close persistence ${Date.now()}`;
    await page.getByLabel('Заголовок заметки').fill(closeTitle);
    const closed = app.waitForEvent('close');
    await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].close()).catch(() => {
    });
    await closed;
    app = await launch();
    const reopened = await app.firstWindow();
    await expect(reopened.getByLabel('Заголовок заметки')).toHaveValue(closeTitle);
    await reopened.getByRole('button', {name: 'Холсты', exact: true}).click();
    await expect(reopened.locator('.react-flow__handle')).toHaveCount(4);
    await reopened.screenshot({path: 'test-results/electron.png'});
    console.log('Electron: immediate close persisted the latest title; reopened document and four canvas connection handles passed.');
} finally {
    await app.close();
}
