import {expect, test} from '@playwright/test';
import packageInfo from '../package.json' with {type: 'json'};

const nextVersion = `${Number(packageInfo.version.split('.')[0]) + 1}.0.0`;
const followingVersion = `${Number(packageInfo.version.split('.')[0]) + 1}.1.0`;

test('notifies on startup, dismisses one version and checks again after thirty minutes', async ({page}) => {
    let version = nextVersion, checks = 0;
    await page.route('**/__typealot/version', route => {
        checks++;
        return route.fulfill({json: {version}});
    });
    await page.clock.install();
    await page.goto('/');
    const notice = page.getByRole('complementary', {name: 'Обновление Typealot'});
    await expect(notice).toContainText(nextVersion);
    await notice.getByRole('button', {name: 'Позже', exact: true}).click();
    await expect(notice).toHaveCount(0);
    version = followingVersion;
    await page.clock.fastForward(30 * 60 * 1000);
    await expect(notice).toContainText(followingVersion);
    expect(checks).toBeGreaterThanOrEqual(2);
    await page.setViewportSize({width: 360, height: 740});
    expect(await notice.evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(360);
    await notice.getByRole('button', {name: 'Обновить и перезапустить'}).click();
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await expect(notice).toContainText(followingVersion);
});

test('an unavailable release channel does not block editing', async ({page}) => {
    await page.route('**/__typealot/version', route => route.abort());
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await expect(page.locator('.update-notice')).toHaveCount(0);
});

test('desktop notification offers download, then installation after saving edits', async ({page}) => {
    await page.addInitScript(() => {
        let receive: (state: unknown) => void = () => {
        };
        Object.assign(window, {
            typealotDesktop: {
                onBeforeClose: () => () => {
                }, installServer: async () => ({ok: false, error: 'unavailable'}),
                updateState: async () => ({status: 'available', version: '0.2.0'}),
                onUpdate: (callback: (state: unknown) => void) => {
                    receive = callback;
                    return () => {
                    };
                },
                downloadUpdate: async () => {
                    receive({status: 'ready', version: '0.2.0'});
                    return true;
                },
                installUpdate: async () => {
                    sessionStorage.setItem('installed', 'yes');
                    return true;
                }
            }
        });
    });
    await page.goto('/');
    const notice = page.getByRole('complementary', {name: 'Обновление Typealot'});
    await expect(notice).toContainText('0.2.0');
    await notice.getByRole('button', {name: 'Скачать обновление'}).click();
    await expect(notice).toContainText('готов к установке');
    await page.getByLabel('Заголовок заметки').fill('Сохранить перед обновлением');
    await notice.getByRole('button', {name: 'Обновить и перезапустить'}).click();
    expect(await page.evaluate(() => sessionStorage.getItem('installed'))).toBe('yes');
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Сохранить перед обновлением');
});

test('notification fits both themes and narrow screens and supports keyboard dismissal', async ({page}) => {
    await page.route('**/__typealot/version', route => route.fulfill({json: {version: nextVersion}}));
    await page.goto('/');
    const notice = page.locator('.update-notice');
    await expect(notice).toBeVisible();
    for (const theme of ['dark', 'light']) for (const width of [360, 1440]) {
        await page.setViewportSize({width, height: 800});
        await page.evaluate(theme => {
            document.documentElement.dataset.theme = theme;
        }, theme);
        const result = await notice.evaluate(el => {
            const color = (value: string) => {
                const c = value.match(/\d+/g)!.slice(0, 3).map(Number).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
                return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
            };
            const style = getComputedStyle(el);
            const a = color(style.color), b = color(style.backgroundColor);
            return {
                contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
                right: el.getBoundingClientRect().right,
                overflow: el.scrollWidth > el.clientWidth
            };
        });
        expect(result.contrast).toBeGreaterThanOrEqual(4.5);
        expect(result.right).toBeLessThanOrEqual(width);
        expect(result.overflow).toBe(false);
    }
    await page.screenshot({path: 'test-results/update-notice-light.png'});
    await notice.getByRole('button', {name: 'Позже', exact: true}).focus();
    await page.keyboard.press('Enter');
    await expect(notice).toHaveCount(0);
});
