import {_electron as electron, expect} from '@playwright/test';
import ssh2 from 'ssh2';
import {generateKeyPairSync} from 'node:crypto';
import path from 'node:path';

const key = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: {type: 'pkcs1', format: 'pem'},
    publicKeyEncoding: {type: 'spki', format: 'pem'}
}).privateKey;
const clients = [], commands = [];
const server = new ssh2.Server({hostKeys: [key]}, client => {
    clients.push(client);
    client.on('error', () => {
    });
    client.on('authentication', ctx => ctx.method === 'password' && ctx.username === 'operator' && ctx.password === 'one-use-secret' ? ctx.accept() : ctx.reject());
    client.on('ready', () => client.on('session', accept => {
        accept().on('exec', (accept, _reject, {command}) => {
            commands.push(command);
            const stream = accept();
            if (command.startsWith('mktemp')) {
                stream.write('/tmp/typealot-install.test\n');
                stream.exit(0);
                stream.end();
                return;
            }
            if (command === 'id -u') {
                stream.write('0\n');
                stream.exit(0);
                stream.end();
                return;
            }
            stream.on('data', () => {
            });
            stream.on('end', () => {
                stream.exit(0);
                stream.end();
            });
        });
    }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let app;
try {
    app = await electron.launch({
        args: ['.'],
        env: {
            ...process.env,
            TYPEALOT_TEST_PROFILE: path.join(process.cwd(), 'test-results', `ssh-electron-${Date.now()}`)
        }
    });
    await app.evaluate(({dialog}) => {
        dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false});
    });
    const page = await app.firstWindow();
    await expect(page.locator('.app')).toBeVisible({timeout: 30000});
    await page.evaluate(() => localStorage.setItem('typealot.language', 'ru'));
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Администрирование', {exact: true}).check();
    await page.getByLabel('IP или домен SSH-сервера').fill('127.0.0.1');
    await page.getByLabel('SSH-порт').fill(String(server.address().port));
    await page.getByLabel('Логин SSH').fill('operator');
    await page.getByLabel('Пароль SSH').fill('wrong');
    await page.getByRole('button', {name: 'Установить сервер', exact: true}).click();
    await expect(page.getByRole('alert')).toHaveText('SSH-сервер отклонил логин или пароль.');
    await expect(page.getByLabel('Пароль SSH')).toHaveValue('');
    expect(commands).toEqual([]);
    await page.getByLabel('Пароль SSH').fill('one-use-secret');
    await page.getByRole('button', {name: 'Установить сервер', exact: true}).click();
    await expect(page.locator('.ssh-installer [role=status]')).toContainText('Сервер установлен.');
    await expect(page.getByLabel('Логин SSH')).toHaveValue('');
    await expect(page.getByLabel('Пароль SSH')).toHaveValue('');
    expect(commands[3]).toContain('systemctl restart typealot-sync.service');
    expect(commands.join('')).not.toContain('one-use-secret');
    await page.setViewportSize({width: 360, height: 800});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.ssh-installer').screenshot({path: 'test-results/ssh-installer.png'});
    await page.setViewportSize({width: 1360, height: 900});
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Администрирование', {exact: true}).check();
    await expect(page.getByLabel('IP или домен SSH-сервера')).toHaveValue('');
    await expect(page.getByLabel('Логин SSH')).toHaveValue('');
    await expect(page.getByLabel('Пароль SSH')).toHaveValue('');
    console.log('Electron IPC and real local SSH: rejected bad password, sent install command after host confirmation, cleared credentials, reload and 360px layout passed. Remote Linux commands were captured, not executed.');
} finally {
    if (app) await app.close();
    clients.forEach(client => client.end());
    await new Promise(resolve => server.close(resolve));
}
