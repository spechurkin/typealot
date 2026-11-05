import {expect, test} from '@playwright/test';

for (const aspect of [2, .5]) {
    test(`image size buttons work before and after handle resizing (aspect ${aspect})`, async ({page}) => {
        await page.goto('/');
        await expect(page.getByRole('status', {name: 'Сохранение на этом устройстве'})).toHaveText('Сохранено');
        await page.evaluate(async aspect => {
            const path = '/src/storage.ts';
            const {loadWorkspace, saveWorkspace} = await import(path);
            const workspace = await loadWorkspace();
            const canvas = document.createElement('canvas');
            canvas.width = 300;
            canvas.height = 300 / aspect;
            workspace.boards[0].nodes.push({
                id: 'test-image', type: 'object', position: {x: 450, y: 100},
                data: {kind: 'image', src: canvas.toDataURL()}, style: {width: 300}
            });
            await saveWorkspace(workspace);
        }, aspect);
        await page.reload();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        await page.getByRole('button', {name: 'Показать всё', exact: true}).click();
        const image = page.locator('.react-flow__node[data-id="test-image"]');
        const dimensions = () => image.evaluate(el => ({
            width: parseFloat((el as HTMLElement).style.width),
            height: el.getBoundingClientRect().height / el.getBoundingClientRect().width * parseFloat((el as HTMLElement).style.width)
        }));
        const expectSize = async (width: number, height: number) => {
            await expect.poll(async () => Math.abs((await dimensions()).width - width)).toBeLessThan(1);
            await expect.poll(async () => Math.abs((await dimensions()).height - height)).toBeLessThan(1);
        };
        await image.click();
        const initial = await dimensions();
        const larger = page.getByRole('button', {name: 'Увеличить', exact: true});
        const smaller = page.getByRole('button', {name: 'Уменьшить', exact: true});
        await larger.click();
        await expectSize(340, initial.height * 340 / 300);
        await smaller.click();
        await expectSize(300, initial.height);

        const handle = await image.locator('.react-flow__resize-control.bottom.right.handle').boundingBox();
        await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2);
        await page.mouse.down();
        await page.mouse.move(handle!.x + 65, handle!.y + 65 / aspect, {steps: 8});
        await page.mouse.up();
        const resized = await dimensions();
        expect(resized.width).toBeGreaterThan(340);
        await smaller.click();
        await expectSize(resized.width - 40, resized.height * (resized.width - 40) / resized.width);
        await larger.click();
        await larger.click();
        await expectSize(resized.width + 40, resized.height * (resized.width + 40) / resized.width);

        const final = await dimensions();
        await expect(page.getByRole('status', {name: 'Сохранение на этом устройстве'})).toHaveText('Сохранено');
        await page.reload();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        await expectSize(final.width, final.height);
        await image.click();
        for (let step = 0; step < 20; step++) await smaller.click();
        const minimum = await dimensions();
        expect(minimum.width).toBeGreaterThanOrEqual(160);
        expect(minimum.height).toBeGreaterThanOrEqual(99.9);
        await smaller.click();
        await expectSize(minimum.width, minimum.height);
        await larger.click();
        await expectSize(minimum.width + 40, minimum.height * (minimum.width + 40) / minimum.width);
        await expect(page.locator('.react-flow__node[data-id="card"]')).toHaveCSS('width', '300px');
    });
}
