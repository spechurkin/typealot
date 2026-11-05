import {expect, test} from '@playwright/test';

for (const {zoom, points} of [
    {zoom: 1, points: [[80, 120], [110, 90], [300, 70], [360, 120], [320, 180], [180, 260]]},
    {zoom: .6, points: [[80, 100], [120, 320], [180, 200]]},
    {zoom: 1.7, points: [[80, 100], [350, 130], [160, 220]]},
    {zoom: 1, points: [[80, 100], [350, 100]]},
    {zoom: 1, points: [[80, 100], [80, 280]]},
    {zoom: 1, points: [[80, 100], [84, 103]]}
]) {
    test(`drawing keeps its screen geometry at zoom ${zoom}, endpoint ${points.at(-1)}`, async ({page}, testInfo) => {
        await page.goto('/');
        const saved = page.getByRole('status', {name: 'Сохранение на этом устройстве'});
        await expect(saved).toHaveText('Сохранено');
        await page.evaluate(async zoom => {
            const path = '/src/storage.ts';
            const {loadWorkspace, saveWorkspace} = await import(path);
            const workspace = await loadWorkspace();
            workspace.boards[0].viewport = {x: 37, y: -24, zoom};
            await saveWorkspace(workspace);
        }, zoom);
        await page.reload();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        await page.getByRole('button', {name: 'Рисование', exact: true}).click();
        const overlay = page.locator('.draw-overlay');
        const area = (await overlay.boundingBox())!;
        await page.mouse.move(area.x + points[0][0], area.y + points[0][1]);
        await page.mouse.down();
        for (const [x, y] of points.slice(1)) await page.mouse.move(area.x + x, area.y + y, {steps: 8});
        const geometry = (selector: string) => page.locator(selector).evaluate((element: SVGPathElement) => {
            const matrix = element.getScreenCTM()!;
            const length = element.getTotalLength();
            return {
                points: [0, .25, .5, .75, 1].map(fraction => {
                    const p = element.getPointAtLength(length * fraction).matrixTransform(matrix);
                    return {x: p.x, y: p.y};
                }),
                stroke: Number(element.getAttribute('stroke-width')) * Math.hypot(matrix.a, matrix.b)
            };
        });
        const preview = await geometry('.draw-overlay path');
        await page.mouse.up();
        const compare = async () => {
            await expect.poll(async () => {
                const actual = await geometry('.board-object.drawing path');
                return Math.max(Math.abs(actual.stroke - preview.stroke), ...actual.points.flatMap((point, i) =>
                    [Math.abs(point.x - preview.points[i].x), Math.abs(point.y - preview.points[i].y)]));
            }).toBeLessThan(.1);
        };
        await compare();
        await page.getByRole('button', {name: 'Выделение', exact: true}).click();
        await page.locator('.board-object.drawing path').click({force: true});
        await expect(page.locator('.board-object.drawing')).toHaveClass(/selected/);
        await compare();
        if (zoom === .6) await page.screenshot({path: testInfo.outputPath('selected-drawing.png')});
        await expect(saved).toHaveText('Сохранено');
        await page.reload();
        await page.getByRole('button', {name: 'Холсты', exact: true}).click();
        await compare();
    });
}
