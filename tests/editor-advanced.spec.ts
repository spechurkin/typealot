import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
});
test('image context, allowed formatting on paste and persisted image layout', async ({page}) => {
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await doc.evaluate(el => {
        const data = new DataTransfer();
        data.setData('text/html', '<p style="font-family:Comic Sans MS"><strong>Вставленный текст</strong></p>');
        data.setData('text/plain', 'Вставленный текст');
        el.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}));
    });
    await expect(doc.locator('strong')).toContainText('Вставленный текст');
    expect(await doc.innerHTML()).not.toContain('Comic Sans');
    await page.keyboard.press('Enter');
    const chooser = page.waitForEvent('filechooser');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.getByRole('button', {name: 'Изображение', exact: true}).click();
    await (await chooser).setFiles({
        name: 'pixel.png',
        mimeType: 'image/png',
        buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
    });
    const image = doc.locator('img');
    await image.click();
    await expect(page.getByLabel('Ширина изображения')).toBeVisible();
    await page.getByLabel('Ширина изображения').selectOption('50');
    await page.getByRole('button', {name: 'Справа', exact: true}).click();
    await page.getByRole('button', {name: 'Описание', exact: true}).click();
    await page.getByLabel('Описание', {exact: true}).fill('Проверочное изображение');
    await page.getByRole('button', {name: 'Применить', exact: true}).click();
    await expect(image).toHaveAttribute('alt', 'Проверочное изображение');
    await expect(image).toHaveAttribute('data-width', '50');
    await expect(image).toHaveAttribute('data-alignment', 'right');
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.reload();
    await expect(doc.locator('img')).toHaveAttribute('data-width', '50');
});
test('mobile full insertion menu and keyboard block menu', async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.locator('.line-insert-menu').getByRole('button', {name: 'Разделитель', exact: true}).click();
    await expect(doc.locator('hr').last()).toBeVisible();
    await page.setViewportSize({width: 1280, height: 850});
    await doc.click();
    await page.keyboard.press('Control+Home');
    const summary = page.getByRole('toolbar', {
        name: 'Форматирование',
        exact: true
    }).getByLabel('Тип блока', {exact: true});
    await summary.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(doc.locator('h2').first()).toContainText('Начните');
});
test('official YouTube API error produces a useful fallback and retains original', async ({page}) => {
    await page.route('https://www.youtube.com/iframe_api', route => route.fulfill({
        contentType: 'text/javascript',
        body: `window.YT={Player:class {constructor(frame,options){setTimeout(()=>options.events.onError({data:153}),25)}destroy(){}}};window.onYouTubeIframeAPIReady?.();`
    }));
    await page.route('https://www.youtube.com/embed/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<p>Isolated player</p>'
    }));
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.getByRole('button', {name: 'YouTube / Spotify', exact: true}).click();
    await page.getByLabel('URL', {exact: true}).fill('https://youtu.be/dQw4w9WgXcQ');
    await page.getByRole('button', {name: 'Вставить проигрыватель', exact: true}).click();
    await expect(page.getByText('YouTube не подтвердил приложение.', {exact: false})).toBeVisible();
    await expect(page.getByRole('link', {name: 'Открыть оригинал'})).toBeVisible();
});
test('restoring an automatic backup preserves a checkpoint of the current workspace', async ({page}) => {
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.getByLabel('Заголовок заметки').fill('Перед восстановлением');
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByRole('button', {name: 'Показать локальные копии', exact: true}).click();
    await page.locator('.backup-list').getByRole('button', {name: 'Восстановить', exact: true}).first().click();
    await page.getByRole('dialog').getByRole('button', {name: 'Восстановить', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.backup-list>div')).toHaveCount(2);
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Место для ваших мыслей');
});


test('line insert follows the caret and opens a usable menu on desktop and mobile', async ({page}) => {
    const doc = page.getByLabel('Содержимое заметки');
    const plus = page.getByLabel('Вставить блок', {exact: true});
    await expect(page.locator('.ribbon').getByLabel('Вставка', {exact: true})).toHaveCount(0);
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await expect(plus).toBeVisible();
    const lineOffset = async () => (await plus.boundingBox())!.y - (await doc.boundingBox())!.y;
    const first = await lineOffset();
    await page.keyboard.type('First line');
    await expect(plus).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(plus).toBeVisible();
    await expect.poll(lineOffset).toBeGreaterThan(first);
    await page.keyboard.press('ArrowUp');
    await expect(plus).toBeHidden();
    await page.keyboard.press('ArrowDown');
    await expect(plus).toBeVisible();
    await page.keyboard.type(' ');
    await expect(plus).toBeHidden();
    await page.keyboard.press('Backspace');
    await expect(plus).toBeVisible();
    await page.keyboard.press('Backspace');
    await expect(plus).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(plus).toBeVisible();
    for (const width of [1280, 390]) {
        await page.setViewportSize({width, height: 844});
        await plus.click();
        const menu = page.locator('.line-insert-menu');
        await expect(menu).toBeVisible();
        for (const name of ['Заголовок 2', 'Заголовок 3', 'Маркированный список', 'Нумерованный список', 'Чек-лист', 'Цитата', 'Блок кода']) {
            await expect(menu.getByRole('button', {name, exact: true})).toHaveCount(0);
        }
        const bounds = (await menu.boundingBox())!;
        expect(bounds.y).toBeGreaterThanOrEqual(0);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        await page.screenshot({path: `test-results/line-insert-${width}.png`});
        await menu.getByRole('button', {name: 'Разделитель', exact: true}).click();
        await expect(doc.locator('hr').last()).toBeVisible();
        await expect(menu).toBeHidden();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
    }
    await plus.focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.line-insert-menu button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(plus).toBeFocused();
});
