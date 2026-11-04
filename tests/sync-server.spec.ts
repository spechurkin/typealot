import {expect, test} from '@playwright/test';
import {type ChildProcess, spawn} from 'node:child_process';
import path from 'node:path';
import {mkdir, readdir, writeFile} from 'node:fs/promises';
import {initialWorkspace} from '../src/model';

test('pending desktop cache read cannot be overwritten by empty initial settings', async ({page}) => {
    await page.addInitScript(() => {
        let release: () => void;
        const gate = new Promise<void>(resolve => {
            release = resolve;
        });
        (window as any).releaseSyncCache = () => release();
        (window as any).cacheWrites = [];
        window.typealotDesktop = {
            loadSyncCache: async () => {
                await gate;
                return JSON.stringify({url: 'https://saved.example', automatic: false});
            },
            saveSyncCache: async text => {
                (window as any).cacheWrites.push(text);
            },
            onBeforeClose: () => () => {
            },
            updateState: async () => null,
            onUpdate: () => () => {
            },
            downloadUpdate: async () => false,
            installUpdate: async () => false,
            installServer: async () => ({ok: false, error: 'unavailable'})
        };
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.getByLabel('IP или домен сервера')).toBeDisabled();
    await expect(page.getByLabel('Синхронизировать автоматически')).toBeDisabled();
    expect(await page.evaluate(() => (window as any).cacheWrites)).toEqual([]);
    await page.evaluate(() => (window as any).releaseSyncCache());
    await expect(page.getByLabel('IP или домен сервера')).toHaveValue('https://saved.example');
    await expect(page.getByLabel('Синхронизировать автоматически')).not.toBeChecked();
    await expect(page.getByLabel('IP или домен сервера')).toBeEnabled();
    expect(await page.evaluate(() => (window as any).cacheWrites)).toEqual([]);
});

test('failed cache decryption and automatic-mode changes preserve the unreadable address', async ({page}) => {
    await page.addInitScript(() => {
        (window as any).cacheWrites = [];
        window.typealotDesktop = {
            loadSyncCache: async () => {
                throw new Error('Decryption failed');
            },
            saveSyncCache: async text => {
                (window as any).cacheWrites.push(text);
            },
            onBeforeClose: () => () => {
            }, updateState: async () => null,
            onUpdate: () => () => {
            }, downloadUpdate: async () => false, installUpdate: async () => false,
            installServer: async () => ({ok: false, error: 'unavailable'})
        };
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.locator('.sync-settings [role=alert]')).toContainText('Не удалось расшифровать');
    await page.getByLabel('Синхронизировать автоматически').uncheck();
    expect(await page.evaluate(() => (window as any).cacheWrites)).toEqual([]);
    await page.getByLabel('IP или домен сервера').fill('https://replacement.example');
    await expect.poll(() => page.evaluate(() => (window as any).cacheWrites.length)).toBe(1);
});

const serverPort = Number(process.env.TYPEALOT_TEST_PORT || '30000') + 1;

const origin = `http://127.0.0.1:${serverPort}`;
let server: ChildProcess;
const serverDirectory = path.join(process.cwd(), 'test-results', `sync-server-${Date.now()}`);
test.beforeAll(async () => {
    await mkdir(path.join(serverDirectory, 'backups'), {recursive: true});
    await writeFile(path.join(serverDirectory, 'backups', '1-expired.json'), 'expired');
    await writeFile(path.join(serverDirectory, 'server-config.json'), JSON.stringify({
        maxUploadMb: 150,
        backupCount: 12
    }));
    server = spawn(process.execPath, ['scripts/sync-server.mjs'], {
        cwd: process.cwd(),
        env: {...process.env, TYPEALOT_SYNC_PORT: String(serverPort), TYPEALOT_SYNC_DIRECTORY: serverDirectory},
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise<void>((resolve, reject) => {
        server.stdout!.once('data', () => resolve());
        server.once('error', reject);
        server.once('exit', code => reject(Error(`Server stopped: ${code}`)));
    });
});
test.afterAll(() => server?.kill());
test('server migrates retention, prunes at startup and on settings save, and does not back up each write', async ({request}) => {
    const dir = path.join(serverDirectory, 'backups');
    expect(await readdir(dir)).toEqual([]);
    expect(await (await request.get(`${origin}/admin/config`)).json()).toMatchObject({backupRetentionMonths: 3});
    const old = `${Date.now() - 70 * 24 * 60 * 60 * 1000}-old.json`, recent = `${Date.now()}-recent.json`;
    await writeFile(path.join(dir, old), 'old');
    await writeFile(path.join(dir, recent), 'recent');
    expect((await request.patch(`${origin}/admin/config`, {
        data: {
            maxUploadMb: 150,
            backupCount: 12,
            backupRetentionMonths: 1
        }
    })).status()).toBe(200);
    expect(await readdir(dir)).toEqual([recent]);
    let response = await request.put(`${origin}/workspace`, {
        headers: {'If-None-Match': '*'},
        data: initialWorkspace()
    });
    expect(response.status()).toBe(200);
    response = await request.put(`${origin}/workspace`, {
        headers: {'If-Match': response.headers().etag},
        data: initialWorkspace()
    });
    expect(response.status()).toBe(200);
    expect(await readdir(dir)).toEqual([recent]);
});
test('address-only admin, synchronization and conflict resolution', async ({page, browser, request}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.getByLabel('Логин администратора')).toHaveCount(0);
    await page.getByLabel('IP или домен сервера').fill(`127.0.0.1:${serverPort}`);
    await expect(page.getByLabel('Токен доступа', {exact: true})).toHaveCount(0);
    await page.getByLabel('Администрирование', {exact: true}).check();
    await page.getByLabel('IP сервера', {exact: true}).fill('127.0.0.1');
    await page.getByLabel('Порт сервера').fill(String(serverPort));
    await page.getByRole('button', {name: 'Открыть настройки сервера', exact: true}).click();
    await expect(page.getByText('Настройки сервера загружены', {exact: true})).toBeVisible();
    await page.getByLabel('Сколько серверных копий хранить').fill('5');
    await page.getByLabel('Срок хранения серверных копий (месяцев)').fill('6');
    await expect(page.getByText(/Внимание: копии старше выбранного срока безвозвратно удаляются с сервера/)).toBeVisible();
    await expect(page.getByText(/Сервер проверяет изменения каждые 30 минут/)).toBeVisible();
    await page.getByRole('button', {name: 'Сохранить настройки сервера', exact: true}).click();
    await expect(page.getByText('Настройки сервера сохранены', {exact: true})).toBeVisible();
    expect(await (await request.get(`${origin}/admin/config`)).json()).toMatchObject({
        backupCount: 5,
        backupRetentionMonths: 6
    });
    for (const backupRetentionMonths of [0, 1.5, 121]) expect((await request.patch(`${origin}/admin/config`, {
        data: {
            maxUploadMb: 150,
            backupCount: 5,
            backupRetentionMonths
        }
    })).status()).toBe(400);
    await page.getByLabel('Администрирование', {exact: true}).uncheck();
    await expect(page.getByLabel('Логин администратора')).toHaveCount(0);
    await page.getByRole('button', {name: 'Синхронизировать сейчас', exact: true}).click();
    await expect(page.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    const second = await browser.newContext({storageState: await page.context().storageState()});
    const other = await second.newPage();
    await other.goto('/');
    await expect(other.getByLabel('Заголовок заметки')).toBeVisible();
    await other.getByLabel('Заголовок заметки').fill('Локальная вторая версия');
    await other.getByRole('button', {name: 'Настройки', exact: true}).click();
    await other.getByLabel('IP или домен сервера').fill(`127.0.0.1:${serverPort}`);
    await other.getByRole('button', {name: 'Синхронизировать сейчас', exact: true}).click();
    await expect(other.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    await expect(other.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Изменение с первого устройства');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByRole('button', {name: 'Синхронизировать сейчас', exact: true}).click();
    await expect(page.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    await other.getByRole('button', {name: 'Синхронизировать сейчас', exact: true}).click();
    await expect(other.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    await other.getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(other.getByLabel('Заголовок заметки')).toHaveValue('Изменение с первого устройства');
    await page.getByRole('button', {name: 'Показать локальные копии', exact: true}).click();
    await expect(page.locator('.backup-list time').first()).toBeVisible();
    await second.close();
});
test('server discovers files without authentication and rejects stale concurrent writes', async ({request}) => {
    expect(await (await request.get(`${origin}/.well-known/typealot`)).json()).toMatchObject({workspace: '/workspace'});
    let read = await request.get(`${origin}/workspace`);
    if (!read.ok()) {
        await request.put(`${origin}/workspace`, {headers: {'If-None-Match': '*'}, data: initialWorkspace()});
        read = await request.get(`${origin}/workspace`);
    }
    const etag = read.headers().etag;
    expect(etag).toBeTruthy();
    const payload = initialWorkspace();
    const responses = await Promise.all([1, 2].map(async n => request.put(`${origin}/workspace`, {
        headers: {'If-Match': etag},
        data: {...payload, notes: payload.notes.map(note => ({...note, title: `Concurrent ${n}`}))}
    })));
    expect(responses.map(r => r.status()).sort()).toEqual([200, 412]);
});

test('sync address survives reload encrypted, while legacy credentials and admin sessions are discarded', async ({page}) => {
    await page.goto('/');
    await page.evaluate(async () => {
        const {set} = await import(/* @vite-ignore */ '/node_modules/.vite/deps/idb-keyval.js' as string);
        await set('typealot.sync', {
            url: 'http://old.example/workspace',
            token: 'legacy-secret',
            automatic: true,
            administration: true
        });
    });
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.getByLabel('IP или домен сервера')).toHaveValue('');
    await page.getByLabel('IP или домен сервера').fill(`127.0.0.1:${serverPort}`);
    await page.getByLabel('Синхронизировать автоматически').uncheck();
    await page.getByLabel('Администрирование', {exact: true}).check();
    await page.getByLabel('IP сервера', {exact: true}).fill('127.0.0.1');
    await page.getByLabel('Порт сервера').fill(String(serverPort));
    await page.getByRole('button', {name: 'Открыть настройки сервера', exact: true}).click();
    await expect(page.getByText('Настройки сервера загружены', {exact: true})).toBeVisible();
    await expect.poll(() => page.evaluate(async () => {
        const {loadSyncSettings} = await import(/* @vite-ignore */ '/src/sync-cache.ts' as string);
        return loadSyncSettings();
    })).toEqual({url: `127.0.0.1:${serverPort}`, automatic: false});
    const cached = await page.evaluate(async () => {
        const {get} = await import(/* @vite-ignore */ '/node_modules/.vite/deps/idb-keyval.js' as string);
        return get('typealot.sync.encrypted.v1');
    });
    expect(cached.ciphertext).toBeTruthy();
    expect(JSON.stringify(cached)).not.toContain('127.0.0.1');
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.getByLabel('IP или домен сервера')).toHaveValue(`127.0.0.1:${serverPort}`);
    await expect(page.getByLabel('Синхронизировать автоматически')).not.toBeChecked();
    await expect(page.getByLabel('Администрирование', {exact: true})).not.toBeChecked();
    expect(await page.evaluate(async () => {
        const {get} = await import(/* @vite-ignore */ '/node_modules/.vite/deps/idb-keyval.js' as string);
        return get('typealot.sync');
    })).toBeUndefined();
    await page.getByLabel('IP или домен сервера').fill('');
    await page.evaluate(async () => {
        const {flushSyncSettings} = await import(/* @vite-ignore */ '/src/sync-cache.ts' as string);
        await flushSyncSettings();
    });
    await page.reload();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.getByLabel('IP или домен сервера')).toHaveValue('');
});
