import {expect, test} from '@playwright/test';
import {readFile} from 'node:fs/promises';

test('library files survive document save and HTML export is readable', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    const upload = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Добавить файл', exact: true}).click();
    await (await upload).setFiles({
        name: 'Материал.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Содержимое файла')
    });
    await expect(page.locator('.attachment-list')).toContainText('Материал.txt');
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.getByRole('button', {name: 'Из библиотеки вложений', exact: true}).click();
    await page.getByRole('button', {name: 'Файл Материал.txt', exact: true}).click();
    await expect(page.locator('.document-attachment')).toContainText('Материал.txt');
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.reload();
    await expect(page.locator('.document-attachment')).toContainText('Материал.txt');
    const downloading = page.waitForEvent('download');
    await page.getByLabel('Действия', {exact: true}).click();
    await page.getByRole('button', {name: 'Экспорт заметки (HTML)', exact: true}).click();
    const downloaded = await downloading;
    const html = await readFile((await downloaded.path())!, 'utf8');
    expect(html).toContain('Материал.txt');
    expect(html).toContain('download=');
    expect(html).toContain('Tahoma');
    expect(html).not.toContain('<script');
});
test('canvas resizes figures and edits layer state and connections', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByRole('button', {name: 'Фигура', exact: true}).click();
    await page.getByLabel('Вид фигуры').selectOption('ellipse');
    await expect(page.locator('.board-object.shape')).toHaveCSS('border-radius', '50%');
    const shape = page.locator('.react-flow__node').filter({has: page.locator('.board-object.shape')});
    const before = (await shape.boundingBox())!.width;
    const handle = await shape.locator('.react-flow__resize-control.bottom.right.handle').boundingBox();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle!.x + 80, handle!.y + 60, {steps: 8});
    await page.mouse.up();
    expect((await shape.boundingBox())!.width).toBeGreaterThan(before + 30);
    await page.getByRole('button', {name: 'Выделение', exact: true}).click();
    await page.getByLabel('Слои', {exact: true}).click();
    const row = page.locator('.layer').filter({has: page.getByRole('button', {name: 'Фигура', exact: true})});
    await row.getByLabel('Заблокировать слой', {exact: true}).click();
    await expect(row.getByLabel('Разблокировать слой', {exact: true})).toBeVisible();
    await row.getByLabel('Скрыть слой', {exact: true}).click();
    await expect(page.locator('.board-object.shape')).toHaveCount(0);
    await row.getByLabel('Показать слой', {exact: true}).click();
    await row.getByLabel('Разблокировать слой', {exact: true}).click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', {name: 'Показать всё', exact: true}).click();
    const card = page.locator('.react-flow__node').filter({has: page.locator('.board-object.note')});
    const from = await card.locator('[data-handlepos=right]').boundingBox(),
        to = await shape.locator('[data-handlepos=left]').boundingBox();
    await page.mouse.move(from!.x + 6, from!.y + 6);
    await page.mouse.down();
    await page.mouse.move(to!.x + 6, to!.y + 6, {steps: 10});
    await page.mouse.up();
    await page.locator('.react-flow__edge-interaction').click();
    await page.getByLabel('Подпись связи').fill('Связаны');
    await page.getByLabel('Линия', {exact: true}).selectOption('straight');
    await page.getByLabel('Стрелки', {exact: true}).selectOption('both');
    await page.getByRole('button', {name: 'Пунктир', exact: true}).click();
    await expect(page.locator('.react-flow__edge-text')).toHaveText('Связаны');
    await expect(page.locator('.react-flow__edge-path')).toHaveAttribute('marker-start', /url/);
});


test('uploaded images become resized JPEGs and renamed files download with their extension', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 3200;
        canvas.height = 1800;
        const ctx = canvas.getContext('2d')!;
        for (let x = 0; x < 3200; x += 8) {
            ctx.fillStyle = `rgb(${x % 256},80,140)`;
            ctx.fillRect(x, 0, 8, 900);
        }
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Добавить файл', exact: true}).click();
    await (await chooser).setFiles({name: 'Исходник.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
    const row = page.locator('.attachment').filter({hasText: 'Исходник.jpg'});
    await expect(row).toBeVisible();
    const image = await row.locator('img').evaluate(async (img: HTMLImageElement) => {
        await img.decode();
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, img.naturalHeight - 1, 1, 1, 0, 0, 1, 1);
        return {
            src: img.src,
            width: img.naturalWidth,
            height: img.naturalHeight,
            pixel: Array.from(ctx.getImageData(0, 0, 1, 1).data)
        };
    });
    expect(image.src).toMatch(/^data:image\/jpeg;base64,/);
    expect(image.width).toBe(2560);
    expect(image.height).toBe(1440);
    expect(image.pixel).toEqual([255, 255, 255, 255]);
    expect(Buffer.from(image.src.split(',')[1], 'base64').length).toBeLessThan(Buffer.from(png, 'base64').length);
    await row.getByRole('button', {name: 'Переименовать Исходник.jpg', exact: true}).click();
    await page.locator('dialog input').fill('Обложка');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Скачать Обложка.jpg', exact: true}).click();
    const downloaded = await downloading;
    expect(downloaded.suggestedFilename()).toBe('Обложка.jpg');
    expect((await readFile((await downloaded.path())!)).subarray(0, 3)).toEqual(Buffer.from([255, 216, 255]));
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.reload();
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    await expect(page.locator('.attachment-list')).toContainText('Обложка.jpg');
});

test('renaming a library document updates downloads from an existing note', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', {name: 'Добавить файл', exact: true}).click();
    await (await chooser).setFiles({name: 'Old.txt', mimeType: 'text/plain', buffer: Buffer.from('Document content')});
    await expect(page.locator('.attachment-list')).toContainText('Old.txt');
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await page.getByLabel('Содержимое заметки').click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.getByRole('button', {name: 'Из библиотеки вложений', exact: true}).click();
    await page.getByRole('button', {name: 'Файл Old.txt', exact: true}).click();
    await expect(page.locator('.document-attachment')).toContainText('Old.txt');
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    await page.getByRole('button', {name: 'Переименовать Old.txt', exact: true}).click();
    await page.locator('dialog input').fill('New.txt');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await expect(page.locator('.attachment-list')).toContainText('New.txt');
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(page.locator('.document-attachment')).toContainText('New.txt');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Скачать файл', exact: true}).click();
    const downloaded = await downloading;
    expect(downloaded.suggestedFilename()).toBe('New.txt');
    expect(await readFile((await downloaded.path())!, 'utf8')).toBe('Document content');
    const exporting = page.waitForEvent('download');
    await page.getByLabel('Действия', {exact: true}).click();
    await page.getByRole('button', {name: 'Экспорт заметки (HTML)', exact: true}).click();
    expect(await readFile((await (await exporting).path())!, 'utf8')).toContain('download="New.txt"');
});
