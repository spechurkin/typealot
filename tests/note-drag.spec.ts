import {expect, test, type Locator, type Page} from '@playwright/test';

async function holdDrag(page: Page, source: Locator, target: Locator, position?: { x: number; y: number }) {
    const start = (await source.boundingBox())!, end = (await target.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2, {steps: 3});
    const x = end.x + (position?.x ?? end.width / 2), y = end.y + (position?.y ?? end.height / 2);
    await page.mouse.move(x, y, {steps: 10});
    await page.mouse.move(x, y);
}

test.beforeEach(async ({page}) => {
    await page.goto('/');
    await expect(page.getByLabel('Заголовок заметки')).toBeVisible();
    await expect(page.getByRole('status').filter({hasText: 'Сохранено'})).toBeVisible();
    await page.evaluate(async () => {
        const modelPath = '/src/model.ts', storagePath = '/src/storage.ts';
        const {initialWorkspace, emptyDoc} = await import(modelPath);
        const {saveWorkspace} = await import(storagePath);
        const w = initialWorkspace();
        w.folders.push({id: 'archive', name: 'Архив', parentId: null});
        w.notes = ['Первая', 'Вторая', 'Третья'].map((title, i) => ({
            id: `note-${i}`, title, folderId: 'inbox', content: emptyDoc(), updatedAt: Date.now()
        }));
        w.boards[0].nodes = [];
        await saveWorkspace(w);
    });
    await page.reload();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Первая');
});

test('notes reorder, move between folders and return to root with saved order', async ({page}) => {
    const notes = page.locator('.sidebar .tree-note');
    await holdDrag(page, notes.filter({hasText: 'Третья'}), notes.filter({hasText: 'Первая'}), {x: 50, y: 2});
    await expect(page.locator('.tree-drag-preview')).toHaveText('Третья');
    await expect(page.locator('.drop-before')).toHaveCount(1);
    await expect(notes).toHaveText(['Первая', 'Вторая', 'Третья']);
    await page.mouse.up();
    await expect(page.locator('.tree-drag-preview')).toHaveCount(0);
    await expect(notes).toHaveText(['Третья', 'Первая', 'Вторая']);
    await notes.filter({hasText: 'Первая'}).dragTo(notes.filter({hasText: 'Вторая'}), {targetPosition: {x: 50, y: 30}});
    await expect(notes).toHaveText(['Третья', 'Вторая', 'Первая']);
    await notes.filter({hasText: 'Вторая'}).dragTo(page.locator('.folder-row').filter({hasText: 'Архив'}));
    const archive = page.locator('.folder-row').filter({hasText: 'Архив'}).locator('..');
    await expect(archive.locator('.tree-note')).toHaveText(['Вторая']);
    await archive.locator('.tree-note').dragTo(page.locator('.section-caption').filter({hasText: 'Библиотека'}));
    await expect(archive.locator('.tree-note')).toHaveCount(0);
    await expect(notes).toHaveText(['Третья', 'Первая', 'Вторая']);
    await expect.poll(async () => page.evaluate(async () => {
        const path = '/src/storage.ts';
        return (await (await import(path)).loadWorkspace()).notes.find((n: {
            id: string
        }) => n.id === 'note-1').folderId;
    })).toBeNull();
    await page.reload();
    await expect(notes).toHaveText(['Третья', 'Первая', 'Вторая']);
});

test('dropping a note in a document inserts a navigable reference without moving the source', async ({page}) => {
    await holdDrag(page, page.locator('.tree-note').filter({hasText: 'Вторая'}), page.getByLabel('Содержимое заметки'));
    await expect(page.locator('.note-drop-label')).toHaveText('↗ Вторая');
    await expect(page.locator('.document-body a[data-note-id]')).toHaveCount(0);
    await page.screenshot({path: test.info().outputPath('document-drop-preview.png')});
    await page.mouse.up();
    await expect(page.locator('.note-drop-label')).toHaveCount(0);
    const link = page.locator('.document-body a[data-note-id="note-1"]');
    await expect(link).toHaveText('Вторая');
    await expect(page.locator('.sidebar .tree-note')).toHaveCount(3);
    await link.click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Вторая');
});

test('notes from the sidebar become cards at the drop position on a zoomed canvas', async ({page}) => {
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByLabel('Увеличить масштаб', {exact: true}).click();
    await holdDrag(page, page.locator('.sidebar .tree-note').filter({hasText: 'Вторая'}), page.locator('.react-flow__pane'), {
        x: 350,
        y: 240
    });
    const preview = page.locator('.board-drop-preview');
    await expect(preview).toContainText('Вторая');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    const previewBounds = (await preview.boundingBox())!;
    await page.screenshot({path: test.info().outputPath('canvas-drop-preview.png')});
    await page.mouse.up();
    await expect(preview).toHaveCount(0);
    await expect(page.locator('.board-object .card-title')).toHaveText('Вторая');
    await expect(page.locator('.sidebar .tree-note').filter({hasText: 'Вторая'})).toHaveCount(1);
    const pane = await page.locator('.react-flow__pane').boundingBox();
    const card = await page.locator('.react-flow__node').boundingBox();
    expect(card!.x).toBeCloseTo(previewBounds.x, 0);
    expect(card!.y).toBeCloseTo(previewBounds.y, 0);
    expect(card!.width).toBeCloseTo(previewBounds.width, 0);
    expect(card!.x).toBeCloseTo(pane!.x + 350, 0);
    expect(card!.y).toBeCloseTo(pane!.y + 240, 0);
    await page.screenshot({path: test.info().outputPath('note-drop-canvas.png')});
    await page.locator('.board-object .card-title').click();
    await expect(page.getByLabel('Заголовок заметки')).toHaveValue('Вторая');
});

test('cancelling a drag removes the preview and leaves the canvas unchanged in light theme', async ({page}) => {
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await page.getByLabel('Переключить тему', {exact: true}).click();
    await holdDrag(page, page.locator('.sidebar .tree-note').filter({hasText: 'Вторая'}), page.locator('.react-flow__pane'));
    await expect(page.locator('.board-drop-preview')).toBeVisible();
    await page.screenshot({path: test.info().outputPath('canvas-drop-preview-light.png')});
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.locator('.board-drop-preview')).toHaveCount(0);
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
});

test('folders reorder, nest with their notes and return to root without allowing cycles', async ({page}) => {
    const folder = (name: string) => page.locator('.folder-row').filter({hasText: name});
    const source = (name: string) => folder(name).locator('button').first();
    const inbox = source('Мои заметки'), archive = source('Архив');
    await holdDrag(page, archive, folder('Мои заметки'), {x: 70, y: 2});
    await expect(page.locator('.tree-drag-preview')).toHaveText('Архив');
    await expect(page.locator('.drop-before')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('.folder-row>button:first-child')).toHaveText(['Архив', 'Мои заметки']);
    await holdDrag(page, archive, folder('Мои заметки'), {x: 70, y: 30});
    await page.mouse.up();
    await expect(page.locator('.folder-row>button:first-child')).toHaveText(['Мои заметки', 'Архив']);
    await holdDrag(page, inbox, folder('Архив'));
    await expect(page.locator('.tree-drag-preview')).toContainText('Мои заметки → Архив');
    await page.mouse.up();
    await expect(folder('Архив').locator('..').locator('.tree-note')).toHaveCount(3);
    // Moving the parent into its own subtree must be refused.
    await holdDrag(page, archive, folder('Мои заметки'));
    await expect(page.locator('.tree-drag-preview')).toHaveCount(0);
    await page.mouse.up();
    await expect(folder('Архив').locator('..').locator('.folder-row')).toHaveCount(2);
    await holdDrag(page, inbox, page.locator('.section-caption').filter({hasText: 'Библиотека'}));
    await page.mouse.up();
    await expect(folder('Архив').locator('..').locator('.tree-note')).toHaveCount(0);
    await expect(page.getByRole('status').filter({hasText: 'Сохранено'})).toBeVisible();
    await expect.poll(async () => page.evaluate(async () => {
        const path = '/src/storage.ts';
        return (await (await import(path)).loadWorkspace()).folders.find((f: {
            id: string
        }) => f.id === 'inbox').parentId;
    })).toBeNull();
    await page.reload();
    await expect(page.locator('.folder-row>button:first-child')).toHaveText(['Архив', 'Мои заметки']);
    await expect(folder('Мои заметки').locator('..').locator('.tree-note')).toHaveCount(3);
});

test('folder drags are refused by documents and canvases', async ({page}) => {
    const source = page.locator('.folder-row').filter({hasText: 'Архив'}).locator('button').first();
    const content = page.getByLabel('Содержимое заметки');
    const before = await content.textContent();
    await holdDrag(page, source, content);
    await expect(page.locator('.note-drop-label')).toHaveCount(0);
    await page.mouse.up();
    await expect(content).toHaveText(before!);
    await expect(page.locator('.document-body a[data-note-id]')).toHaveCount(0);
    // A folder MIME must also suppress any accompanying native text or HTML.
    await content.evaluate(element => {
        const dataTransfer = new DataTransfer();
        dataTransfer.setData('application/x-typealot-folder', 'archive');
        dataTransfer.setData('text/html', '<p>Folder payload</p>');
        dataTransfer.setData('text/plain', 'Folder payload');
        element.dispatchEvent(new DragEvent('drop', {dataTransfer, bubbles: true, cancelable: true}));
    });
    await expect(content).toHaveText(before!);
    await page.getByRole('button', {name: 'Холсты', exact: true}).click();
    await holdDrag(page, source, page.locator('.react-flow__pane'));
    await expect(page.locator('.board-drop-preview')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    await expect(page.locator('.folder-row>button:first-child')).toHaveText(['Мои заметки', 'Архив']);
});
