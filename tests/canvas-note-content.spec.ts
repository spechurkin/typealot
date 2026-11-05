import {expect, test} from '@playwright/test';

for (const theme of ['dark', 'light']) {
    test(`canvas preserves note formatting and live edits (${theme})`, async ({page}) => {
        await page.goto('/');
        await expect(page.getByRole('status').filter({hasText: 'Сохранено'})).toBeVisible();
        await page.evaluate(async theme => {
            const path = '/src/storage.ts';
            const {loadWorkspace, saveWorkspace} = await import(path);
            const workspace = await loadWorkspace();
            workspace.theme = theme;
            delete workspace.notes[0].collaboration;
            workspace.notes[0].title = 'W.R.G. (рабочее название)';
            const paragraph = (text: string) => ({type: 'paragraph', content: [{type: 'text', text}]});
            workspace.notes[0].content = {
                type: 'doc', content: [
                    paragraph('Реалистичная физика и аркада.'),
                    paragraph('Собственное чувство реальности.'),
                    paragraph('Своя история брендов.'),
                    paragraph('Дух старой школы.'),
                    {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: 'Особенности'}]},
                    {
                        type: 'paragraph', attrs: {textAlign: 'right'}, content: [
                            {
                                type: 'text',
                                text: 'Выделение',
                                marks: [{type: 'bold'}, {type: 'italic'}, {
                                    type: 'textStyle',
                                    attrs: {color: 'var(--ink-blue)', fontSize: '24px'}
                                }]
                            },
                            {type: 'hardBreak'}, {type: 'text', text: 'Новая строка'}
                        ]
                    },
                    {type: 'bulletList', content: [{type: 'listItem', content: [paragraph('Список')]}]},
                    {type: 'blockquote', content: [paragraph('Цитата')]},
                    paragraph('Длинное описание. '.repeat(30) + 'Конец заметки.')
                ]
            };
            await saveWorkspace(workspace);
        }, theme);
        await page.reload();
        await page.getByRole('button', {name: 'Заметки', exact: true}).click();
        await expect(page.getByLabel('Заголовок заметки')).toHaveValue('W.R.G. (рабочее название)');
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        const card = page.locator('.board-object.note');
        const body = card.locator('.board-note-content');
        await expect(body.locator(':scope > p')).toHaveCount(6);
        await expect(body.locator('h2')).toHaveText('Особенности');
        await expect(body.locator('strong')).toHaveText('Выделение');
        await expect(body.locator('em')).toHaveText('Выделение');
        await expect(body.locator('p[style]')).toHaveCSS('text-align', 'right');
        await expect(body.locator('br')).toHaveCount(1);
        await expect(body.locator('ul li')).toHaveText('Список');
        await expect(body.locator('blockquote')).toHaveText('Цитата');
        await expect(body).not.toContainText('Конец заметки.');
        expect((await body.textContent())!.endsWith('...')).toBe(true);
        expect(await body.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({path: test.info().outputPath(`note-card-${theme}.png`)});
        await card.locator('.card-title').focus();
        await page.keyboard.press('Enter');
        const editor = page.getByLabel('Содержимое заметки');
        await editor.click();
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Updated content');
        await expect(page.getByRole('status').filter({hasText: 'Сохранено'})).toBeVisible();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        await expect(body).toContainText('Updated content');
    });
}
