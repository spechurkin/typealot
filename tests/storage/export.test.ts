import {beforeEach, expect, it} from 'vitest';
import {initialWorkspace} from '../../src/storage/model';
import {exportNoteHtml, renderNoteContent} from '../../src/storage/export';
import {setLanguage} from '../../src/locales/i18n';

beforeEach(() => setLanguage('ru'));
it('clips previews inside formatted blocks and leaves the full note unchanged', () => {
    const w = initialWorkspace(), n = w.notes[0];
    n.content = {
        type: 'doc', content: [
            {type: 'heading', attrs: {level: 2}, content: [{type: 'text', text: 'Title'}]},
            {type: 'paragraph', content: [{type: 'text', text: 'x'.repeat(300), marks: [{type: 'bold'}]}]},
            {type: 'paragraph', content: [{type: 'text', text: 'Hidden tail'}]}
        ]
    };
    const original = JSON.stringify(n.content);
    const preview = renderNoteContent(n, w);
    expect(preview).toBe(`<h2>Title</h2><p><strong>${'x'.repeat(245)}...</strong></p>`);
    expect(JSON.stringify(n.content)).toBe(original);
    expect(exportNoteHtml(n, w)).toContain('Hidden tail');
});

it('adds ellipsis only when text exceeds the preview limit, including at a block boundary', () => {
    const w = initialWorkspace(), n = w.notes[0];
    n.content = {type: 'doc', content: [{type: 'paragraph', content: [{type: 'text', text: 'x'.repeat(250)}]}]};
    expect(renderNoteContent(n, w)).toBe(`<p>${'x'.repeat(250)}</p>`);
    n.content.content!.push({type: 'paragraph', content: [{type: 'text', text: 'tail'}]});
    expect(renderNoteContent(n, w)).toBe(`<p>${'x'.repeat(250)}...</p>`);
});

it('escapes preview text and keeps only safe formatting attributes', () => {
    const w = initialWorkspace(), n = w.notes[0];
    n.content = {
        type: 'doc', content: [{
            type: 'paragraph', content: [
                {
                    type: 'text', text: '<script>unsafe</script>', marks: [
                        {type: 'link', attrs: {href: 'javascript:alert(1)'}},
                        {type: 'textStyle', attrs: {color: 'var(--ink-blue)', fontSize: '24px'}}
                    ]
                }
            ]
        }]
    };
    const preview = renderNoteContent(n, w);
    expect(preview).toContain('&lt;script&gt;');
    expect(preview).toContain('color:var(--ink-blue)');
    expect(preview).toContain('font-size:24px');
    expect(preview).not.toContain('javascript:');
    expect(preview).not.toContain('<script>');
});

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
