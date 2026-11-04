import {expect, test} from '@playwright/test';
import {type ChildProcess, spawn} from 'node:child_process';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

const origin = 'http://127.0.0.1:47849';
let server: ChildProcess, directory: string, offsetFile: string;
const start = async () => {
    const preload = `import {readFileSync} from 'node:fs';const original=Date.now;Date.now=()=>original()+Number(readFileSync(${JSON.stringify(offsetFile)},'utf8'));`;
    server = spawn(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload), 'scripts/sync-server.mjs'], {
        cwd: process.cwd(),
        env: {...process.env, TYPEALOT_SYNC_PORT: '47849', TYPEALOT_SYNC_DIRECTORY: directory},
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise<void>((resolve, reject) => {
        server.stdout!.once('data', () => resolve());
        server.once('error', reject);
        server.once('exit', code => reject(Error(`Server stopped: ${code}`)));
    });
};
const stop = async () => {
    if (server?.exitCode === null) await new Promise<void>(resolve => {
        server.once('exit', () => resolve());
        server.kill();
    });
};
test.beforeAll(async () => {
    directory = path.resolve('test-results', `update-server-${Date.now()}`);
    await mkdir(directory, {recursive: true});
    offsetFile = path.join(directory, 'clock');
    await writeFile(offsetFile, '0');
    await start();
});
test.afterAll(stop);

test('idle gate, updating window, disconnection and restart preserve maintenance until completion', async ({
                                                                                                               page,
                                                                                                               request
                                                                                                           }) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('IP или домен сервера').fill('127.0.0.1:47849');
    await expect.poll(async () => (await request.get(origin + '/__typealot/update')).ok()).toBe(true);
    const control = async (action: string, id = 'test-update') => {
        const {token} = JSON.parse(await readFile(path.join(directory, 'update-control.json'), 'utf8'));
        return request.post(`${origin}/__typealot/update/${action}`, {
            headers: {Authorization: `Bearer ${token}`},
            data: {id}
        });
    };
    expect((await control('prepare')).status()).toBe(409);
    expect((await request.post(origin + '/__typealot/update/prepare', {data: {id: 'untrusted'}})).status()).toBe(403);
    await writeFile(offsetFile, String(6 * 60 * 1000));
    await request.post(origin + '/__typealot/activity');
    expect((await control('prepare')).status()).toBe(409);
    await writeFile(offsetFile, String(12 * 60 * 1000));
    expect((await control('prepare')).status()).toBe(200);
    const dialog = page.getByRole('dialog', {name: 'Сервер обновляется'});
    await expect(dialog).toBeVisible();
    expect((await request.put(origin + '/workspace', {data: {}})).status()).toBe(503);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(page.locator('.server-update-spinner')).toHaveCSS('animation-name', 'server-update-spin');
    await page.screenshot({path: 'test-results/server-updating-dark.png'});
    await page.setViewportSize({width: 375, height: 667});
    await page.evaluate(() => document.documentElement.dataset.theme = 'light');
    await page.emulateMedia({reducedMotion: 'reduce'});
    await expect(page.locator('.server-update-spinner')).toHaveCSS('animation-name', 'none');
    expect(await dialog.evaluate(el => el.getBoundingClientRect().right <= innerWidth)).toBe(true);
    await page.screenshot({path: 'test-results/server-updating-mobile.png'});
    await stop();
    await expect(dialog).toBeVisible();
    await start();
    expect((await (await request.get(origin + '/__typealot/update')).json()).updating).toBe(true);
    await expect(dialog).toBeVisible();
    expect((await control('cancel')).status()).toBe(200);
    await expect(dialog).toHaveCount(0);
    expect((await (await request.get(origin + '/__typealot/update')).json()).updating).toBe(false);
});
