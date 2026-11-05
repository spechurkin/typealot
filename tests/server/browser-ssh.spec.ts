import {expect, test} from '@playwright/test';
import {createRequire} from 'node:module';
import {generateKeyPairSync} from 'node:crypto';
import {type ChildProcess, spawn} from 'node:child_process';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';

const serverPort = Number(process.env.TYPEALOT_TEST_PORT || '30000') + 2;

const {Server} = createRequire(import.meta.url)('ssh2');
const hostKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs1', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'}
}).privateKey;
let appServer: ChildProcess, ssh: any;
const clients: any[] = [], commands: string[] = [], uploads: Buffer[] = [];
test.beforeAll(async () => {
    ssh = new Server({hostKeys: [hostKey]}, (client: any) => {
        clients.push(client);
        client.on('error', () => {
        });
        client.on('authentication', (ctx: any) => ctx.method === 'password' && ctx.username === 'operator' && ctx.password === 'one-use-secret' ? ctx.accept() : ctx.reject());
        client.on('ready', () => client.on('session', (accept: any) => accept().on('exec', (accept: any, _reject: any, {command}: {
            command: string
        }) => {
            commands.push(command);
            const stream = accept();
            if (command === 'id -u') {
                stream.write('0\n');
                stream.exit(0);
                stream.end();
                return;
            }
            if (command.startsWith('mktemp')) {
                stream.write('/tmp/typealot-install.browser\n');
                stream.exit(0);
                stream.end();
                return;
            }
            const data: Buffer[] = [];
            stream.on('data', (chunk: Buffer) => data.push(chunk));
            stream.on('end', () => {
                if (command.startsWith('umask')) uploads.push(Buffer.concat(data));
                stream.exit(0);
                stream.end();
            });
        })));
    });
    await new Promise<void>(resolve => ssh.listen(0, '127.0.0.1', resolve));
    appServer = spawn(process.execPath, ['server/sync-server.mjs'], {
        env: {
            ...process.env,
            TYPEALOT_SYNC_PORT: String(serverPort),
            TYPEALOT_SYNC_DIRECTORY: path.join(process.cwd(), 'test-results', `web-server-${Date.now()}`)
        }, stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise<void>((resolve, reject) => {
        appServer.stdout!.once('data', () => resolve());
        appServer.once('error', reject);
        appServer.once('exit', code => reject(Error(`Server stopped: ${code}`)));
    });
});
test.afterAll(async () => {
    appServer?.kill();
    clients.forEach(client => client.end());
    await new Promise<void>(resolve => ssh.close(resolve));
});

for (const target of ['development', `http://127.0.0.1:${serverPort}`]) {
    test(`editable browser SSH form and installation via ${target}`, async ({page, baseURL}) => {
        const origin = target === 'development' ? baseURL! : target;
        await page.addInitScript(() => {
            localStorage.setItem('typealot.language', 'ru');
            Object.defineProperty(crypto, 'randomUUID', {value: undefined});
            Object.defineProperty(crypto, 'subtle', {value: undefined});
        });
        await page.goto(origin);
        await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
        await page.getByRole('button', {name: 'Настройки', exact: true}).click();
        if (target !== 'development') {
            await expect(page.getByLabel('IP или домен сервера')).toHaveValue(origin);
            await expect(page.getByLabel('Синхронизировать автоматически')).toBeChecked();
            await page.getByLabel('Синхронизировать автоматически').uncheck();
        }
        await page.getByLabel('Администрирование', {exact: true}).check();
        await page.getByLabel('IP или домен SSH-сервера').fill('127.0.0.1');
        await page.getByLabel('SSH-порт').fill(String(ssh.address().port));
        await page.getByLabel('Логин SSH').fill('operator');
        await page.getByLabel('Пароль SSH').fill('wrong');
        await expect(page.getByRole('button', {name: 'Установить сервер', exact: true})).toBeEnabled();
        const before = commands.length;
        await page.getByRole('button', {name: 'Установить сервер', exact: true}).click();
        await expect(page.getByRole('dialog')).toContainText('SHA256:');
        await page.getByRole('button', {name: 'Отмена', exact: true}).click();
        await expect(page.getByRole('alert')).toHaveText('Установка отменена.');
        expect(commands.length).toBe(before);
        await page.getByLabel('Пароль SSH').fill('wrong');
        await page.getByRole('button', {name: 'Установить сервер', exact: true}).click();
        await page.getByRole('button', {name: 'Подключиться и установить', exact: true}).click();
        await expect(page.getByRole('alert')).toHaveText('SSH-сервер отклонил логин или пароль.');
        await expect(page.getByLabel('Пароль SSH')).toHaveValue('');
        expect(commands.length).toBe(before);
        await page.getByLabel('Пароль SSH').fill('one-use-secret');
        await page.getByRole('button', {name: 'Установить сервер', exact: true}).click();
        await page.getByRole('button', {name: 'Подключиться и установить', exact: true}).click();
        await expect(page.locator('.ssh-installer [role=status]')).toContainText('Сервер установлен.');
        await expect(page.getByRole('link', {name: 'Открыть приложение на сервере'})).toHaveAttribute('href', 'http://127.0.0.1/');
        const files = JSON.parse(gunzipSync(uploads.at(-1)!).toString());
        expect(files['dist/index.html']).toBeTruthy();
        expect(files['scripts/dev/ssh-browser.cjs']).toBeTruthy();
        expect(files['electron/ssh-install.cjs']).toBeTruthy();
        expect(commands.slice(before).join('')).not.toContain('one-use-secret');
        await expect(page.getByLabel('Логин SSH')).toHaveValue('');
        await expect(page.getByLabel('Пароль SSH')).toHaveValue('');
        await page.setViewportSize({width: 360, height: 800});
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('.ssh-installer').screenshot({path: `test-results/ssh-browser-${new URL(origin).port}.png`});
    });
}

test('hosted app serves assets and rejects cross-site installer requests and source paths', async ({request}) => {
    const origin = `http://127.0.0.1:${serverPort}`;
    const response = await request.get(origin);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const script = html.match(/src="([^"]+\.js)"/);
    expect(script).toBeTruthy();
    expect((await request.get(origin + script![1])).status()).toBe(200);
    expect((await request.get(origin + '/electron/ssh-install.cjs')).status()).toBe(404);
    expect((await request.post(origin + '/__typealot/ssh/install', {
        headers: {Origin: 'https://another.example'},
        data: {}
    })).status()).toBe(403);
    const before = commands.length;
    const wrongKey = await request.post(origin + '/__typealot/ssh/install', {
        headers: {Origin: origin},
        data: {
            host: '127.0.0.1',
            port: ssh.address().port,
            username: 'operator',
            password: 'one-use-secret',
            fingerprint: 'SHA256:' + 'A'.repeat(43)
        }
    });
    expect((await wrongKey.json()).error).toBe('cancelled');
    expect(commands.length).toBe(before);
});

test('fields remain editable when the browser server has no SSH handler', async ({page}) => {
    await page.route('**/__typealot/ssh', route => route.fulfill({status: 404, body: ''}));
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Администрирование', {exact: true}).check();
    await page.getByLabel('IP или домен SSH-сервера').fill('192.0.2.10');
    await page.getByLabel('SSH-порт').fill('2222');
    await page.getByLabel('Логин SSH').fill('operator');
    await page.getByLabel('Пароль SSH').fill('one-use-secret');
    await expect(page.getByLabel('IP или домен SSH-сервера')).toHaveValue('192.0.2.10');
    await expect(page.getByRole('button', {name: 'Установить сервер', exact: true})).toBeDisabled();
    await expect(page.locator('.ssh-installer [role=status]')).toContainText('После обновления перезапустите');
});

test('installation recovers when an old preview starts serving the SSH handler', async ({page}) => {
    let available = false;
    await page.route('**/__typealot/ssh', route => available ? route.continue() : route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><title>Typealot</title>'
    }));
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Администрирование', {exact: true}).check();
    await page.getByLabel('IP или домен SSH-сервера').fill('192.0.2.10');
    await page.getByLabel('Логин SSH').fill('operator');
    await page.getByLabel('Пароль SSH').fill('one-use-secret');
    const install = page.getByRole('button', {name: 'Установить сервер', exact: true});
    await expect(install).toBeDisabled();
    available = true;
    await expect(install).toBeEnabled({timeout: 10000});
    await expect(page.getByLabel('Пароль SSH')).toHaveValue('one-use-secret');
});
