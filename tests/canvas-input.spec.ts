import {expect, test} from '@playwright/test';

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
