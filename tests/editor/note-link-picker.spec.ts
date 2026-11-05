import {expect, type Page, test} from '@playwright/test';

async function openPicker(page: Page) {
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.locator('.line-insert-menu').getByRole('button', {
        name: 'Ссылка на другую заметку',
        exact: true
    }).click();
    return page.getByRole('dialog');
}

for (const mobile of [false, true]) {
    test(`note link folders expand independently and select a nested note (${mobile ? 'mobile' : 'desktop'})`, async ({page}) => {
        if (mobile) await page.setViewportSize({width: 390, height: 844});
        await page.goto('/');
        await expect(page.locator('.save-status')).toHaveText('Сохранено');
        await page.evaluate(async () => {
            const modulePath = '/src/storage/storage.ts';
            const {loadWorkspace, saveWorkspace} = await import(modulePath);
            const workspace = await loadWorkspace();
            workspace.folders = [
                {id: 'inbox', name: 'Мои заметки', parentId: null},
                {id: 'project', name: 'Проект', parentId: 'inbox'},
                {id: 'archive', name: 'Архив', parentId: null},
                {id: 'empty', name: 'Пустая папка', parentId: null}
            ];
            workspace.notes.push(...[
                {id: 'target', title: 'План проекта', folderId: 'project'},
                {id: 'archived', title: 'Архивная заметка', folderId: 'archive'},
                {id: 'root', title: 'Без папки', folderId: null},
                {id: 'untitled', title: '', folderId: 'inbox'}
            ].map(note => ({...note, updatedAt: Date.now(), content: {type: 'doc', content: [{type: 'paragraph'}]}})));
            await saveWorkspace(workspace);
        });
        await page.reload();
        const dialog = await openPicker(page);
        await expect(dialog.getByRole('button', {name: 'Место для ваших мыслей', exact: true})).toHaveCount(0);
        await expect(dialog.getByRole('button', {name: 'Без папки', exact: true})).toBeVisible();
        await expect(dialog.getByRole('button', {name: 'Без названия', exact: true})).toBeVisible();
        const parent = dialog.getByRole('button', {name: 'Мои заметки', exact: true});
        const child = dialog.getByRole('button', {name: 'Проект', exact: true});
        const target = dialog.getByRole('button', {name: 'План проекта', exact: true});
        await child.click();
        await expect(child).toHaveAttribute('aria-expanded', 'false');
        await expect(target).toBeHidden();
        await expect(dialog.getByRole('button', {name: 'Архивная заметка', exact: true})).toBeVisible();
        await parent.click();
        await expect(child).toBeHidden();
        await parent.focus();
        await page.keyboard.press('Enter');
        await expect(child).toBeVisible();
        await expect(target).toBeHidden();
        await child.focus();
        await page.keyboard.press('Space');
        await expect(target).toBeVisible();
        await expect(dialog.getByRole('button', {name: 'Пустая папка', exact: true})).toBeVisible();
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({path: `test-results/note-link-picker-${mobile ? 'mobile' : 'desktop'}.png`});
        await target.click();
        await expect(dialog).toHaveCount(0);
        const link = page.getByLabel('Содержимое заметки').locator('a[data-note-id="target"]');
        await expect(link).toHaveText('План проекта');
        await expect(page.locator('.save-status')).toHaveText('Сохранено');
        await page.reload();
        await link.click();
        await expect(page.getByLabel('Заголовок заметки')).toHaveValue('План проекта');
    });
}

test('note link picker explains when no other notes exist', async ({page}) => {
    await page.goto('/');
    const dialog = await openPicker(page);
    await expect(dialog).toContainText('Создайте ещё одну заметку для ссылки.');
    await expect(dialog.locator('.note-choices button')).toHaveCount(0);
});
