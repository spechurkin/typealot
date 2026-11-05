import {expect, test} from '@playwright/test';

test('reload restores the selected note and reading mode', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByLabel('Создать заметку', {exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Последняя открытая заметка');
    await expect(page.locator('.save-status')).toContainText('Сохранено');
    await page.getByRole('button', {name: 'Режим чтения', exact: true}).click();
    await page.reload();
    await expect(page.locator('.tree-note-row.active')).toContainText('Последняя открытая заметка');
    await expect(page.locator('.header-actions button[aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('.ribbon')).toHaveCount(0);
});

test('reload restores the selected canvas and remembers the note when switching back', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByLabel('Создать заметку', {exact: true}).click();
    await page.getByLabel('Заголовок заметки').fill('Рабочая заметка');
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByLabel('Создать холст', {exact: true}).click();
    await page.getByLabel('Название', {exact: true}).fill('Рабочий холст');
    await page.getByRole('button', {name: 'Сохранить', exact: true}).click();
    await expect(page.locator('.save-status')).toContainText('Сохранено');
    await page.reload();
    await expect(page.locator('.sidebar nav .active')).toHaveAccessibleName('Холсты');
    await expect(page.locator('.sidebar .tree-note.active')).toHaveText('Рабочий холст');
    await expect(page.locator('.react-flow')).toBeVisible();
    await page.getByRole('button', {name: 'Заметки', exact: true}).click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Рабочая заметка');
});

for (const section of ['Поиск', 'Вложения', 'Настройки']) {
    test(`reload restores the ${section} tab`, async ({page}) => {
        await page.goto('/');
        await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
        await page.getByRole('button', {name: section, exact: true}).click();
        if (section === 'Поиск') await page.locator('.main-search input').fill('мыслей');
        await page.reload();
        await expect(page.locator('.sidebar nav .active')).toHaveAccessibleName(section);
        if (section === 'Поиск') await expect(page.locator('.main-search input')).toHaveValue('мыслей');
        await expect(page.getByRole('heading', {
            name: section === 'Поиск' ? 'Найти мысль' : section,
            exact: true
        })).toBeVisible();
    });
}

test('deep links take priority, and leaving a tag search does not reopen it on reload', async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await page.goto('/#note/welcome');
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Место для ваших мыслей');
    await page.goto('/#tag/проект');
    await expect(page.locator('.main-search input')).toHaveValue('#проект');
    await page.reload();
    await expect(page.locator('.main-search input')).toHaveValue('#проект');
    await page.getByRole('button', {name: 'Вложения', exact: true}).click();
    await page.reload();
    await expect(page.locator('.sidebar nav .active')).toHaveAccessibleName('Вложения');
});

for (const saved of ['{broken', 'null', '{"section":"missing","active":"deleted","boardId":"deleted"}']) {
    test(`invalid or obsolete saved navigation falls back safely: ${saved}`, async ({page}) => {
        await page.addInitScript(value => localStorage.setItem('typealot.navigation', value), saved);
        await page.goto('/');
        await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Место для ваших мыслей');
    });
}
