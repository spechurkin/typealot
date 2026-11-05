import {expect, test} from '@playwright/test';

test('canvas text size supports typing, repeated steps and persists after reload', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByRole('button', {name: 'Текстовый блок', exact: true}).click();
    const text = page.getByLabel('Текст на холсте', {exact: true});
    await text.fill('Музыка');
    const size = page.getByLabel('Размер текста на холсте', {exact: true});
    await size.fill('');
    await expect(size).toHaveValue('');
    await size.pressSequentially('40');
    await expect(size).toHaveValue('40');
    await expect(text).toHaveCSS('font-size', '40px');
    for (let step = 0; step < 15; step++) await size.press('ArrowUp');
    await expect(size).toHaveValue('55');
    await expect(text).toHaveCSS('font-size', '55px');
    for (let step = 0; step < 5; step++) await size.press('ArrowDown');
    await expect(text).toHaveCSS('font-size', '50px');
    const bounds = (await size.boundingBox())!;
    const padding = await size.evaluate(input => parseFloat(getComputedStyle(input).paddingRight));
    for (let step = 0; step < 5; step++) {
        await page.mouse.click(bounds.x + bounds.width - padding - 7, bounds.y + bounds.height / 2 - 4);
    }
    await expect(size).toHaveValue('55');
    await expect(text).toHaveCSS('font-size', '55px');
    await size.press('Tab');
    await expect(page.getByRole('status', {name: 'Сохранение на этом устройстве'})).toHaveText('Сохранено');
    await page.reload();
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await expect(text).toHaveCSS('font-size', '55px');
});

test('canvas text size validates bounds after editing and resets an empty field', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByRole('button', {name: 'Текстовый блок', exact: true}).click();
    const size = page.getByLabel('Размер текста на холсте', {exact: true});
    const text = page.getByLabel('Текст на холсте', {exact: true});
    await size.fill('');
    await size.pressSequentially('9');
    await expect(size).toHaveValue('9');
    await size.press('Enter');
    await expect(size).toHaveValue('12');
    await expect(text).toHaveCSS('font-size', '12px');
    await size.fill('120');
    await size.press('Tab');
    await expect(size).toHaveValue('96');
    await expect(text).toHaveCSS('font-size', '96px');
    await size.fill('');
    await size.press('Tab');
    await expect(size).toHaveValue('96');
    await expect(text).toHaveCSS('font-size', '96px');
});

test('four connection directions and middle-button panning', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    const card = page.locator('.react-flow__node').first();
    await expect(card.locator('.react-flow__handle')).toHaveCount(4);
    for (const side of ['top', 'right', 'bottom', 'left']) await expect(card.locator(`[data-handlepos="${side}"]`)).toBeVisible();
    const viewport = page.locator('.react-flow__viewport');
    const before = await viewport.getAttribute('style');
    const bounds = await page.locator('.canvas-area').boundingBox();
    await page.mouse.move(bounds!.x + bounds!.width - 150, bounds!.y + bounds!.height - 150);
    await page.mouse.down({button: 'middle'});
    await page.mouse.move(bounds!.x + bounds!.width - 250, bounds!.y + bounds!.height - 220, {steps: 8});
    await page.mouse.up({button: 'middle'});
    await expect(viewport).not.toHaveAttribute('style', before!);
    await page.getByRole('button', {name: 'Текстовый блок', exact: true}).click();
    await page.getByRole('button', {name: 'Показать всё', exact: true}).click();
    const textNode = page.locator('.react-flow__node').filter({has: page.getByLabel('Текст на холсте')});
    for (const side of ['top', 'right', 'bottom', 'left']) {
        const from = await card.locator(`[data-handlepos="${side}"]`).boundingBox();
        const to = await textNode.locator('[data-handlepos="left"]').boundingBox();
        await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
        await page.mouse.down();
        await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, {steps: 10});
        await page.mouse.up();
    }
    await expect(page.locator('.react-flow__edge')).toHaveCount(4);
});
