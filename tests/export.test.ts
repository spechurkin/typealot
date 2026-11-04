import {beforeEach, expect, it} from 'vitest';
import {initialWorkspace} from '../src/model';
import {exportNoteHtml} from '../src/export';
import {setLanguage} from '../src/i18n';

beforeEach(() => setLanguage('ru'));
it('exports document formatting and media links while escaping executable text', () => {
    const w = initialWorkspace(), n = w.notes[0];
    n.title = '<script>alert(1)</script>';
    n.content = {
        type: 'doc',
        content: [{
            type: 'paragraph',
            content: [{
                type: 'text',
                text: 'Оформление',
                marks: [{type: 'bold'}, {type: 'textStyle', attrs: {fontSize: '24px', color: '#285c8a'}}]
            }]
        }, {
            type: 'media',
            attrs: {
                provider: 'youtube',
                contentType: 'video',
                externalId: 'dQw4w9WgXcQ',
                canonicalUrl: 'https://youtu.be/dQw4w9WgXcQ',
                start: 0,
                compact: false
            }
        }]
    };
    const html = exportNoteHtml(n, w);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('<strong>Оформление</strong>');
    expect(html).toContain('font-size:24px');
    expect(html).toContain('Открыть оригинал');
    expect(html).not.toContain('<iframe');
});
it('keeps layout attributes and translates export controls without translating document text', () => {
    const w = initialWorkspace(), n = w.notes[0];
    n.title = 'Настройки';
    n.content = {
        type: 'doc',
        content: [{
            type: 'heading',
            attrs: {level: 2, textAlign: 'right'},
            content: [{type: 'text', text: 'Мои мысли'}]
        }, {
            type: 'image',
            attrs: {src: 'https://example.com/image.png', alt: 'Фото', width: 50, alignment: 'left'}
        }, {
            type: 'table',
            content: [{
                type: 'tableRow',
                content: [{type: 'tableCell', attrs: {colspan: 2, rowspan: 3}, content: [{type: 'paragraph'}]}]
            }]
        }, {type: 'toc'}]
    };
    setLanguage('en');
    try {
        const html = exportNoteHtml(n, w);
        expect(html).toContain('<html lang="en">');
        expect(html).toContain('<h1>Настройки</h1>');
        expect(html).toContain('text-align:right');
        expect(html).toContain('margin:24px auto 24px 0');
        expect(html).toContain('colspan="2" rowspan="3"');
        expect(html).toContain('aria-label="Table of contents"');
    } finally {
        setLanguage('ru');
    }
});
