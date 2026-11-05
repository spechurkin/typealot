import {getLanguage, t} from './i18n';
import type {JSONContent} from '@tiptap/react';
import type {Note, Workspace} from './model';
import {safeMedia} from './media';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[c]!));
const url = (value: unknown) => {
    try {
        const u = new URL(String(value));
        return ['http:', 'https:', 'mailto:'].includes(u.protocol) ? escape(u.href) : '';
    } catch {
        return '';
    }
};
const color = (value: unknown) => {
    if (typeof value !== 'string') return '';
    const palette: Record<string, string> = {
        'var(--ink-red)': '#9f3b3b',
        'var(--ink-ochre)': '#805515',
        'var(--ink-green)': '#4b6325',
        'var(--ink-teal)': '#24665e',
        'var(--ink-blue)': '#285c8a',
        'var(--ink-purple)': '#704b91',
        'var(--highlight)': '#f3e0a3'
    };
    return palette[value] || (/^(#[\da-fA-F]{3,8}|rgba?\([\d.,%\s]+\))$/.test(value) ? value : '');
};

export function renderNoteContent(note: Note, workspace: Workspace): string {
    const textLength = (node: JSONContent): number => (node.text?.length || 0) + (node.content || []).reduce((sum, child) => sum + textLength(child), 0);
    if (textLength(note.content) <= 250) return renderNoteHtml(note, workspace, true);
    let remaining = 250;
    let ended = false;
    const excerpt = (node: JSONContent): JSONContent | null => {
        if (ended) return null;
        if (node.type === 'text') {
            const text = node.text || '';
            if (text.length < remaining) {
                remaining -= text.length;
                return node;
            }
            ended = true;
            return {...node, text: text.slice(0, remaining) + '...'};
        }
        return {...node, ...(node.content ? {content: node.content.map(excerpt).filter((child): child is JSONContent => child !== null)} : {})};
    };
    return renderNoteHtml({...note, content: excerpt(note.content)!}, workspace, true);
}

export function exportNoteHtml(note: Note, workspace: Workspace): string {
    return renderNoteHtml(note, workspace, false);
}

function renderNoteHtml(note: Note, workspace: Workspace, preview: boolean): string {
    const contentColor = (value: unknown) => preview && typeof value === 'string' && /^var\(--(ink-(red|ochre|green|teal|blue|purple)|highlight)\)$/.test(value) ? value : color(value);
    const headings: { id: string; text: string }[] = [];
    let heading = 0;
    const inlineText = (n: JSONContent): string => n.text || n.content?.map(inlineText).join('') || '';
    const gather = (n: JSONContent) => {
        if (n.type === 'heading') headings.push({id: `section-${headings.length + 1}`, text: inlineText(n)});
        n.content?.forEach(gather);
    };
    gather(note.content);
    const render = (n: JSONContent): string => {
        const children = () => n.content?.map(render).join('') || '';
        if (n.type === 'text') {
            let text = escape(n.text);
            for (const mark of n.marks || []) {
                const tag = ({
                    bold: 'strong',
                    italic: 'em',
                    underline: 'u',
                    strike: 's',
                    code: 'code'
                } as Record<string, string>)[mark.type];
                if (tag) text = `<${tag}>${text}</${tag}>`;
                if (mark.type === 'link' && url(mark.attrs?.href)) text = `<a href="${url(mark.attrs?.href)}">${text}</a>`;
                if (mark.type === 'textStyle') {
                    const styles = [contentColor(mark.attrs?.color) ? `color:${contentColor(mark.attrs?.color)}` : '', /^\d{1,3}(px|pt|em|rem)$/.test(mark.attrs?.fontSize || '') ? `font-size:${mark.attrs!.fontSize}` : ''].filter(Boolean).join(';');
                    if (styles) text = `<span style="${escape(styles)}">${text}</span>`;
                }
                if (mark.type === 'highlight') text = `<mark${contentColor(mark.attrs?.color) ? ` style="background-color:${escape(contentColor(mark.attrs?.color))}"` : ''}>${text}</mark>`;
            }
            return text;
        }
        const align = ['left', 'center', 'right'].includes(n.attrs?.textAlign) ? ` style="text-align:${n.attrs!.textAlign}"` : '';
        if (n.type === 'heading') {
            const level = n.attrs?.level === 3 ? 3 : 2;
            return `<h${level}${preview ? '' : ` id="section-${++heading}"`}${align}>${children()}</h${level}>`;
        }
        if (n.type === 'media') {
            const media = safeMedia(n.attrs);
            return media ? `<aside class="media"><strong>${media.provider === 'youtube' ? 'YouTube' : 'Spotify'}</strong><p><a href="${url(media.canonicalUrl)}">${escape(t('media.openOriginal'))}</a></p></aside>` : '';
        }
        if (n.type === 'image') {
            const src = String(n.attrs?.src || '');
            const margin = n.attrs?.alignment === 'left' ? '24px auto 24px 0' : n.attrs?.alignment === 'right' ? '24px 0 24px auto' : '24px auto';
            return /^(https:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(src) ? `<img src="${escape(src)}" alt="${escape(n.attrs?.alt)}" style="width:${Math.max(20, Math.min(100, Number(n.attrs?.width) || 100))}%;margin:${margin}"/>` : '';
        }
        if (n.type === 'attachment') {
            const data = workspace.attachments.find(a => a.id === n.attrs?.attachmentId) || n.attrs;
            return data?.data?.startsWith('data:') ? `<p><a download="${escape(data.name)}" href="${escape(data.data)}">${escape(data.name)}</a></p>` : '';
        }
        if (n.type === 'noteLink') {
            const linked = workspace.notes.find(x => x.id === n.attrs?.noteId);
            return `<span>${escape(linked?.title || n.attrs?.label)}</span>`;
        }
        if (n.type === 'toc') return `<nav aria-label="${escape(t('editor.blocks.toc'))}">${headings.map(h => preview ? `<p>${escape(h.text)}</p>` : `<p><a href="#${h.id}">${escape(h.text)}</a></p>`).join('')}</nav>`;
        if (n.type === 'hardBreak') return '<br/>';
        if (n.type === 'horizontalRule') return '<hr/>';
        if (n.type === 'taskItem') return preview ? `<li><label>${n.attrs?.checked ? '☑' : '☐'}</label><div>${children()}</div></li>` : `<li>${n.attrs?.checked ? '☑' : '☐'} ${children()}</li>`;
        if (n.type === 'taskList' && preview) return `<ul data-type="taskList">${children()}</ul>`;
        const tag = ({
            paragraph: 'p',
            blockquote: 'blockquote',
            bulletList: 'ul',
            orderedList: 'ol',
            listItem: 'li',
            taskList: 'ul',
            codeBlock: 'pre',
            table: 'table',
            tableRow: 'tr',
            tableHeader: 'th',
            tableCell: 'td',
            callout: 'aside'
        } as Record<string, string>)[n.type || ''];
        const span = (value: unknown) => Math.max(1, Math.min(100, Math.floor(Number(value) || 1)));
        const attrs = n.type === 'tableCell' || n.type === 'tableHeader' ? ` colspan="${span(n.attrs?.colspan)}" rowspan="${span(n.attrs?.rowspan)}"` : n.type === 'orderedList' ? ` start="${Math.max(1, Math.floor(Number(n.attrs?.start) || 1))}"` : '';
        return tag ? `<${tag}${align}${attrs}>${children()}</${tag}>` : children();
    };
    if (preview) return render(note.content);
    return `<!doctype html><html lang="${getLanguage()}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${escape(note.title)}</title><style>body{font:18px/1.65 Tahoma,Arial,sans-serif;color:#242725;background:#fdfdfc;margin:auto;max-width:820px;padding:40px 24px}h1{font-size:40px;line-height:1.25}h2{margin-top:36px}p{margin:0 0 22px}.author{font-size:13px;color:#626764}img{max-width:100%;height:auto;display:block;margin:24px auto}blockquote,aside{border-left:3px solid #626764;padding:8px 22px;margin:25px 0}a{color:#286448}table{border-collapse:collapse;width:100%}td,th{border:1px solid #626764;padding:10px}pre{white-space:pre-wrap;font:14px/1.6 Consolas,monospace;background:#eee;padding:20px}code{font-family:Consolas,monospace}@media(max-width:600px){h1{font-size:30px}}</style></head><body><h1>${escape(note.title || t('notes.untitled'))}</h1>${render(note.content)}</body></html>`;
}
