import {expect, test} from '@playwright/test';

test('inline insertion, persistence and exact global search by clickable hashtag', async ({page}) => {
    await page.goto('/');
    const title = page.getByLabel('Заголовок заметки');
    const doc = page.getByLabel('Содержимое заметки');
    await title.fill('Первая с тегом');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.getByLabel('Вставить блок', {exact: true}).click();
    await page.locator('.line-insert-menu').getByRole('button', {name: 'Хэштег', exact: true}).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(doc.locator('p').last()).toHaveText('#');
    await page.keyboard.insertText('Проект');
    await expect(doc.getByRole('link', {name: '#Проект', exact: true})).toBeVisible();
    await page.keyboard.insertText(', конец');
    await expect(doc.getByRole('link', {name: '#Проект', exact: true})).toHaveAttribute('href', /#tag\//);
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.reload();
    await expect(doc.getByRole('link', {name: '#Проект', exact: true})).toBeVisible();

    for (const [name, text] of [['Вторая с тегом', '#проект'], ['Другой тег', '#проектный']]) {
        await page.getByRole('button', {name: 'Создать заметку', exact: true}).click();
        await title.fill(name);
        await doc.fill(text);
    }
    await page.locator('.tree-note').filter({hasText: 'Первая с тегом'}).click();
    await doc.getByRole('link', {name: '#Проект', exact: true}).click();
    await expect(page.locator('.main-search input')).toHaveValue('#Проект');
    await expect(page.locator('.search-results strong')).toHaveText(['Первая с тегом', 'Вторая с тегом']);
    await page.locator('.search-results button').filter({hasText: 'Первая с тегом'}).click();
    const link = doc.getByRole('link', {name: '#Проект', exact: true});
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.main-search input')).toHaveValue('#Проект');
    await expect(page.locator('.search-results strong')).toHaveCount(2);
    await page.screenshot({path: 'test-results/hashtag-search.png'});
});

test('slash hashtag insertion and reading mode links on mobile', async ({page}) => {
    await page.goto('/');
    await page.setViewportSize({width: 390, height: 844});
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/hashtag');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(doc.locator('p').last()).toHaveText('#');
    await page.keyboard.insertText('мобильный');
    await page.getByRole('button', {name: 'Режим чтения', exact: true}).click();
    await page.screenshot({path: 'test-results/hashtag-mobile.png'});
    await doc.getByRole('link', {name: '#мобильный', exact: true}).click();
    await expect(page.locator('.main-search input')).toHaveValue('#мобильный');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pasted and formatted hashtags remain editable and exclude code and URLs', async ({page}) => {
    await page.goto('/');
    const doc = page.getByLabel('Содержимое заметки');
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await doc.evaluate(el => {
        const data = new DataTransfer();
        data.setData('text/html', '<p>#за<strong>метки</strong>, #中文 <code>#код</code> https://example.com/#fragment</p>');
        el.dispatchEvent(new ClipboardEvent('paste', {bubbles: true, cancelable: true, clipboardData: data}));
    });
    await expect(doc.locator('a[data-hashtag="#заметки"]')).toHaveCount(2);
    await expect(doc.getByRole('link', {name: '#中文', exact: true})).toBeVisible();
    await expect(doc.locator('a[data-hashtag="#код"], a[data-hashtag="#fragment"]')).toHaveCount(0);
    await doc.fill('#редактирование');
    await expect(doc.getByRole('link', {name: '#редактирование', exact: true})).toBeVisible();
    await expect(page.locator('.header-actions [role=status]')).toHaveText('Сохранено');
    await page.reload();
    await doc.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Backspace');
    await expect(doc.getByRole('link', {name: '#редактировани', exact: true})).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(doc.getByRole('link', {name: '#редактирование', exact: true})).toBeVisible();
});
