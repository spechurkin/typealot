import {isFolderDrag} from '../library/folder-drag';
import {NoteDropPreview, setNoteDropPreview} from './note-drop-preview';
import {draggedNote, isNoteDrag} from '../library/note-drag';
import {
    type DisplayError,
    errorText,
    supportedLanguages,
    t,
    toError,
    type TranslationKey,
    useLanguage
} from '../locales/i18n';
import {useContext, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {
    type Editor,
    EditorContent,
    type NodeViewProps,
    NodeViewWrapper,
    ReactNodeViewRenderer,
    useEditor
} from '@tiptap/react';
import {BubbleMenu} from '@tiptap/react/menus';
import {NodeSelection, TextSelection} from '@tiptap/pm/state';
import {Extension, mergeAttributes, Node} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCaret from '@tiptap/extension-collaboration-caret';
import {useNoteCollaboration} from '../sync/note-collaboration';
import {identity, Y} from '../sync/realtime';
import CollaborationStatus from '../sync/CollaborationStatus';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import {Color, FontSize, TextStyle} from '@tiptap/extension-text-style';
import Highlight from '@tiptap/extension-highlight';
import Image from '@tiptap/extension-image';
import {Table, TableCell, TableHeader, TableRow} from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Suggestion from '@tiptap/suggestion';
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom';
import {
    AlignLeft,
    Bold,
    ChevronDown,
    Code,
    Hash,
    Image as ImageIcon,
    Italic,
    Link,
    List,
    ListOrdered,
    ListTree,
    MessageSquareWarning,
    Minus,
    Music2,
    Palette,
    Paperclip,
    Plus,
    Quote,
    Redo2,
    Strikethrough,
    Table2,
    Trash2,
    Underline,
    Undo2
} from 'lucide-react';
import {embedUrl, parseMedia, safeMedia} from '../media/media';
import {type Note, type Workspace} from '../storage/model';
import {Modal} from '../ui/ui';
import YouTubeFrame from '../media/YouTubeFrame';
import AttachmentPicker from '../media/AttachmentPicker';
import NoteLinkPicker from './NoteLinkPicker';
import {downloadAttachment} from '../storage/storage';
import {AttachmentContext} from '../media/attachments';
import {Hashtag} from './Hashtag';

function MediaView({node, selected, deleteNode, editor}: NodeViewProps) {
    useLanguage();
    const [loaded, setLoaded] = useState(true);
    const [failed, setFailed] = useState(false);
    const [failureReason, setFailureReason] = useState<TranslationKey>('media.loadFailed');
    const [online, setOnline] = useState(navigator.onLine);
    const m = safeMedia(node.attrs);
    useEffect(() => {
        const update = () => {
            setOnline(navigator.onLine);
            setLoaded(navigator.onLine);
            if (navigator.onLine) setFailed(false);
        };
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);
    return <NodeViewWrapper className={`media-block ${selected ? 'selected' : ''}`} contentEditable={false}>
        {!m ? <p>{t('media.invalidLink')}</p> : <>
            <div className={`player ${m.provider}`}>
                {loaded && online && !failed ? m.provider === 'youtube' ?
                        <YouTubeFrame src={embedUrl(m)} error={message => {
                            setFailureReason(message);
                            setFailed(true);
                        }}/> :
                        <iframe title="Spotify" src={embedUrl(m)} loading="eager"
                                width="820" height={m.compact ? 152 : 352}
                                referrerPolicy="strict-origin-when-cross-origin"
                                allow="encrypted-media; fullscreen; picture-in-picture"
                                sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allowFullScreen
                                onError={() => setFailed(true)}/>
                    : <div className="media-placeholder">
                        <strong>{m.provider === 'youtube' ? 'YouTube' : 'Spotify'}</strong><span>{!online ? t('media.offline') : t(failureReason)}</span>{online &&
                        <button onClick={() => {
                            setFailed(false);
                            setLoaded(true);
                        }}>{t('common.retryLoading')}</button>}</div>}
            </div>
            <div className="media-caption"><a href={m.canonicalUrl} target="_blank"
                                              rel="noopener noreferrer">{t('media.openOriginal')}</a>{loaded &&
                <button onClick={() => {
                    setFailed(true);
                    setLoaded(false);
                }}>{t('editor.playbackProblem')}</button>}{selected && editor.isEditable &&
                <button onClick={deleteNode} aria-label={t('editor.deleteMedia')}><Trash2 size={16}/></button>}</div>
        </>}
    </NodeViewWrapper>;
}

const MediaNode = Node.create({
    name: 'media',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes: () => Object.fromEntries(['provider', 'contentType', 'externalId', 'canonicalUrl', 'start', 'compact'].map(key => [key, {default: key === 'start' ? 0 : key === 'compact' ? false : ''}])),
    parseHTML: () => [{tag: 'div[data-media]'}],
    renderHTML: ({HTMLAttributes}) => ['div', mergeAttributes(HTMLAttributes, {'data-media': ''})],
    addNodeView: () => ReactNodeViewRenderer(MediaView)
});

function AttachmentView({node, deleteNode, editor}: NodeViewProps) {
    useLanguage();
    const attachments = useContext(AttachmentContext);
    const attachment = attachments.find(a => a.id === node.attrs.attachmentId) || node.attrs;
    return <NodeViewWrapper className="document-attachment" contentEditable={false}>
        <span>{String(attachment.name)}</span>
        <button
            onClick={() => downloadAttachment(String(attachment.name), String(attachment.data))}>{t('editor.downloadFile')}</button>
        {editor.isEditable &&
            <button aria-label={t('editor.removeFileFromNote')} onClick={deleteNode}><Trash2 size={16}/></button>}
    </NodeViewWrapper>;
}

const AttachmentNode = Node.create({
    name: 'attachment',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes: () => Object.fromEntries(['attachmentId', 'name', 'mime', 'data'].map(key => [key, {default: ''}])),
    parseHTML: () => [{tag: 'div[data-attachment]'}],
    renderHTML: ({node}) => ['div', {'data-attachment': node.attrs.attachmentId}, node.attrs.name],
    addNodeView: () => ReactNodeViewRenderer(AttachmentView)
});
const EditorImage = Image.extend({
    addAttributes() {
        return {
            ...this.parent?.(),
            width: {
                default: 100,
                parseHTML: el => Number(el.getAttribute('data-width')) || 100,
                renderHTML: attrs => ({
                    'data-width': attrs.width,
                    style: `width:${Math.max(20, Math.min(100, Number(attrs.width) || 100))}%;`
                })
            },
            alignment: {
                default: 'center',
                parseHTML: el => el.getAttribute('data-alignment') || 'center',
                renderHTML: attrs => ({
                    'data-alignment': attrs.alignment,
                    style: `margin-left:${attrs.alignment === 'left' ? '0' : 'auto'};margin-right:${attrs.alignment === 'right' ? '0' : 'auto'};`
                })
            }
        };
    }
});
const Callout = Node.create({
    name: 'callout',
    group: 'block',
    content: 'block+',
    defining: true,
    parseHTML: () => [{tag: 'aside[data-callout]'}],
    renderHTML: ({HTMLAttributes}) => ['aside', mergeAttributes(HTMLAttributes, {'data-callout': ''}), 0]
});
const Toc = Node.create({
    name: 'toc',
    group: 'block',
    atom: true,
    parseHTML: () => [{tag: 'nav[data-toc]'}],
    renderHTML: () => ['nav', {'data-toc': ''}, t('editor.blocks.toc')],
    addNodeView: () => ReactNodeViewRenderer(({editor}: NodeViewProps) => {
        useLanguage();
        const [heads, setHeads] = useState<{ text: string; pos: number }[]>([]);
        useEffect(() => {
            const update = () => {
                const h: { text: string; pos: number }[] = [];
                editor.state.doc.descendants((n, pos) => {
                    if (n.type.name === 'heading') h.push({text: n.textContent, pos});
                });
                setHeads(h);
            };
            update();
            editor.on('update', update);
            return () => {
                editor.off('update', update);
            };
        }, [editor]);
        return <NodeViewWrapper className="toc"
                                contentEditable={false}><strong>{t('editor.blocks.toc')}</strong>{heads.length ? heads.map(h =>
            <button key={h.pos} onClick={() => {
                editor.commands.setTextSelection(h.pos + 1);
                const dom = editor.view.nodeDOM(h.pos);
                if (dom instanceof HTMLElement) dom.scrollIntoView({block: 'center', behavior: 'smooth'});
            }}>{h.text}</button>) : <span>{t('editor.addHeadingsToThisNote')}</span>}</NodeViewWrapper>;
    })
});
const NoteLink = Node.create({
    name: 'noteLink',
    group: 'inline',
    inline: true,
    atom: true,
    addAttributes: () => ({noteId: {default: ''}, label: {default: ''}}),
    parseHTML: () => [{tag: 'a[data-note-id]'}],
    renderHTML: ({node}) => ['a', {
        'data-note-id': node.attrs.noteId,
        href: `#note/${encodeURIComponent(node.attrs.noteId)}`
    }, node.attrs.label]
});

type Command = { label: TranslationKey; icon: string; run: (e: Editor) => void };

function slashExtension(commands: Command[]) {
    return Extension.create({
        name: 'slash', addProseMirrorPlugins() {
            return [Suggestion({
                editor: this.editor, char: '/', startOfLine: true,
                items: ({query}) => commands.filter(c => supportedLanguages.map(locale => t(c.label, {}, locale)).join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase())),
                command: ({editor, range, props}) => {
                    editor.chain().focus().deleteRange(range).run();
                    (props as Command).run(editor);
                },
                render: () => {
                    let menu: HTMLDivElement;
                    let cleanup: (() => void) | undefined;
                    let current: any;
                    let active = 0;
                    const draw = () => {
                        menu.replaceChildren();
                        if (!current.items.length) {
                            menu.textContent = t('editor.noCommandsFound');
                            return;
                        }
                        current.items.forEach((c: Command, i: number) => {
                            const b = document.createElement('button');
                            b.type = 'button';
                            b.className = i === active ? 'active' : '';
                            b.textContent = `${c.icon}  ${t(c.label)}`;
                            b.onpointerdown = e => e.preventDefault();
                            b.onclick = () => current.command(c);
                            menu.append(b);
                        });
                        menu.children[active]?.scrollIntoView({block: 'nearest'});
                    };
                    const position = () => {
                        const rect = current.clientRect?.();
                        if (!rect) return;
                        computePosition({getBoundingClientRect: () => rect}, menu, {
                            strategy: 'fixed',
                            placement: 'bottom-start',
                            middleware: [offset(8), flip(), shift({padding: 10})]
                        }).then(({x, y}) => {
                            Object.assign(menu.style, {left: `${x}px`, top: `${y}px`});
                        });
                    };
                    return {
                        onStart: props => {
                            current = props;
                            menu = document.createElement('div');
                            menu.className = 'slash-menu';
                            menu.setAttribute('aria-label', t('editor.quickInsert'));
                            document.body.append(menu);
                            draw();
                            position();
                            cleanup = autoUpdate(props.editor.view.dom, menu, position);
                        }, onUpdate: props => {
                            current = props;
                            active = 0;
                            draw();
                            position();
                        }, onKeyDown: ({event}) => {
                            if (event.isComposing) return false;
                            if (event.key === 'Escape') {
                                menu.style.display = 'none';
                                return true;
                            }
                            if (menu.style.display === 'none') return false;
                            if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
                                active = (active + (event.key === 'ArrowDown' ? 1 : -1) + current.items.length) % Math.max(current.items.length, 1);
                                draw();
                                return true;
                            }
                            if (event.key === 'Enter') {
                                if (current.items[active]) current.command(current.items[active]);
                                return true;
                            }
                            return false;
                        }, onExit: () => {
                            cleanup?.();
                            menu?.remove();
                        }
                    };
                }
            })];
        }
    });
}

export function FormatTools({editor, insert, compact = false}: {
    editor: Editor;
    insert: (kind: string) => void;
    compact?: boolean
}) {
    useLanguage();
    const [, update] = useState(0);
    useEffect(() => {
        const fn = () => update(v => v + 1);
        editor.on('transaction', fn);
        return () => {
            editor.off('transaction', fn);
        };
    }, [editor]);
    if (editor.isActive('image')) return <div className="format-tools object-format" role="toolbar"
                                              aria-label={t('editor.formatting')} onMouseDown={e => {
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) e.preventDefault();
    }}>
        <span>{t('media.image')}</span><label>{t('image.width')}<select aria-label={t('editor.imageWidth')}
                                                                        value={editor.getAttributes('image').width || 100}
                                                                        onChange={e => editor.chain().focus().updateAttributes('image', {width: +e.target.value}).run()}>{[25, 50, 75, 100].map(v =>
        <option key={v} value={v}>{v}%</option>)}</select></label>
        {[["left", t('editor.left')], ["center", t('editor.center')], ["right", t('editor.right')]].map(([value, label]) =>
            <button key={value} aria-pressed={editor.getAttributes('image').alignment === value}
                    onClick={() => editor.chain().focus().updateAttributes('image', {alignment: value}).run()}>{label}</button>)}
        <button onClick={() => insert('image-description')}>{t('editor.description')}</button>
        <button aria-label={t('editor.deleteImage')} onClick={() => editor.chain().focus().deleteSelection().run()}>
            <Trash2 size={17}/></button>
    </div>;
    const blocks: [string, TranslationKey, () => void][] = [['paragraph', 'editor.blocks.paragraph', () => editor.chain().focus().clearNodes().setParagraph().run()], ['heading2', 'editor.blocks.heading2', () => editor.chain().focus().setHeading({level: 2}).run()], ['heading3', 'editor.blocks.heading3', () => editor.chain().focus().setHeading({level: 3}).run()], ['blockquote', 'editor.blocks.quote', () => {
        if (!editor.isActive('blockquote')) editor.chain().focus().setBlockquote().run();
    }], ['codeBlock', 'editor.blocks.code', () => editor.chain().focus().setCodeBlock().run()]];
    const active = (key: string) => key === 'paragraph' ? editor.isActive('paragraph') && !editor.isActive('blockquote') : key === 'heading2' ? editor.isActive('heading', {level: 2}) : key === 'heading3' ? editor.isActive('heading', {level: 3}) : editor.isActive(key);
    const close = (e: React.MouseEvent) => {
        (e.currentTarget.closest('details') as HTMLDetailsElement)?.removeAttribute('open');
    };
    return <div className={`format-tools ${compact ? 'compact' : ''}`} role="toolbar"
                aria-label={compact ? t('editor.selectionFormatting') : t('editor.formatting')} onMouseDown={e => {
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) e.preventDefault();
    }}>
        <details>
            <summary
                aria-label={t('editor.blockType')}>{t(blocks.find(b => active(b[0]))?.[1] || 'editor.blocks.paragraph')}<ChevronDown
                size={13}/></summary>
            <div className="popup block-menu">{blocks.map(([key, label, run]) => <button key={key}
                                                                                         aria-pressed={active(key)}
                                                                                         onClick={e => {
                                                                                             run();
                                                                                             close(e);
                                                                                         }}>{t(label)}<span>{active(key) ? '✓' : ''}</span>
            </button>)}</div>
        </details>
        <i/>
        {[[Bold, t('editor.boldShortcut'), 'bold', () => editor.chain().focus().toggleBold().run()], [Italic, t('editor.italicShortcut'), 'italic', () => editor.chain().focus().toggleItalic().run()], [Underline, t('editor.underlineShortcut'), 'underline', () => editor.chain().focus().toggleUnderline().run()], [Strikethrough, t('editor.strikethrough'), 'strike', () => editor.chain().focus().toggleStrike().run()]].map(([Icon, label, key, run]) => {
            const I = Icon as typeof Bold;
            return <button key={String(key)} title={String(label)} aria-label={String(label)}
                           aria-pressed={editor.isActive(String(key))} onClick={run as () => void}><I size={17}/>
            </button>;
        })}
        <button title={t('editor.bulletListShortcut')} aria-label={t('editor.blocks.bulletList')}
                aria-pressed={editor.isActive('bulletList')}
                onClick={() => editor.chain().focus().toggleBulletList().run()}><List size={17}/></button>
        <button title={t('editor.orderedListShortcut')} aria-label={t('editor.blocks.orderedList')}
                aria-pressed={editor.isActive('orderedList')}
                onClick={() => editor.chain().focus().toggleOrderedList().run()}><ListOrdered size={17}/></button>
        <i/>
        <button title={t('editor.linkShortcut')} aria-label={t('editor.link')} aria-pressed={editor.isActive('link')}
                onClick={() => insert('link')}><Link size={17}/></button>
        <details>
            <summary aria-label={t('editor.alignment')}><AlignLeft size={17}/><ChevronDown size={12}/></summary>
            <div
                className="popup">{[['left', t('editor.alignLeft')], ['center', t('editor.center')], ['right', t('editor.alignRight')]].map(([v, label]) =>
                <button key={v} aria-pressed={editor.isActive({textAlign: v})} onClick={e => {
                    editor.chain().focus().setTextAlign(v).run();
                    close(e);
                }}>{label}{editor.isActive({textAlign: v}) ? ' ✓' : ''}</button>)}</div>
        </details>
        <button aria-label={t('editor.inlineCode')} title={t('editor.inlineCode')}
                aria-pressed={editor.isActive('code')}
                onClick={() => editor.chain().focus().toggleCode().run()}><Code size={17}/></button>
        <details>
            <summary aria-label={t('editor.textColor')}><Palette size={17}/><ChevronDown size={12}/></summary>
            <div className="popup palette">
                <button
                    onClick={() => editor.chain().focus().unsetColor().unsetHighlight().run()}>{t('editor.resetColor')}</button>
                <div>{['var(--ink-red)', 'var(--ink-ochre)', 'var(--ink-green)', 'var(--ink-teal)', 'var(--ink-blue)', 'var(--ink-purple)'].map((c, i) =>
                    <button key={c}
                            aria-label={t('editor.colorName', {name: [t('editor.red'), t('editor.ochre'), t('editor.green'), t('editor.teal'), t('editor.blue'), t('editor.purple')][i]})}
                            style={{background: c}}
                            onClick={() => editor.chain().focus().setColor(c).run()}/>)}</div>
                <button aria-pressed={editor.isActive('highlight')}
                        onClick={() => editor.chain().focus().toggleHighlight({color: 'var(--highlight)'}).run()}>{t('editor.highlight')}</button>
            </div>
        </details>
        <button aria-label={t('editor.blocks.quote')} title={t('editor.blocks.quote')}
                aria-pressed={editor.isActive('blockquote')}
                onClick={() => editor.chain().focus().toggleBlockquote().run()}><Quote size={17}/></button>
        <details>
            <summary aria-label={t('common.textSize')}>{t('editor.fontSizeSymbol')}<ChevronDown size={12}/></summary>
            <div className="popup">
                <button onClick={() => editor.chain().focus().unsetFontSize().run()}>{t('editor.defaultSize')}</button>
                {[14, 16, 18, 20, 24, 28, 32].map(size => <button key={size}
                                                                  aria-pressed={editor.getAttributes('textStyle').fontSize === `${size}px`}
                                                                  onClick={event => {
                                                                      editor.chain().focus().setFontSize(`${size}px`).run();
                                                                      close(event);
                                                                  }}>{size} px</button>)}</div>
        </details>
        {compact && <details>
            <summary aria-label={t('editor.insertBlock')}><Plus size={17}/></summary>
            <div
                className="popup">{([['table', 'editor.blocks.table'], ['note', 'editor.blocks.noteLink'], ['library', 'attachments.insertFromLibrary'], ['media', 'editor.insertMedia']] as const).map(([kind, label]) =>
                <button key={kind} onClick={event => {
                    close(event);
                    insert(kind);
                }}>{t(label)}</button>)}</div>
        </details>}
        {!compact && <><i/>
            <button aria-label={t('editor.undoShortcut')} title={t('editor.undoShortcut')}
                    disabled={!editor.can().undo()}
                    onClick={() => editor.chain().focus().undo().run()}><Undo2 size={17}/></button>
            <button aria-label={t('editor.redoShortcut')} title={t('editor.redoShortcut')}
                    disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2
                size={17}/></button>
        </>}
    </div>;
}

function LineInsert({editor, insert}: { editor: Editor; insert: (kind: string) => void }) {
    const anchor = useRef<HTMLDetailsElement>(null);
    const [top, setTop] = useState<number | null>(null);
    useLayoutEffect(() => {
        const position = () => {
            const {selection} = editor.state;
            if (!selection.empty || !selection.$from.parent.isTextblock || selection.$from.parent.content.size !== 0) {
                if (anchor.current) anchor.current.open = false;
                setTop(null);
                return;
            }
            const root = anchor.current?.parentElement;
            if (!root || !editor.view.dom.isConnected) return;
            const rect = editor.view.coordsAtPos(selection.from);
            setTop(rect.top - root.getBoundingClientRect().top + (rect.bottom - rect.top) / 2);
        };
        editor.on('transaction', position);
        let frame = 0;
        const observer = new ResizeObserver(() => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(position);
        });
        observer.observe(editor.view.dom);
        window.addEventListener('resize', position);
        position();
        return () => {
            editor.off('transaction', position);
            observer.disconnect();
            cancelAnimationFrame(frame);
            window.removeEventListener('resize', position);
        };
    }, [editor]);
    const commands = [
        ['callout', t('editor.blocks.callout'), <MessageSquareWarning size={22}/>],
        ['rule', t('editor.blocks.divider'), <Minus size={22}/>], ['toc', t('editor.blocks.toc'),
            <ListTree size={22}/>],
        ['image', t('media.image'), <ImageIcon size={22}/>], ['tag', t('editor.blocks.hashtag'), <Hash size={22}/>],
        ['table', t('editor.blocks.table'), <Table2 size={22}/>], ['note', t('editor.blocks.noteLinkCommand'),
            <Link size={22}/>],
        ['media', 'YouTube / Spotify', <Music2 size={22}/>], ['embed', t('media.embed'), <Code size={22}/>],
        ['library', t('attachments.insertFromLibrary'), <Paperclip size={22}/>]
    ] as const;
    return <details ref={anchor} className="line-insert"
                    style={{top: top ?? 0, visibility: top === null ? 'hidden' : undefined}}>
        <summary aria-label={t('editor.insertBlock')} title={t('editor.insertBlock')}
                 onMouseDown={event => event.preventDefault()}><Plus size={22}/></summary>
        <div className="popup line-insert-menu">{commands.map(([kind, label, icon]) =>
            <button key={kind} onClick={() => {
                if (anchor.current) anchor.current.open = false;
                insert(kind);
            }}><span aria-hidden="true">{icon}</span>{label}</button>)}</div>
    </details>;
}

export default function NoteEditor({note, workspace, update, readOnly, register, attach}: {
    note: Note;
    workspace: Workspace;
    update: (patch: Partial<Note>) => void;
    readOnly: boolean;
    register: (editor: Editor | null, insert: (kind: string) => void) => void;
    attach: (file: File) => Promise<string>
}) {
    const language = useLanguage();
    const [dialog, setDialog] = useState<string | null>(null);
    const [value, setValue] = useState('');
    const [error, setError] = useState<DisplayError>('');
    const [bubbleDismissed, setBubbleDismissed] = useState(false);
    const [pending, setPending] = useState<{ from: number; to: number } | null>(null);
    const workspaceRef = useRef(workspace);
    workspaceRef.current = workspace;
    const editorRef = useRef<Editor | null>(null);
    const titleRef = useRef<HTMLTextAreaElement | null>(null);
    const titleSelection = useRef<{ anchor: Y.RelativePosition; head: Y.RelativePosition } | null>(null);
    const titleComposing = useRef(false);
    useEffect(() => {
        const el = titleRef.current;
        if (!el) return;
        const resize = () => {
            el.style.height = 'auto';
            el.style.height = `${el.scrollHeight}px`;
        };
        let width = 0, frame = 0;
        const observer = new ResizeObserver(([entry]) => {
            if (entry.contentRect.width === width) return;
            width = entry.contentRect.width;
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(resize);
        });
        observer.observe(el.parentElement!);
        resize();
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
        };
    }, [note.id]);
    const upload = useRef<HTMLInputElement>(null);
    const insertRef = useRef<(k: string) => void>(() => {
    });
    const extensions = [NoteDropPreview, StarterKit.configure({
        undoRedo: false,
        heading: {levels: [2, 3]},
        link: {openOnClick: false, autolink: true}
    }), Placeholder.configure({placeholder: t('editor.placeholder')}), TextAlign.configure({types: ['heading', 'paragraph']}), TextStyle, Color, FontSize, Highlight.configure({multicolor: true}), EditorImage.configure({allowBase64: true}), Table.configure({resizable: true}), TableRow, TableCell, TableHeader, TaskList, TaskItem.configure({nested: true}), MediaNode, AttachmentNode, Callout, Toc, NoteLink,
        Hashtag, slashExtension([
            {
                label: 'editor.blocks.heading2',
                icon: 'H₂',
                run: e => e.chain().focus().setHeading({level: 2}).run()
            }, {label: 'editor.blocks.heading3', icon: 'H₃', run: e => e.chain().focus().setHeading({level: 3}).run()},
            {
                label: 'editor.blocks.bulletList',
                icon: '•',
                run: e => e.chain().focus().toggleBulletList().run()
            }, {
                label: 'editor.blocks.orderedList',
                icon: '1.',
                run: e => e.chain().focus().toggleOrderedList().run()
            }, {label: 'editor.blocks.checklist', icon: '☑', run: e => e.chain().focus().toggleTaskList().run()}, {
                label: 'editor.blocks.quote',
                icon: '❞',
                run: e => e.chain().focus().toggleBlockquote().run()
            }, {label: 'editor.blocks.code', icon: '<>', run: e => e.chain().focus().toggleCodeBlock().run()},
            ...([['callout', 'editor.blocks.callout', '!'], ['rule', 'editor.blocks.divider', '―'], ['toc', 'editor.blocks.toc', '≡'], ['image', 'media.image', '▧'], ['tag', 'editor.blocks.hashtag', '#'], ['table', 'editor.blocks.table', '▦'], ['note', 'editor.blocks.noteLinkCommand', '↗'], ['media', 'media.youtube', '▶'], ['media', 'media.spotify', '♫'], ['embed', 'media.embed', '<>'], ['library', 'attachments.insertFromLibrary', '▧']] as const).map(([kind, label, icon]) => ({
                label,
                icon,
                run: () => insertRef.current(kind)
            }))
        ])];
    const collaboration = useNoteCollaboration(note, extensions, workspace.profile, update);
    const rememberTitleSelection = (start: number, end: number) => {
        const title = collaboration.session.doc.getText('title');
        titleSelection.current = {
            anchor: Y.createRelativePositionFromTypeIndex(title, start),
            head: Y.createRelativePositionFromTypeIndex(title, end)
        };
    };
    useLayoutEffect(() => {
        const input = titleRef.current, selection = titleSelection.current;
        if (!input || input !== document.activeElement || !selection || titleComposing.current) return;
        const start = Y.createAbsolutePositionFromRelativePosition(selection.anchor, collaboration.session.doc),
            end = Y.createAbsolutePositionFromRelativePosition(selection.head, collaboration.session.doc);
        if (start && end) input.setSelectionRange(start.index, end.index);
    }, [note.title, collaboration.session]);
    const editor = useEditor({
        extensions: [...extensions, Collaboration.configure({
            document: collaboration.session.doc,
            field: 'content'
        }), CollaborationCaret.configure({
            provider: {awareness: collaboration.session.awareness},
            user: {...identity(workspace.profile, collaboration.session.doc.clientID), ...(collaboration.session.awareness.getLocalState()?.user?.color ? {color: collaboration.session.awareness.getLocalState()!.user.color} : {})}
        })],
        editable: !readOnly,
        enableInputRules: workspace.markdown,
        enablePasteRules: workspace.markdown,
        editorProps: {
            attributes: {class: 'document-body', 'aria-label': t('editor.content')},
            handleDOMEvents: {
                dragover: (view, event) => {
                    if (isFolderDrag(event.dataTransfer)) {
                        event.preventDefault();
                        event.dataTransfer!.dropEffect = 'none';
                        setNoteDropPreview(view, null);
                        return true;
                    }
                    if (!isNoteDrag(event.dataTransfer) || !view.editable) return false;
                    event.preventDefault();
                    event.dataTransfer!.dropEffect = 'copy';
                    const source = draggedNote(event.dataTransfer, workspaceRef.current);
                    const position = view.posAtCoords({left: event.clientX, top: event.clientY});
                    setNoteDropPreview(view, source && source.id !== note.id && position
                        ? {pos: position.pos, label: source.title || t('notes.untitled')} : null);
                    return true;
                },
                dragleave: (view, event) => {
                    if (!(event.relatedTarget instanceof globalThis.Node) || !view.dom.contains(event.relatedTarget))
                        setNoteDropPreview(view, null);
                    return false;
                }
            },
            handleDrop: (view, event) => {
                setNoteDropPreview(view, null);
                if (isFolderDrag(event.dataTransfer)) {
                    event.preventDefault();
                    return true;
                }
                if (!isNoteDrag(event.dataTransfer)) return false;
                event.preventDefault();
                const source = draggedNote(event.dataTransfer, workspaceRef.current);
                if (!view.editable || !source || source.id === note.id) return true;
                const position = view.posAtCoords({left: event.clientX, top: event.clientY});
                if (position) editorRef.current?.chain().focus().insertContentAt(position.pos, {
                    type: 'noteLink', attrs: {noteId: source.id, label: source.title || t('notes.untitled')}
                }).run();
                return true;
            },
            handlePaste: (view, event) => {
                const text = event.clipboardData?.getData('text/plain')?.trim();
                if (text && parseMedia(text) && !view.composing && !editorRef.current?.isActive('codeBlock')) {
                    event.preventDefault();
                    setPending({from: view.state.selection.from, to: view.state.selection.to});
                    setValue(text);
                    setDialog('media');
                    return true;
                }
                return false;
            },
            handleKeyDown: (view, event) => {
                if (event.isComposing) return false;
                if (event.ctrlKey && !event.altKey && (event.key === 'Home' || event.key === 'End')) {
                    const edge = TextSelection.atStart(view.state.doc);
                    const target = event.key === 'Home' ? edge : TextSelection.atEnd(view.state.doc);
                    const selection = event.shiftKey ? TextSelection.between(view.state.selection.$anchor, target.$head) : target;
                    view.dispatch(view.state.tr.setSelection(selection).scrollIntoView());
                    return true;
                }
                if (event.key === 'Escape') {
                    setBubbleDismissed(true);
                    view.dispatch(view.state.tr.setMeta('selectionBubble', 'hide'));
                    document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
                    event.preventDefault();
                    insertRef.current('link');
                    return true;
                }
                return false;
            }
        },
        onSelectionUpdate: () => setBubbleDismissed(false)
    }, [note.id, workspace.markdown, language, collaboration.session]);
    editorRef.current = editor;
    const insert = (kind: string) => {
        const e = editorRef.current;
        if (!e) return;
        setError('');
        setPending(null);
        if (kind === 'tag') {
            e.chain().focus().insertContent('#').run();
            return;
        }
        if (kind === 'h2' || kind === 'h3') {
            e.chain().focus().setHeading({level: kind === 'h2' ? 2 : 3}).run();
            return;
        }
        if (kind === 'bullets') {
            e.chain().focus().toggleBulletList().run();
            return;
        }
        if (kind === 'numbers') {
            e.chain().focus().toggleOrderedList().run();
            return;
        }
        if (kind === 'checklist') {
            e.chain().focus().toggleTaskList().run();
            return;
        }
        if (kind === 'quote') {
            e.chain().focus().toggleBlockquote().run();
            return;
        }
        if (kind === 'code') {
            e.chain().focus().toggleCodeBlock().run();
            return;
        }
        if (kind === 'image-description') {
            setValue(e.getAttributes('image').alt || '');
            setDialog(kind);
            return;
        }
        if (kind === 'image') {
            upload.current?.click();
            return;
        }
        if (kind === 'table') {
            e.chain().focus().insertTable({rows: 3, cols: 3, withHeaderRow: true}).run();
            return;
        }
        if (kind === 'callout') {
            e.chain().focus().insertContent({type: 'callout', content: [{type: 'paragraph'}]}).run();
            return;
        }
        if (kind === 'toc') {
            e.chain().focus().insertContent({type: 'toc'}).run();
            return;
        }
        if (kind === 'rule') {
            e.chain().focus().setHorizontalRule().run();
            return;
        }
        setValue(kind === 'link' ? e.getAttributes('link').href || '' : '');
        setDialog(kind);
    };
    insertRef.current = insert;
    useEffect(() => {
        editor?.setEditable(!readOnly);
    }, [editor, readOnly]);
    useEffect(() => {
        register(editor, (kind) => insertRef.current(kind));
        return () => register(null, () => {
        });
    }, [editor]);
    useEffect(() => {
        const vv = window.visualViewport;
        const update = () => document.documentElement.style.setProperty('--keyboard-inset', `${Math.max(0, window.innerHeight - (vv?.height || window.innerHeight) - (vv?.offsetTop || 0))}px`);
        vv?.addEventListener('resize', update);
        update();
        return () => vv?.removeEventListener('resize', update);
    }, []);
    const apply = (asLink = false) => {
        if (!editor) return;
        setError('');
        if (dialog === 'image-description') {
            editor.chain().focus().updateAttributes('image', {alt: value}).run();
            setDialog(null);
            return;
        }
        if (dialog === 'link') {
            if (!value) {
                editor.chain().focus().unsetLink().run();
                setDialog(null);
                return;
            }
            try {
                const u = new URL(value);
                if (!['https:', 'http:', 'mailto:'].includes(u.protocol)) throw Error();
                editor.chain().focus().extendMarkRange('link').setLink({href: value}).run();
            } catch {
                setError('errors.linkProtocol');
                return;
            }
        } else {
            const m = parseMedia(value);
            if (!m) {
                setError('media.supportedSourcesDescription');
                return;
            }
            const c = editor.chain().focus();
            if (pending) c.setTextSelection(pending).deleteSelection();
            if (asLink) c.insertContent({
                type: 'text',
                text: value,
                marks: [{type: 'link', attrs: {href: m.canonicalUrl}}]
            }).run(); else if (!pending && editor.state.selection instanceof NodeSelection) {
                c.insertContentAt(editor.state.selection.to, {type: 'media', attrs: m}).run();
            } else c.insertContent({type: 'media', attrs: m}).run();
        }
        setDialog(null);
        setPending(null);
    };
    return <>
        <article className={`document ${readOnly ? 'reading' : ''}`}>
            <CollaborationStatus channel={collaboration.channel} awareness={collaboration.session.awareness}/>
            <textarea className="note-title" rows={1} aria-label={t('editor.title')} placeholder={t('notes.untitled')}
                      value={note.title} readOnly={readOnly}
                      onChange={e => {
                          collaboration.setTitle(e.target.value);
                          rememberTitleSelection(e.target.selectionStart, e.target.selectionEnd);
                      }}
                      onCompositionStart={() => {
                          titleComposing.current = true;
                      }} onCompositionEnd={event => {
                titleComposing.current = false;
                rememberTitleSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
            }}
                      onSelect={event => rememberTitleSelection(event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
                      ref={el => {
                          titleRef.current = el;
                          if (el) {
                              el.style.height = 'auto';
                              el.style.height = `${el.scrollHeight}px`;
                          }
                      }}/>
            {editor && <>{!readOnly &&
                <BubbleMenu className="bubble-shell" appendTo={() => document.body} pluginKey="selectionBubble"
                            editor={editor} options={{
                    placement: 'top',
                    strategy: 'fixed',
                    offset: 10,
                    flip: {padding: 10, boundary: document.querySelector<HTMLElement>('.document-scroll') || undefined},
                    shift: {
                        padding: 10,
                        boundary: document.querySelector<HTMLElement>('.document-scroll') || undefined
                    },
                    scrollTarget: document.querySelector<HTMLElement>('.document-scroll') || window
                }} shouldShow={({
                                    editor,
                                    state
                                }) => !bubbleDismissed && editor.isEditable && (editor.isFocused || !!document.activeElement?.closest('.compact')) && !state.selection.empty && state.doc.textBetween(state.selection.from, state.selection.to, ' ').trim().length > 0}><FormatTools
                    editor={editor} insert={insert} compact/></BubbleMenu>}
                <div className="note-content"><EditorContent editor={editor}/>{!readOnly &&
                    <LineInsert editor={editor} insert={insert}/>}</div>
            </>}
        </article>
        <input ref={upload} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={async e => {
            const f = e.target.files?.[0];
            if (f) {
                try {
                    const src = await attach(f);
                    editor?.chain().focus().setImage({src, alt: f.name}).run();
                } catch (err) {
                    setError(toError(err));
                    setDialog('error');
                }
            }
            e.target.value = '';
        }}/>
        {editor?.isActive('table') && !readOnly && <div className="table-tools">
            <button onClick={() => editor.chain().focus().addRowAfter().run()}>{t('editor.row')}</button>
            <button onClick={() => editor.chain().focus().addColumnAfter().run()}>{t('editor.column')}</button>
            <button onClick={() => editor.chain().focus().deleteRow().run()}>{t('editor.deleteRow')}</button>
            <button onClick={() => editor.chain().focus().deleteTable().run()}>{t('editor.deleteTable')}</button>
        </div>}
        {dialog === 'library' ?
            <AttachmentPicker attachments={workspace.attachments} close={() => setDialog(null)} choose={attachment => {
                const e = editorRef.current;
                if (!e) return;
                const content = /^image\/(png|jpeg|gif|webp)$/.test(attachment.mime) ? {
                    type: 'image',
                    attrs: {src: attachment.data, alt: attachment.name}
                } : {type: 'attachment', attrs: {attachmentId: attachment.id, ...attachment}};
                const chain = e.chain().focus();
                if (e.state.selection instanceof NodeSelection) chain.insertContentAt(e.state.selection.to, content).run(); else chain.insertContent(content).run();
                setDialog(null);
            }}/> : dialog && <Modal
            title={dialog === 'note' ? t('editor.blocks.noteLink') : dialog === 'image-description' ? t('editor.imageDescription') : dialog === 'link' ? t('editor.hyperlink') : dialog === 'error' ? t('editor.error') : t('editor.insertMedia')}
            close={() => setDialog(null)}>
            {dialog === 'note' ?
                <NoteLinkPicker workspace={workspace} currentNoteId={note.id} choose={n => {
                    editor?.chain().focus().insertContent({
                        type: 'noteLink',
                        attrs: {noteId: n.id, label: n.title || t('notes.untitled')}
                    }).run();
                    setDialog(null);
                }}/> : dialog !== 'error' && <form onSubmit={e => {
                e.preventDefault();
                apply();
            }}>
                <label>{dialog === 'image-description' ? t('editor.description') : 'URL'}<input
                    autoFocus value={value}
                    onChange={e => setValue(e.target.value)}
                    placeholder="https://"/></label>{dialog === 'embed' &&
                <p>{t('media.allowedSources')}</p>}
                <footer>{dialog === 'link' && <button type="button" onClick={() => {
                    editor?.chain().focus().unsetLink().run();
                    setDialog(null);
                }}>{t('editor.removeLink')}</button>}{!['link', 'image-description'].includes(dialog) &&
                    <button type="button" onClick={() => apply(true)}>{t('editor.keepAsLink')}</button>}
                    <button className="primary"
                            type="submit">{['link', 'image-description'].includes(dialog) ? t('editor.apply') : t('editor.insertPlayer')}</button>
                </footer>
            </form>}{error && <p role="alert" className="error">{errorText(error)}</p>}
        </Modal>}</>;
}
