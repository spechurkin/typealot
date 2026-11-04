import {expect, it} from 'vitest';
import {renameAttachment, splitFilename} from '../src/attachments';

it('preserves extensions, dots in names, Unicode and extensionless files', () => {
    expect(renameAttachment('photo.jpg', 'Обложка')).toBe('Обложка.jpg');
    expect(renameAttachment('photo.jpg', 'Обложка.JPG')).toBe('Обложка.jpg');
    expect(renameAttachment('report.pdf', 'Отчёт.2026')).toBe('Отчёт.2026.pdf');
    expect(renameAttachment('LICENSE', 'Условия')).toBe('Условия');
    expect(splitFilename('archive.tar.gz')).toEqual({base: 'archive.tar', extension: '.gz'});
});

it('rejects blank names and removes characters unsafe for downloading', () => {
    for (const name of ['   ', '...', '.jpg']) expect(() => renameAttachment('photo.jpg', name)).toThrow();
    expect(renameAttachment('report.pdf', 'folder/file: name')).toBe('folder_file_ name.pdf');
    expect(renameAttachment('photo.jpg', 'x'.repeat(300))).toBe('x'.repeat(160) + '.jpg');
});
