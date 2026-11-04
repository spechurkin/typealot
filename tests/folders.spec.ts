import {expect, test} from '@playwright/test';

test('nested folder shortcut creates inside a collapsed parent', async ({page}) => {
    await page.goto('/');
    const folder = page.locator('.folder-row').filter({hasText: 'Мои заметки'});
    await folder.getByRole('button', {name: 'Мои заметки', exact: true}).click();
    await folder.getByLabel('Создать папку в Мои заметки', {exact: true}).click();
    await expect(page.getByLabel('Родительская папка', {exact: true})).not.toHaveValue('');
    await page.getByLabel('Название', {exact: true}).fill('Вложенная');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    const nested = folder.locator('..').locator('.folder-row').filter({hasText: 'Вложенная'});
    await expect(nested).toBeVisible();
    await nested.getByLabel('Действия с папкой: Вложенная', {exact: true}).click();
    await page.getByRole('button', {name: 'Переименовать папку', exact: true}).click();
    await page.getByLabel('Название', {exact: true}).fill('Переименована');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await expect(folder.locator('..').locator('.folder-row')).toContainText(['Мои заметки', 'Переименована']);
});

test('note row actions move and delete an inactive note, keeping the editor selection', async ({page}) => {
    await page.goto('/');
    const title = page.getByLabel('Заголовок заметки');
    await expect(title).toHaveValue('Место для ваших мыслей');
    await page.getByLabel('Создать заметку', {exact: true}).click();
    await title.fill('Открытая заметка');
    await page.getByLabel('Действия с заметкой: Место для ваших мыслей', {exact: true}).click();
    await page.getByRole('button', {name: 'Переместить в папку', exact: true}).click();
    await page.getByLabel('Папка', {exact: true}).selectOption('');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await expect(title).toHaveValue('Открытая заметка');
    await expect(page.locator('.sidebar-content > .tree-note-row')).toContainText(['Место для ваших мыслей', 'Открытая заметка']);
    await page.getByLabel('Действия с заметкой: Место для ваших мыслей', {exact: true}).click();
    await page.getByRole('button', {name: 'Удалить заметку', exact: true}).click();
    await page.getByRole('button', {name: 'Удалить', exact: true}).click();
    await expect(page.locator('.tree-note-row')).toHaveCount(1);
    await expect(title).toHaveValue('Открытая заметка');
    await page.getByLabel('Действия', {exact: true}).click();
    await expect(page.locator('.header-actions .popup')).not.toContainText('Переместить');
    await expect(page.locator('.header-actions .popup')).not.toContainText('Удалить заметку');
    await expect(page.locator('.save-status')).toContainText('Сохранено');
    await page.reload();
    await expect(page.locator('.tree-note-row')).toHaveCount(1);
    await expect(title).toHaveValue('Открытая заметка');
});

for (const width of [1280, 390]) {
    test(`tree menus stay beside their triggers and support keyboard at ${width}px`, async ({page}) => {
        await page.setViewportSize({width, height: 780});
        await page.goto('/');
        await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
        if (width < 760) await page.getByLabel('Открыть навигацию', {exact: true}).click();
        for (const label of ['Действия с папкой: Мои заметки', 'Действия с заметкой: Место для ваших мыслей']) {
            const trigger = page.getByLabel(label, {exact: true});
            await trigger.focus();
            await page.keyboard.press('ArrowDown');
            const popup = trigger.locator('..').locator('.popup');
            await expect(popup).toBeVisible();
            await expect(popup.getByRole('button').first()).toBeFocused();
            await expect(page.getByRole('dialog')).toHaveCount(0);
            await expect.poll(async () => {
                const menu = (await popup.boundingBox())!, anchor = (await trigger.boundingBox())!;
                return menu.x >= 0 && menu.x + menu.width <= width && menu.width < 300 && Math.abs(menu.y - anchor.y - anchor.height) < 15;
            }).toBe(true);
            await expect(popup.locator('.danger')).toHaveCSS('color', 'rgb(232, 117, 117)');
            await page.keyboard.press('End');
            await expect(popup.getByRole('button').last()).toBeFocused();
            await page.keyboard.press('Escape');
            await expect(popup).not.toBeVisible();
            await expect(trigger).toBeFocused();
            await trigger.click();
            await page.locator('.brand .wordmark').click();
            await expect(popup).not.toBeVisible();
        }
        await page.getByLabel('Переключить тему', {exact: true}).click();
        await page.getByLabel('Действия с папкой: Мои заметки', {exact: true}).click();
        await expect(page.locator('.tree-actions[open] .danger')).toHaveCSS('color', 'rgb(181, 43, 43)');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({path: `test-results/tree-menu-${width}.png`});
    });
}

test('folder actions move a hierarchy and delete a folder while preserving its notes', async ({page}) => {
    await page.goto('/');
    await page.getByLabel('Создать папку', {exact: true}).click();
    await page.getByLabel('Название', {exact: true}).fill('Архив');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await page.getByLabel('Действия с папкой: Мои заметки', {exact: true}).click();
    await page.getByRole('button', {name: 'Переместить папку', exact: true}).click();
    await expect(page.getByLabel('Папка', {exact: true}).getByRole('option', {
        name: 'Мои заметки',
        exact: true
    })).toHaveCount(0);
    await page.getByLabel('Папка', {exact: true}).selectOption({label: 'Архив'});
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    const archive = page.locator('.folder-row').filter({hasText: 'Архив'}).locator('..');
    await expect(archive.locator('.tree-note')).toContainText('Место для ваших мыслей');
    await page.getByLabel('Действия с папкой: Мои заметки', {exact: true}).click();
    await page.getByRole('button', {name: 'Удалить папку', exact: true}).click();
    await expect(page.getByRole('dialog')).toContainText('Содержимое документов сохранится');
    await page.getByRole('button', {name: 'Удалить', exact: true}).click();
    await expect(page.locator('.folder-row').filter({hasText: 'Мои заметки'})).toHaveCount(0);
    await expect(archive.locator('.tree-note')).toContainText('Место для ваших мыслей');
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Место для ваших мыслей');
    await expect(page.locator('.save-status')).toContainText('Сохранено');
    await page.reload();
    await expect(page.locator('.folder-row').filter({hasText: 'Мои заметки'})).toHaveCount(0);
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Место для ваших мыслей');
});
