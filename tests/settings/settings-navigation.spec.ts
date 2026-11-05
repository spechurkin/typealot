import {expect, test} from '@playwright/test';

test('mobile navigation closes after selecting any tab, including the active tab', async ({page}) => {
    await page.setViewportSize({width: 390, height: 720});
    await page.goto('/');
    for (const name of ['Заметки', 'Холсты', 'Поиск', 'Вложения', 'Настройки', 'Настройки']) {
        await page.getByRole('button', {name: 'Открыть навигацию', exact: true}).click();
        await expect(page.locator('.sidebar')).toBeVisible();
        await page.locator('.sidebar nav').getByRole('button', {name, exact: true}).click();
        await expect(page.locator('.sidebar')).toBeHidden();
        await expect(page.locator('.mobile-scrim')).toHaveCount(0);
        await expect(page.locator('.workspace')).toBeVisible();
    }
});

test('settings categories stay in place while content scrolls and support keyboard navigation', async ({page}) => {
    await page.goto('/');
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    const navigation = page.getByRole('navigation', {name: 'Категории настроек'});
    const content = page.locator('.settings');
    const appearance = navigation.getByRole('link', {name: 'Внешний вид', exact: true});
    await expect(appearance).toHaveAttribute('aria-current', 'location');
    await expect(navigation.getByRole('link')).toHaveCount(6);
    const before = await navigation.boundingBox();
    const backups = navigation.getByRole('link').last();
    await backups.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#settings-backups')).toBeFocused();
    await expect(backups).toHaveAttribute('aria-current', 'location');
    expect(await content.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await navigation.boundingBox()).toEqual(before);
    await content.evaluate(element => element.scrollTop = 0);
    await expect(appearance).toHaveAttribute('aria-current', 'location');
    await page.getByLabel('Язык интерфейса', {exact: true}).selectOption('en');
    await expect(page.getByRole('navigation', {name: 'Settings categories'}).getByRole('link', {
        name: 'Appearance',
        exact: true
    })).toBeVisible();
    await page.getByLabel('Theme', {exact: true}).selectOption('light');
    await page.screenshot({path: 'test-results/settings-navigation-light.png'});
});

test('settings navigation remains available on a narrow screen', async ({page}) => {
    await page.setViewportSize({width: 390, height: 720});
    await page.goto('/');
    await page.getByRole('button', {name: 'Открыть навигацию', exact: true}).click();
    await page.getByRole('button', {name: 'Настройки', exact: true}).click();
    await expect(page.locator('.sidebar')).toBeHidden();
    await expect(page.locator('.mobile-scrim')).toHaveCount(0);
    const navigation = page.getByRole('navigation', {name: 'Категории настроек'});
    const before = await navigation.boundingBox();
    await navigation.getByRole('link').last().click();
    await expect(page.locator('#settings-backups')).toBeFocused();
    expect(await navigation.boundingBox()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.screenshot({path: 'test-results/settings-navigation-mobile.png'});
});
