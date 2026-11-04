import {expect, test} from '@playwright/test';

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
});
test('document, title, literal Markdown, persistence and reading', async ({page}) => {
    await page.getByLabel('Заголовок заметки').fill('Проверка сохранения');
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('** __ # обычные символы');
    await expect(doc).toContainText('** __ # обычные символы');
    await expect(doc.locator('strong')).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Сохранено');
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Проверка сохранения');
    await expect(doc).toContainText('** __ # обычные символы');
    await page.getByRole('button', {name: 'Режим чтения', exact: true}).click();
    await expect(doc).toHaveAttribute('contenteditable', 'false');
    await expect(page.getByRole('toolbar', {name: 'Форматирование', exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Редактировать', exact: true}).click();
    await expect(doc).toHaveAttribute('contenteditable', 'true');
});
test('selection bubble survives formatting and Escape; keyboard slash deletes service text', async ({page}) => {
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const bubble = page.getByRole('toolbar', {name: 'Формат выделения', exact: true});
    await expect(bubble).toBeVisible();
    await bubble.getByRole('button', {name: 'Жирный · Ctrl+B', exact: true}).click();
    await expect(doc.locator('strong')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(bubble).not.toBeVisible();
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(page.getByLabel('Быстрая вставка')).toBeVisible();
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('Новый раздел');
    await expect(doc.locator('h2')).toContainText(['Заметки и связи', 'Новый раздел']);
    await expect(doc).not.toContainText('/Новый');
});
test('block menu alignment colors table and link', async ({page}) => {
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.insertText('Ссылка');
    await page.keyboard.press('Control+Shift+ArrowLeft');
    const ribbon = page.getByRole('toolbar', {name: 'Форматирование', exact: true});
    await expect(ribbon.locator('button[aria-label="Зачёркивание"] + button')).toHaveAttribute('aria-label', 'Маркированный список');
    await expect(ribbon.locator('button[aria-label="Маркированный список"] + button')).toHaveAttribute('aria-label', 'Нумерованный список');
    await ribbon.getByRole('button', {name: 'Маркированный список', exact: true}).click();
    await expect(doc.locator('ul li')).toContainText('Ссылка');
    await ribbon.getByRole('button', {name: 'Нумерованный список', exact: true}).click();
    await expect(doc.locator('ol li')).toContainText('Ссылка');
    await ribbon.getByRole('button', {name: 'Нумерованный список', exact: true}).click();
    await ribbon.getByLabel('Тип блока', {exact: true}).click();
    await ribbon.getByRole('button', {name: 'Заголовок 3', exact: true}).click();
    await expect(doc.locator('h3')).toContainText('Ссылка');
    await ribbon.getByLabel('Выравнивание', {exact: true}).click();
    await ribbon.getByRole('button', {name: 'По центру'}).click();
    await expect(doc.locator('h3')).toHaveAttribute('style', /text-align: center/);
    await ribbon.getByLabel('Цвет текста', {exact: true}).click();
    await ribbon.getByLabel('Цвет синий', {exact: true}).click();
    await page.keyboard.press('Escape');
    await ribbon.getByRole('button', {name: 'Ссылка', exact: true}).click();
    await page.getByLabel('URL', {exact: true}).fill('https://example.com');
    await page.getByRole('button', {name: 'Применить', exact: true}).click();
    await expect(doc.locator('a[href="https://example.com"]')).toContainText('Ссылка');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.locator('.line-insert-menu').getByRole('button', {name: 'Таблица', exact: true}).click();
    await expect(doc.locator('table')).toHaveCount(1);
});
test('both players load immediately, paste offers choice, canvas previews have no iframe', async ({page}) => {
    await page.route('https://www.youtube.com/embed/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<p>Isolated YouTube frame test</p>'
    }));
    await page.route('https://open.spotify.com/embed/**', route => route.fulfill({
        contentType: 'text/html',
        body: '<p>Isolated Spotify frame test</p>'
    }));
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await doc.evaluate(el => {
        el.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData: (() => {
                const d = new DataTransfer();
                d.setData('text/plain', 'https://youtu.be/dQw4w9WgXcQ?t=90');
                return d;
            })()
        }));
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', {name: 'Вставить проигрыватель', exact: true}).click();
    await expect(page.locator('iframe[title="YouTube"]')).toHaveAttribute('loading', 'eager');
    await expect(page.locator('iframe[title="YouTube"]')).toHaveAttribute('src', /autoplay=0/);
    await expect(page.locator('.media-placeholder')).toHaveCount(0);
    await expect(page.getByRole('link', {name: 'Открыть оригинал'})).toHaveAttribute('href', /t=90s/);
    const ribbon = page.getByRole('toolbar', {name: 'Форматирование', exact: true});
    await doc.locator('p').last().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.locator('.line-insert-menu').getByRole('button', {name: 'YouTube / Spotify', exact: true}).click();
    await page.getByLabel('URL', {exact: true}).fill('https://open.spotify.com/track/0123456789abcdefghijkl');
    await page.getByRole('button', {name: 'Вставить проигрыватель', exact: true}).click();
    await expect(page.locator('iframe[title="Spotify"]')).toHaveAttribute('loading', 'eager');
    await expect(page.locator('.media-caption a')).toHaveCount(2);
    await expect(page.locator('.media-block')).not.toContainText([/track|playlist|video/]);
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await expect(page.locator('.canvas-area')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(page.locator('.board-object')).toContainText('YouTube');
    await expect(page.locator('.board-object')).toContainText('Spotify');
});
test('tree, search, profile, theme, sidebar and backups', async ({page}) => {
    await expect(page.locator('.document .author')).toHaveCount(0);
    await page.getByRole('button', {name: 'Создать папку', exact: true}).click();
    await page.getByLabel('Название', {exact: true}).fill('Материалы');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await page.getByRole('button', {name: 'Создать заметку в Материалы', exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Новая мысль');
    await page.getByRole('button', {name: 'Поиск', exact: true}).click();
    await page.locator('.main-search input').fill('Новая мысль');
    await page.locator('.search-results button').click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Новая мысль');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.getByLabel('Имя', {exact: true}).fill('Автор');
    await expect(page.getByLabel('Показывать автора в заметках')).toHaveCount(0);
    await page.getByLabel('Тема', {exact: true}).selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const download = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Экспортировать всё', exact: true}).click();
    expect((await download).suggestedFilename()).toMatch(/^Typealot-/);
    await page.keyboard.press('Control+Backslash');
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect(page.getByRole('button', {name: 'Заметки', exact: true})).toBeVisible();
    await page.screenshot({path: 'test-results/light-desktop.png'});
});
test('canvas objects, drawing, selection, layers and zoom', async ({page}) => {
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByRole('button', {name: 'Текстовый блок', exact: true}).click();
    await page.getByLabel('Текст на холсте').fill('Свободный текст');
    await page.getByRole('button', {name: 'Выделение', exact: true}).click();
    await page.getByRole('button', {name: 'Фигура', exact: true}).click();
    await page.getByLabel('Текст фигуры').fill('Идея');
    await page.getByRole('button', {name: 'Выделение', exact: true}).click();
    await page.locator('.react-flow__pane').click({position: {x: 20, y: 20}});
    await page.getByRole('button', {name: 'Рисование', exact: true}).click();
    const area = await page.locator('.canvas-area').boundingBox();
    await page.mouse.move(area!.x + 50, area!.y + 300);
    await page.mouse.down();
    await page.mouse.move(area!.x + 200, area!.y + 380, {steps: 12});
    await page.mouse.up();
    await expect(page.locator('.board-object.drawing')).toHaveCount(1);
    await page.getByRole('button', {name: 'Увеличить масштаб', exact: true}).click();
    await page.getByRole('button', {name: 'Показать всё', exact: true}).click();
    await page.getByLabel('Слои', {exact: true}).click();
    await expect(page.locator('.layer')).toHaveCount(4);
});
test('responsive layouts across widths and both themes', async ({page}) => {
    for (const width of [1440, 1024, 820, 760, 390, 360]) {
        await page.setViewportSize({width, height: 850});
        await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
        if (width === 390) await page.screenshot({path: 'test-results/dark-mobile.png'});
    }
    await page.getByRole('button', {name: 'Открыть навигацию'}).click();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.locator('.sidebar')).toBeHidden();
    await page.getByLabel('Тема', {exact: true}).selectOption('light');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({path: 'test-results/light-mobile.png'});
});
