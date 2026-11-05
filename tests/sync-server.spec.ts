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
test('reopening a stale device must download deletions before sending any local changes', async ({page, request}) => {
    const old = initialWorkspace();
    old.notes[0].title = 'Surviving note';
    old.notes.push({...old.notes[0], id: 'removed-note', title: 'Deleted on website'});
    old.folders.push({id: 'removed-folder', name: 'Deleted folder', parentId: null});
    old.attachments.push({
        id: 'removed-file',
        name: 'old.txt',
        mime: 'text/plain',
        data: 'data:text/plain;base64,b2xk'
    });
    old.boards.push({...structuredClone(old.boards[0]), id: 'removed-board'});
    old.boards[0].nodes.push({...structuredClone(old.boards[0].nodes[0]), id: 'removed-object'});
    let read = await request.get(`${origin}/workspace`);
    expect((await request.put(`${origin}/workspace`, {
        headers: {'If-Match': read.headers().etag}, data: old
    })).ok()).toBe(true);
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('IP или домен сервера').fill(origin);
    await expect(page.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    const cached = () => page.evaluate(() => new Promise<any>((resolve, reject) => {
        const open = indexedDB.open('keyval-store');
        open.onsuccess = () => {
            const db = open.result, get = db.transaction('keyval').objectStore('keyval').get('typealot.workspace');
            get.onsuccess = () => {
                db.close();
                resolve(get.result);
            };
            get.onerror = () => {
                db.close();
                reject(get.error);
            };
        };
        open.onerror = () => reject(open.error);
    }));
    await expect.poll(async () => (await cached())?.notes.map((n: { id: string }) => n.id)).toContain('removed-note');
    const server = structuredClone(old);
    server.notes = server.notes.filter(n => n.id !== 'removed-note');
    server.folders = server.folders.filter(f => f.id !== 'removed-folder');
    server.attachments = [];
    server.boards = server.boards.filter(b => b.id !== 'removed-board');
    server.boards[0].nodes = server.boards[0].nodes.filter(n => n.id !== 'removed-object');
    server.boards[0].title = 'Website board edit';
    // Delay the first read after restart so edits to the stale cache happen during the download.
    let release!: () => void, reading!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const started = new Promise<void>(resolve => {
        reading = resolve;
    });
    await page.route(`${origin}/workspace`, async route => {
        if (route.request().method() === 'GET') {
            reading();
            await gate;
        }
        await route.continue();
    });
    await page.context().setOffline(true);
    read = await request.get(`${origin}/workspace`);
    expect((await request.put(`${origin}/workspace`, {
        headers: {'If-Match': read.headers().etag}, data: server
    })).ok()).toBe(true);
    await page.context().setOffline(false);
    const writes: string[] = [];
    page.on('request', req => {
        if (req.url() === `${origin}/workspace` && req.method() === 'PUT') writes.push(req.postData()!);
    });
    await page.reload();
    await started;
    await page.getByLabel('Заголовок заметки').fill('Stale edit while loading');
    expect(writes).toEqual([]);
    release();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Stale edit while loading');
    await expect.poll(async () => (await cached())?.attachments).toEqual([]);
    const loaded = await cached();
    expect(loaded.notes.map((n: { id: string }) => n.id)).toEqual(['welcome']);
    expect(loaded.folders.map((f: { id: string }) => f.id)).toEqual(['inbox']);
    expect(loaded.boards.map((b: { id: string }) => b.id)).toEqual(['board']);
    expect(loaded.boards[0].nodes.map((n: { id: string }) => n.id)).toEqual(['card']);
    expect(loaded.boards[0].title).toBe('Website board edit');
    await page.getByLabel('Заголовок заметки').fill('Fresh edit after download');
    await expect.poll(async () => (await (await request.get(`${origin}/workspace`)).json()).notes[0].title).toBe('Fresh edit after download');
    const saved = await (await request.get(`${origin}/workspace`)).json();
    expect(saved.notes).toHaveLength(1);
    expect(saved.attachments).toEqual([]);
    expect(saved.boards).toHaveLength(1);
    expect(saved.boards[0].title).toBe('Website board edit');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByRole('button', {name: 'Показать локальные копии', exact: true}).click();
    await expect(page.locator('.backup-list time').first()).toBeVisible();
});

test('a saved legacy connection without a baseline protects offline edits after reopening', async ({
                                                                                                       page,
                                                                                                       context,
                                                                                                       request
                                                                                                   }) => {
    const read = await request.get(`${origin}/workspace`);
    expect((await request.put(`${origin}/workspace`, {
        headers: read.ok() ? {'If-Match': read.headers().etag} : {'If-None-Match': '*'},
        data: initialWorkspace()
    })).ok()).toBe(true);
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Синхронизировать автоматически').uncheck();
    await page.getByLabel('IP или домен сервера').fill(origin);
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Legacy offline edits');
    await expect.poll(() => page.evaluate(async () => {
        const path = '/src/storage.ts';
        return (await (await import(path)).loadWorkspace()).notes[0].title;
    })).toBe('Legacy offline edits');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/');
    await reopened.getByRole('button', {name: 'Настройки', exact: true}).click();
    await reopened.getByRole('button', {name: 'Синхронизировать сейчас', exact: true}).click();
    await expect(reopened.getByRole('dialog')).toContainText('Legacy offline edits');
    await reopened.getByRole('dialog').getByRole('button', {
        name: 'Сохранить мои правки отдельной копией',
        exact: true
    }).click();
    await reopened.getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(reopened.locator('.sidebar')).toContainText('Legacy offline edits');
});

for (const [deleteEditedNote, keepCopy] of [[false, true], [true, true], [true, false]]) {
    test(`offline edits survive restart and reconnect (remote deletion: ${deleteEditedNote}, keep copy: ${keepCopy})`, async ({
                                                                                                                                  page,
                                                                                                                                  context,
                                                                                                                                  request
                                                                                                                              }) => {
        const seed = initialWorkspace();
        seed.notes.push({...structuredClone(seed.notes[0]), id: 'deleted-offline', title: 'Remove offline'});
        seed.attachments.push({
            id: 'file',
            name: 'remove.txt',
            mime: 'text/plain',
            data: 'data:text/plain;base64,eA=='
        });
        const read = await request.get(`${origin}/workspace`);
        expect((await request.put(`${origin}/workspace`, {
            headers: read.ok() ? {'If-Match': read.headers().etag} : {'If-None-Match': '*'},
            data: seed
        })).ok()).toBe(true);
        await page.goto('/');
        await page.getByRole('button', {name: 'Настройки', exact: true}).click();
        await page.getByLabel('IP или домен сервера').fill(origin);
        await expect(page.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
        await expect.poll(() => page.evaluate(async () => {
            const path = '/src/storage.ts';
            return (await (await import(path)).loadWorkspace()).syncState?.digest;
        })).toBeTruthy();
        await context.setOffline(true);
        await page.getByRole('button', {name: 'Заметки', exact: true}).click();
        await page.getByLabel('Заголовок заметки').fill('Offline work survives');
        await expect.poll(() => page.evaluate(async () => {
            const path = '/src/storage.ts';
            return (await (await import(path)).loadWorkspace()).notes.find((note: {
                id: string
            }) => note.id === 'welcome')?.title;
        })).toBe('Offline work survives');
        await page.getByLabel('Действия с заметкой: Remove offline', {exact: true}).click();
        await page.getByRole('button', {name: 'Удалить заметку', exact: true}).click();
        await page.getByRole('dialog').getByRole('button', {name: 'Удалить', exact: true}).click();
        await page.getByRole('button', {name: 'Вложения', exact: true}).click();
        await page.locator('.attachment').filter({hasText: 'remove.txt'}).getByRole('button', {
            name: 'Удалить',
            exact: true
        }).click();
        await page.getByRole('dialog').getByRole('button', {name: 'Удалить', exact: true}).click();
        await expect.poll(() => page.evaluate(async () => {
            const path = '/src/storage.ts';
            const saved = await (await import(path)).loadWorkspace();
            return {notes: saved.notes.map((note: { id: string }) => note.id), attachments: saved.attachments};
        })).toEqual({notes: ['welcome'], attachments: []});
        await page.close();
        const remote = await request.get(`${origin}/workspace`), server = await remote.json();
        server.boards[0].title = 'Independent server edit';
        if (deleteEditedNote) server.notes = server.notes.filter((note: { id: string }) => note.id !== 'welcome');
        expect((await request.put(`${origin}/workspace`, {
            headers: {'If-Match': remote.headers().etag},
            data: server
        })).ok()).toBe(true);
        await context.setOffline(false);
        const reopened = await context.newPage();
        await reopened.goto('/');
        if (deleteEditedNote) {
            const dialog = reopened.getByRole('dialog');
            await expect(dialog).toContainText('Offline work survives');
            await reopened.screenshot({path: test.info().outputPath('offline-conflict.png')});
            expect((await (await request.get(`${origin}/workspace`)).json()).notes.some((note: {
                title: string
            }) => note.title === 'Offline work survives')).toBe(false);
            await dialog.getByRole('button', {
                name: keepCopy ? 'Сохранить мои правки отдельной копией' : 'Загрузить версию файла с сервера',
                exact: true
            }).click();
        }
        await expect.poll(async () => {
            const server = await (await request.get(`${origin}/workspace`)).json();
            return {
                hasEdits: server.notes.some((note: {
                    title: string
                }) => note.title.includes('Offline work survives')),
                hasDeleted: server.notes.some((note: { id: string }) => note.id === 'deleted-offline')
            };
        }).toEqual({hasEdits: keepCopy, hasDeleted: false});
        const synced = await (await request.get(`${origin}/workspace`)).json();
        expect(synced.notes.some((note: { id: string }) => note.id === 'deleted-offline')).toBe(false);
        expect(synced.attachments).toEqual([]);
        expect(synced.boards[0].title).toBe('Independent server edit');
        expect(synced.syncState).toBeUndefined();
    });
}

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
