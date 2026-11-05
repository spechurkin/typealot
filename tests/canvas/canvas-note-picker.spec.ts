import {expect, test} from '@playwright/test';

for (const mobile of [false, true]) {
    test(`canvas note picker keeps the folder tree beside its button (${mobile ? 'mobile' : 'desktop'})`, async ({page}) => {
        if (mobile) await page.setViewportSize({width: 390, height: 844});
        await page.goto('/');
        await expect(page.locator('.save-status')).toHaveText('Сохранено');
        await page.evaluate(async () => {
            const path = '/src/storage/storage.ts';
            const {loadWorkspace, saveWorkspace} = await import(path);
            const workspace = await loadWorkspace();
            workspace.theme = 'light';
            workspace.folders.push({id: 'nested', name: 'Проект', parentId: 'inbox'});
            workspace.notes.push(...[
                {id: 'nested-note', title: 'План проекта', folderId: 'nested'},
                {id: 'root-note', title: 'Без папки', folderId: null}
            ].map(note => ({...note, updatedAt: Date.now(), content: {type: 'doc', content: [{type: 'paragraph'}]}})));
            await saveWorkspace(workspace);
        });
        await page.reload();
        if (mobile) await page.getByRole('button', {name: 'Открыть навигацию', exact: true}).click();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        const trigger = page.getByRole('button', {name: 'Карточка заметки', exact: true});
        const picker = page.getByRole('region', {name: 'Карточка заметки', exact: true});
        await trigger.click();
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(picker.getByRole('button', {name: 'Место для ваших мыслей', exact: true})).toBeVisible();
        await expect(picker.getByRole('button', {name: 'Без папки', exact: true})).toBeVisible();
        const folder = picker.getByRole('button', {name: 'Проект', exact: true});
        const note = picker.getByRole('button', {name: 'План проекта', exact: true});
        await folder.click();
        await expect(note).toBeHidden();
        await folder.focus();
        await page.keyboard.press('Enter');
        await expect(note).toBeVisible();
        const buttonBounds = (await trigger.boundingBox())!;
        const menuBounds = (await picker.boundingBox())!;
        expect(menuBounds.width).toBeLessThanOrEqual(280);
        expect(Math.abs(menuBounds.y - buttonBounds.y - buttonBounds.height)).toBeLessThan(12);
        expect(menuBounds.x).toBeLessThanOrEqual(buttonBounds.x + buttonBounds.width);
        expect(menuBounds.x + menuBounds.width).toBeGreaterThan(buttonBounds.x);
        expect(await picker.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({path: `test-results/canvas-note-picker-${mobile ? 'mobile' : 'desktop'}.png`});
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.click();
        await page.locator('.react-flow__pane').click({position: {x: 30, y: 400}});
        await expect(picker).toHaveCount(0);
        await trigger.click();
        await note.click();
        await expect(picker).toHaveCount(0);
        const card = page.locator('.board-object.note .card-title').filter({hasText: 'План проекта'});
        await expect(card).toBeVisible();
        await card.click();
        await expect(page.getByLabel('Заголовок заметки')).toHaveValue('План проекта');
    });
}
