import {expect, type Page, test} from '@playwright/test';
import {type ChildProcess, spawn} from 'node:child_process';
import path from 'node:path';
import {initialWorkspace} from '../../src/storage/model';

const serverPort = Number(process.env.TYPEALOT_TEST_PORT || '30000') + 3;

const origin = `http://127.0.0.1:${serverPort}`;
let server: ChildProcess;
test.beforeAll(async () => {
    server = spawn(process.execPath, ['server/sync-server.mjs'], {
        cwd: process.cwd(),
        env: {
            ...process.env,
            TYPEALOT_SYNC_PORT: String(serverPort),
            TYPEALOT_SYNC_DIRECTORY: path.join(process.cwd(), 'test-results', `live-${Date.now()}`)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise<void>((resolve, reject) => {
        server.stdout!.once('data', () => resolve());
        server.once('error', reject);
        server.once('exit', code => reject(Error(`Server exited: ${code}`)));
    });
});
test.afterAll(() => server?.kill());
test.beforeEach(async ({request}) => {
    const old = await request.get(`${origin}/workspace`);
    const workspace = initialWorkspace();
    workspace.notes[0].title = 'Shared note';
    workspace.notes[0].content = {
        type: 'doc',
        content: [{type: 'paragraph', content: [{type: 'text', text: 'Server content'}]}]
    };
    workspace.notes.push({...workspace.notes[0], id: 'another', title: 'Another note'});
    await request.put(`${origin}/workspace`, {
        headers: old.ok() ? {'If-Match': old.headers().etag} : {'If-None-Match': '*'},
        data: workspace
    });
});

async function connect(page: Page, name: string, handle: string) {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Имя', {exact: true}).fill(name);
    await page.getByLabel('Псевдоним', {exact: true}).fill(handle);
    await expect(page.getByLabel('Синхронизировать автоматически')).toBeChecked();
    await page.getByLabel('IP или домен сервера').fill(`127.0.0.1:${serverPort}`);
    await expect(page.locator('.sync-settings').getByRole('status')).toHaveText('Синхронизировано');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('navigation').getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Shared note');
    await expect(page.getByLabel('Участники совместного редактирования')).toContainText('Совместное редактирование');
}

async function append(page: Page, text: string) {
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText(text);
}

test('live CRDT typing, remote carets, local undo, offline rejoin and authoritative first load', async ({
                                                                                                            page,
                                                                                                            browser
                                                                                                        }) => {
    test.setTimeout(60000);
    const second = await browser.newContext({storageState: await page.context().storageState()});
    const other = await second.newPage();
    try {
        await connect(page, 'Alice', '@Alpha');
        await connect(other, 'Bob', '');
        await expect(page.locator('.author')).toHaveCount(0);
        await expect(other.locator('.author')).toHaveCount(0);
        await expect(page.locator('.collaboration-person')).toContainText('Bob');
        await expect(other.locator('.collaboration-person')).toContainText('Alpha');
        const firstColor = await page.locator('.collaboration-person i').first().evaluate(el => getComputedStyle(el).backgroundColor),
            secondColor = await other.locator('.collaboration-person i').first().evaluate(el => getComputedStyle(el).backgroundColor);
        expect(firstColor).not.toBe(secondColor);
        await Promise.all([
            (async () => {
                await page.getByLabel('Заголовок заметки').click();
                await page.keyboard.press('Control+Home');
                await page.keyboard.insertText('A ');
            })(),
            (async () => {
                await other.getByLabel('Заголовок заметки').click();
                await other.keyboard.press('Control+End');
                await other.keyboard.insertText(' B');
            })()
        ]);
        await expect(page.getByLabel('Заголовок заметки')).toHaveValue('A Shared note B');
        await expect(other.getByLabel('Заголовок заметки')).toHaveValue('A Shared note B');
        await Promise.all([append(page, ' Alice edit'), append(other, ' Bob edit')]);
        for (const target of [page, other]) {
            await expect(target.getByLabel('Содержимое заметки')).toContainText('Alice edit');
            await expect(target.getByLabel('Содержимое заметки')).toContainText('Bob edit');
            await expect(target.getByRole('dialog')).toHaveCount(0);
        }
        await expect(page.locator('.collaboration-carets__label')).toContainText('Bob');
        await other.getByLabel('Содержимое заметки').click();
        await other.keyboard.press('Control+End');
        await other.keyboard.press('Shift+ArrowLeft');
        await expect(page.locator('.ProseMirror-yjs-selection')).not.toHaveCount(0);
        await page.waitForTimeout(600);
        await append(page, ' OWN_UNDO');
        await append(other, ' PEER_KEEP');
        await expect(page.getByLabel('Содержимое заметки')).toContainText('PEER_KEEP');
        await page.getByLabel('Содержимое заметки').click();
        await page.keyboard.press('Control+z');
        await expect(page.getByLabel('Содержимое заметки')).not.toContainText('OWN_UNDO');
        await expect(page.getByLabel('Содержимое заметки')).toContainText('PEER_KEEP');
        await page.context().setOffline(true);
        await append(page, ' OFFLINE_A');
        await append(other, ' ONLINE_B');
        await page.context().setOffline(false);
        for (const target of [page, other]) {
            await expect(target.getByLabel('Содержимое заметки')).toContainText('OFFLINE_A', {timeout: 12000});
            await expect(target.getByLabel('Содержимое заметки')).toContainText('ONLINE_B');
        }
        await page.screenshot({path: 'test-results/collaboration-note.png'});
        const remote = await page.request.get(`${origin}/workspace`);
        const saved = await remote.json();
        expect(JSON.stringify(saved.notes[0].content)).toContain('OFFLINE_A');
        expect(saved.notes[0].collaboration.state).toBeTruthy();
    } finally {
        await page.context().setOffline(false);
        await second.close();
    }
});

test('different open files merge automatically without warning', async ({page, browser}) => {
    const second = await browser.newContext({storageState: await page.context().storageState()});
    const other = await second.newPage();
    try {
        await connect(page, 'Alice', 'Alpha');
        await connect(other, 'Bob', 'Beta');
        await other.locator('.tree-note').getByText('Another note', {exact: true}).click();
        await Promise.all([append(page, ' FIRST_FILE_EDIT'), append(other, ' SECOND_FILE_EDIT')]);
        for (const target of [page, other]) await expect(target.getByRole('dialog')).toHaveCount(0);
        await expect.poll(async () => JSON.stringify((await (await page.request.get(`${origin}/workspace`)).json()).notes)).toContain('SECOND_FILE_EDIT');
        await page.locator('.tree-note').getByText('Another note', {exact: true}).click();
        await expect(page.getByLabel('Содержимое заметки')).toContainText('SECOND_FILE_EDIT');
        await other.locator('.tree-note').getByText('Shared note', {exact: true}).click();
        await expect(other.getByLabel('Содержимое заметки')).toContainText('FIRST_FILE_EDIT');
    } finally {
        await second.close();
    }
});

test('only an incompatible edit of the same file asks to load the server version and preserves a local copy', async ({
                                                                                                                         page,
                                                                                                                         request
                                                                                                                     }) => {
    await connect(page, 'Alice', 'Alpha');
    await page.context().setOffline(true);
    try {
        await append(page, ' UNSENT_LOCAL_EDIT');
        const remote = await request.get(`${origin}/workspace`), data = await remote.json();
        data.notes[0].title = 'Changed by legacy client';
        data.notes[0].content = {
            type: 'doc',
            content: [{type: 'paragraph', content: [{type: 'text', text: 'Legacy server version'}]}]
        };
        delete data.notes[0].collaboration;
        expect((await request.put(`${origin}/workspace`, {
            headers: {'If-Match': remote.headers().etag},
            data
        })).ok()).toBe(true);
    } finally {
        await page.context().setOffline(false);
    }
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Конфликт изменений файлов', {timeout: 12000});
    await expect(dialog.locator('li')).toHaveCount(1);
    await dialog.getByRole('button', {name: 'Загрузить версию файла с сервера', exact: true}).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel('Содержимое заметки')).toContainText('Legacy server version');
    const backup = await page.evaluate(async () => {
        const {listBackups} = await import(/* @vite-ignore */ '/src/storage/storage.ts' as string);
        return JSON.stringify(await listBackups());
    });
    expect(backup).toContain('UNSENT_LOCAL_EDIT');
});

test('canvas pointers, exclusive object editing, server lock enforcement and note-card exemption', async ({
                                                                                                              page,
                                                                                                              browser,
                                                                                                              request
                                                                                                          }) => {
    test.setTimeout(60000);
    const second = await browser.newContext({storageState: await page.context().storageState()});
    const other = await second.newPage();
    try {
        await connect(page, 'Alice', '@Alpha');
        await connect(other, 'Bob', '');
        for (const target of [page, other]) await target.getByRole('navigation').getByRole('button', {
            name: 'Холсты',
            exact: true
        }).click();
        await page.getByRole('button', {name: 'Фигура', exact: true}).click();
        const first = page.getByLabel('Текст фигуры'), peer = other.getByLabel('Текст фигуры');
        await expect(peer).toHaveCount(1);
        await first.click();
        await expect(first).not.toHaveAttribute('readonly');
        await first.fill('Alice owns this object');
        await expect(peer).toHaveValue('Alice owns this object');
        await expect(peer).toBeVisible();
        await expect(peer).toHaveAttribute('readonly');
        await expect(other.locator('.block-edit-owner')).toContainText('Alpha');
        await peer.click();
        await other.keyboard.insertText('BLOCKED');
        await expect(peer).toHaveValue('Alice owns this object');
        const remote = await request.get(`${origin}/workspace`), body = await remote.json();
        body.boards[0].nodes.find((node: any) => node.data.kind === 'shape').data.text = 'bypass';
        expect((await request.put(`${origin}/workspace`, {
            headers: {'If-Match': remote.headers().etag},
            data: body
        })).status()).toBe(423);
        const bounds = await page.locator('.canvas-area').boundingBox();
        await page.mouse.move(bounds!.x + 100, bounds!.y + 120);
        const pointer = other.locator('.remote-pointer[data-user="Alpha"]');
        await expect(pointer).toBeVisible();
        await expect.poll(() => pointer.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m41)).toBeCloseTo(100, 0);
        await expect.poll(() => pointer.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m42)).toBeCloseTo(120, 0);
        await other.getByLabel('Увеличить масштаб', {exact: true}).click();
        await expect(other.locator('.zoom-value')).not.toHaveText('100%');
        await expect.poll(() => other.evaluate(() => {
            const viewport = new DOMMatrix(getComputedStyle(document.querySelector('.react-flow__viewport')!).transform),
                cursor = new DOMMatrix(getComputedStyle(document.querySelector('.remote-pointer[data-user="Alpha"]')!).transform);
            return Math.abs(cursor.m41 - (100 * viewport.a + viewport.m41)) + Math.abs(cursor.m42 - (120 * viewport.d + viewport.m42));
        })).toBeLessThan(1);
        await other.screenshot({path: 'test-results/collaboration-canvas.png'});
        await other.locator('.board-object.note .card-title').click();
        await append(other, ' Note cards stay collaborative');
        await expect(other.getByLabel('Содержимое заметки')).toContainText('Note cards stay collaborative');
        await expect(other.getByRole('dialog')).toHaveCount(0);
        await other.getByRole('navigation').getByRole('button', {name: 'Холсты', exact: true}).click();
        await page.close();
        await expect(other.locator('.block-edit-owner')).toHaveCount(0);
        await peer.click();
        await expect(peer).not.toHaveAttribute('readonly');
        await peer.fill('Bob edits after disconnect');
        await expect.poll(async () => JSON.stringify((await (await request.get(`${origin}/workspace`)).json()).boards)).toContain('Bob edits after disconnect');
    } finally {
        await second.close();
    }
});

test('malformed messages and room joins without a session do not crash or mutate the server', async ({
                                                                                                         page,
                                                                                                         request
                                                                                                     }) => {
    await page.goto('/');
    const codes = await page.evaluate(async ({
                                                 url,
                                                 payloads
                                             }) => Promise.all(payloads.map(payload => new Promise<number>((resolve, reject) => {
        const socket = new WebSocket(url);
        socket.onopen = () => socket.send(payload);
        socket.onclose = event => resolve(event.code);
        socket.onerror = () => reject(Error('WebSocket failed'));
    }))), {
        url: origin.replace('http:', 'ws:') + '/realtime',
        payloads: ['null', JSON.stringify({type: 'join', room: 'board:board', clientID: 123})]
    });
    expect(codes).toEqual([1003, 1008]);
    const result = await request.get(`${origin}/workspace`);
    expect(result.ok()).toBe(true);
    expect((await result.json()).notes[0].title).toBe('Shared note');
});
