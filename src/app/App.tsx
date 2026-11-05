import {draggedFolder, endFolderDrag, isFolderDrag, startFolderDrag} from '../library/folder-drag';
import {draggedNote, endNoteDrag, folderNotes, isNoteDrag, moveNote, startNoteDrag} from '../library/note-drag';
import UpdateNotice from '../updates/UpdateNotice';
import SettingsPage from '../settings/SettingsPage';
import {
    type DisplayError,
    errorText,
    isLanguage,
    locales,
    LocalizedError,
    setLanguage,
    supportedLanguages,
    t,
    toError,
    type TranslationKey,
    useLanguage
} from '../locales/i18n';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {Editor} from '@tiptap/react';
import {
    AlertCircle,
    BookOpen,
    Check,
    ChevronDown,
    ChevronRight,
    Download,
    Files,
    FileText,
    Folder,
    Moon,
    MoreHorizontal,
    PanelLeftClose,
    PanelLeftOpen,
    PanelsTopLeft,
    Paperclip,
    Pencil,
    Plus,
    Search,
    Settings,
    Sun,
    Upload
} from 'lucide-react';
import {checkpoint, download, downloadAttachment, loadWorkspace, saveWorkspace} from '../storage/storage';
import {flushSyncSettings} from '../sync/sync-cache';
import {emptyDoc, type Note, textOf, uid, validateWorkspace, type Workspace} from '../storage/model';
import NoteEditor, {FormatTools} from '../editor/Editor';
import Canvas from '../canvas/Canvas';
import {Modal, TreeActions} from '../ui/ui';
import {usePopovers} from '../ui/usePopovers';
import {useWorkspaceSync} from '../sync/SyncSettings';
import {exportNoteHtml} from '../storage/export';
import {folderChildren, folderDescendants, moveFolder, removeFolder} from '../library/folders';
import {RealtimeContext} from '../sync/realtime';
import {AttachmentContext, prepareAttachment, renameAttachment, splitFilename} from '../media/attachments';
import {hashtagsIn, matchesHashtag} from '../editor/hashtags';

type Section = 'notes' | 'boards' | 'search' | 'attachments' | 'settings';
type Navigation = { section: Section; active: string; boardId: string; query: string; read: boolean };
const defaultNavigation: Navigation = {section: 'notes', active: '', boardId: '', query: '', read: false};

function loadNavigation(): Navigation {
    try {
        const saved = JSON.parse(localStorage.getItem('typealot.navigation') || 'null');
        if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultNavigation;
        return {
            section: ['notes', 'boards', 'search', 'attachments', 'settings'].includes(saved.section) ? saved.section : 'notes',
            active: typeof saved.active === 'string' ? saved.active : '',
            boardId: typeof saved.boardId === 'string' ? saved.boardId : '',
            query: typeof saved.query === 'string' ? saved.query : '',
            read: saved.read === true
        };
    } catch {
        return defaultNavigation;
    }
}

export default function App() {
    const language = useLanguage();
    usePopovers();
    const [w, setW] = useState<Workspace | null>(null);
    const sync = useWorkspaceSync(w, setW);
    const [dropTarget, setDropTarget] = useState<{
        id: string;
        edge: string;
        kind: 'note' | 'folder';
        label: string;
        left: number;
        top: number
    } | null>(null);
    const [savedNavigation] = useState(loadNavigation);
    const [section, setSection] = useState<Section>(savedNavigation.section);
    const [active, setActive] = useState(savedNavigation.active);
    const [boardId, setBoardId] = useState(savedNavigation.boardId);
    const [read, setRead] = useState(savedNavigation.read);
    const [status, setStatus] = useState<TranslationKey>('storage.loading');
    const [saveError, setSaveError] = useState<DisplayError>('');
    const [loadError, setLoadError] = useState<DisplayError>('');
    const [query, setQuery] = useState(savedNavigation.query);
    const [mobileOpen, setMobileOpen] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(() => {
        try {
            const saved: unknown = JSON.parse(localStorage.getItem('typealot.collapsedFolders') || '[]');
            return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
        } catch {
            return new Set();
        }
    });
    useEffect(() => {
        try {
            localStorage.setItem('typealot.collapsedFolders', JSON.stringify([...collapsed]));
        } catch {
            // Folder navigation remains usable when local storage is unavailable.
        }
    }, [collapsed]);
    const [editor, setEditor] = useState<Editor | null>(null);
    const insert = useRef<(kind: string) => void>(() => {
    });
    const [dialog, setDialog] = useState<string | null>(null);
    const [value, setValue] = useState('');
    const [attachmentId, setAttachmentId] = useState('');
    const [actionNoteId, setActionNoteId] = useState('');
    const [renameError, setRenameError] = useState<DisplayError>('');
    const [parent, setParent] = useState<string | null>(null);
    const upload = useRef<HTMLInputElement>(null);
    const importInput = useRef<HTMLInputElement>(null);
    const latest = useRef(w);
    latest.current = w;
    const [notice, setNotice] = useState<DisplayError>('');
    const serial = useRef(Promise.resolve());
    useEffect(() => window.typealotDesktop?.onBeforeClose(async () => {
        if (!latest.current) return;
        const snapshot = latest.current;
        serial.current = serial.current.catch(() => {
        }).then(() => saveWorkspace(snapshot));
        await serial.current;
        await flushSyncSettings();
    }), []);
    useEffect(() => {
        const show = (event: Event) => {
            setNotice((event as CustomEvent<string>).detail);
            setDialog('notice');
        };
        window.addEventListener('typealot:error', show);
        return () => window.removeEventListener('typealot:error', show);
    }, []);
    useEffect(() => {
        loadWorkspace().then(v => {
            setW(v);
            setActive(v.notes.some(n => n.id === savedNavigation.active) ? savedNavigation.active : v.notes[0]?.id || '');
            setBoardId(v.boards.some(b => b.id === savedNavigation.boardId) ? savedNavigation.boardId : v.boards[0]?.id || '');
            if (location.hash.startsWith('#note/')) {
                try {
                    const id = decodeURIComponent(location.hash.slice(6));
                    if (v.notes.some(n => n.id === id)) {
                        setActive(id);
                        setSection('notes');
                    }
                } catch { /* Ignore malformed fragment URLs. */
                }
            }
            setStatus('storage.saving');
        }).catch(e => setLoadError(toError(e)));
    }, []);
    useEffect(() => {
        if (!w) return;
        // Discard an old deep link when navigation moves away from its destination.
        let matches = true;
        try {
            if (location.hash.startsWith('#note/')) matches = section === 'notes' && decodeURIComponent(location.hash.slice(6)) === active;
            if (location.hash.startsWith('#tag/')) matches = section === 'search' && `#${decodeURIComponent(location.hash.slice(5))}` === query;
        } catch {
            matches = false;
        }
        if (!matches) history.replaceState(history.state, '', location.pathname + location.search);
        try {
            localStorage.setItem('typealot.navigation', JSON.stringify({section, active, boardId, query, read}));
        } catch {
            // Navigation remains usable when local storage is unavailable.
        }
    }, [w, section, active, boardId, query, read]);
    useEffect(() => {
        if (!w) return;
        document.documentElement.dataset.theme = w.theme;
        setStatus('storage.saving');
        const timer = setTimeout(() => {
            const snapshot = w;
            serial.current = serial.current.catch(() => {
            }).then(() => saveWorkspace(snapshot)).then(() => {
                if (latest.current === snapshot) {
                    setStatus('storage.saved');
                    setSaveError('');
                }
            }).catch(e => {
                setStatus('storage.saveFailed');
                setSaveError(toError(e));
            });
        }, 350);
        return () => clearTimeout(timer);
    }, [w]);
    useEffect(() => {
        const flush = () => {
            if (latest.current) {
                const snapshot = latest.current;
                serial.current = serial.current.catch(() => {
                }).then(() => saveWorkspace(snapshot));
            }
        };
        const change = () => {
            if (document.visibilityState === 'hidden') flush();
        };
        document.addEventListener('visibilitychange', change);
        window.addEventListener('pagehide', flush);
        return () => {
            document.removeEventListener('visibilitychange', change);
            window.removeEventListener('pagehide', flush);
        };
    }, []);
    useEffect(() => {
        const fn = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
                e.preventDefault();
                setW(w => w ? {...w, sidebar: !w.sidebar} : w);
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                if (latest.current) {
                    const snapshot = latest.current;
                    serial.current = serial.current.catch(() => {
                    }).then(() => saveWorkspace(snapshot)).then(() => {
                        if (latest.current === snapshot) {
                            setStatus('storage.saved');
                            setSaveError('');
                        }
                    }).catch(err => {
                        setStatus('storage.saveFailed');
                        setSaveError(toError(err));
                    });
                }
            }
            if (e.key === 'Escape' && !e.defaultPrevented) {
                setMobileOpen(false);
                setDialog(null);
                document.querySelectorAll('details[open]').forEach(d => d.removeAttribute('open'));
            }
        };
        window.addEventListener('keydown', fn);
        return () => window.removeEventListener('keydown', fn);
    }, []);
    useEffect(() => {
        const hash = () => {
            if (location.hash.startsWith('#tag/')) {
                try {
                    setQuery(`#${decodeURIComponent(location.hash.slice(5))}`);
                    setSection('search');
                    setMobileOpen(false);
                } catch { /* Ignore malformed fragment URLs. */
                }
                return;
            }
            if (location.hash.startsWith('#note/')) {
                try {
                    const id = decodeURIComponent(location.hash.slice(6));
                    if (latest.current?.notes.some(n => n.id === id)) {
                        setActive(id);
                        setSection('notes');
                        setMobileOpen(false);
                    }
                } catch { /* Ignore malformed fragment URLs. */
                }
            }
        };
        const followTag = (event: MouseEvent) => {
            const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[data-hashtag]') : null;
            if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            location.hash = link.hash;
            hash();
        };
        const activateTag = (event: KeyboardEvent) => {
            if (event.key === 'Enter' && event.target instanceof HTMLAnchorElement && event.target.hasAttribute('data-hashtag')) {
                event.preventDefault();
                event.stopPropagation();
                event.target.click();
            }
        };
        if (location.hash.startsWith('#tag/')) hash();
        window.addEventListener('hashchange', hash);
        document.addEventListener('click', followTag);
        document.addEventListener('keydown', activateTag, true);
        return () => {
            window.removeEventListener('hashchange', hash);
            document.removeEventListener('click', followTag);
            document.removeEventListener('keydown', activateTag, true);
        };
    }, []);
    const mutate = useCallback((fn: (w: Workspace) => Workspace) => setW(w => w ? fn(w) : w), []);
    const openNote = (id: string) => {
        setActive(id);
        setSection('notes');
        setMobileOpen(false);
        setRead(false);
    };
    const matchesSearch = (note: Note) => {
        const term = query.trim();
        if (hashtagsIn(term).some(tag => tag.text === term)) {
            return matchesHashtag(note.content, term) || matchesHashtag({
                type: 'paragraph',
                content: [{type: 'text', text: note.title}]
            }, term);
        }
        return `${note.title} ${textOf(note.content)}`.toLocaleLowerCase().includes(term.toLocaleLowerCase());
    };
    const patchNote = (id: string, patch: Partial<Note>) => mutate(w => ({
        ...w,
        notes: w.notes.map(n => n.id === id ? {...n, ...patch} : n)
    }));
    useEffect(() => {
        if (!w) return;
        if (!w.notes.some(note => note.id === active)) setActive(w.notes[0]?.id || '');
        if (!w.boards.some(board => board.id === boardId)) setBoardId(w.boards[0]?.id || '');
    }, [w, active, boardId]);
    const attach = async (file: File) => {
        if (file.size > 20 * 1024 * 1024) throw new LocalizedError('errors.fileTooLarge');
        const attachment = await prepareAttachment(file);
        mutate(w => ({...w, attachments: [...w.attachments, {id: uid(), ...attachment}]}));
        return attachment.data;
    };
    const register = useCallback((e: Editor | null, fn: (kind: string) => void) => {
        setEditor(e);
        insert.current = fn;
    }, []);
    const createNote = (folderId: string | null) => {
        const id = uid();
        mutate(w => ({
            ...w,
            notes: [...w.notes, {id, title: '', folderId, content: emptyDoc(), updatedAt: Date.now()}]
        }));
        openNote(id);
    };
    const backup = () => {
        if (!w) return;
        download(`Typealot-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(w, null, 2));
        setNotice('backups.exported');
    };
    if (loadError) return <main className="startup"><h1>{t('workspace.couldNotOpenStorage')}</h1><p
        role="alert">{errorText(loadError)}</p>
        <p>{t('storage.openFailedDescription')}</p>
        <button onClick={() => location.reload()}>{t('common.retryLoading')}</button>
    </main>;
    if (!w) return <main className="startup" aria-busy="true">{t('workspace.openingNotes')}</main>;
    const note = w.notes.find(n => n.id === active);
    const board = w.boards.find(b => b.id === boardId);
    const titles: Record<Section, TranslationKey> = {
        notes: 'nav.notes',
        boards: 'nav.canvases',
        search: 'nav.search',
        attachments: 'nav.attachments',
        settings: 'nav.settings'
    };
    const nav: [[Section, typeof Files], ...Array<[Section, typeof Files]>] = [['boards', PanelsTopLeft], ['notes', Files], ['search', Search], ['attachments', Paperclip], ['settings', Settings]];
    const noteDrop = (folderId: string | null, targetId?: string) => ({
        onDragOver: (event: React.DragEvent<HTMLElement>) => {
            if (!isNoteDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = 'move';
            const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2;
            const source = draggedNote(event.dataTransfer, w);
            if (!source || source.id === targetId) {
                setDropTarget(null);
                return;
            }
            const bounds = event.currentTarget.getBoundingClientRect();
            const destination = w.folders.find(f => f.id === folderId)?.name || t('workspace.library');
            setDropTarget({
                kind: 'note',
                id: targetId || folderId || 'root',
                edge: targetId ? (after ? 'after' : 'before') : 'inside',
                label: `${source.title || t('notes.untitled')}${targetId ? '' : ` → ${destination}`}`,
                left: bounds.left + 8,
                top: targetId ? (after ? bounds.bottom : bounds.top) - 14 : bounds.bottom - 8
            });
        },
        onDragLeave: () => setDropTarget(null),
        onDrop: (event: React.DragEvent<HTMLElement>) => {
            if (!isNoteDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.stopPropagation();
            const source = draggedNote(event.dataTransfer, w);
            const after = event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.clientHeight / 2;
            if (source) mutate(current => moveNote(current, source.id, folderId, targetId, after));
            setDropTarget(null);
        }
    });
    const folderDrop = (targetId: string | null) => {
        const destination = (event: React.DragEvent<HTMLElement>) => {
            const source = draggedFolder(event.dataTransfer, w);
            const target = w.folders.find(f => f.id === targetId);
            const bounds = event.currentTarget.getBoundingClientRect();
            const fraction = (event.clientY - bounds.top) / bounds.height;
            const edge = target ? (fraction < .25 ? 'before' : fraction > .75 ? 'after' : 'inside') : 'inside';
            const parentId = edge === 'inside' ? targetId : target!.parentId;
            if (!source || source.id === targetId || (parentId && folderDescendants(w, source.id).has(parentId))) return null;
            return {source, edge, parentId, bounds};
        };
        return {
            onDragOver: (event: React.DragEvent<HTMLElement>) => {
                if (!isFolderDrag(event.dataTransfer)) {
                    noteDrop(targetId).onDragOver(event);
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const to = destination(event);
                event.dataTransfer.dropEffect = to ? 'move' : 'none';
                if (!to) {
                    setDropTarget(null);
                    return;
                }
                const {source, edge, parentId, bounds} = to;
                setDropTarget({
                    id: targetId || 'root', edge, kind: 'folder',
                    label: `${source.name}${edge === 'inside' ? ` → ${w.folders.find(f => f.id === parentId)?.name || t('workspace.library')}` : ''}`,
                    left: bounds.left + 8, top: edge === 'before' ? bounds.top - 14 : bounds.bottom - 8
                });
            },
            onDragLeave: () => setDropTarget(null),
            onDrop: (event: React.DragEvent<HTMLElement>) => {
                if (!isFolderDrag(event.dataTransfer)) {
                    noteDrop(targetId).onDrop(event);
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                const to = destination(event);
                if (to) mutate(current => moveFolder(current, to.source.id, to.parentId,
                    to.edge === 'inside' ? undefined : targetId!, to.edge === 'after'));
                setDropTarget(null);
            }
        };
    };
    const dropClass = (id: string) => dropTarget?.id === id ? ` drop-${dropTarget.edge}` : '';
    const folderTree = (parentId: string | null, depth = 0): React.ReactNode => <>{folderChildren(w, parentId).map(f =>
        <div key={f.id}>
            <div className={`folder-row${dropClass(f.id)}`} style={{paddingLeft: depth * 14}} {...folderDrop(f.id)}>
                <button draggable onDragStart={event => startFolderDrag(event.dataTransfer, f.id)}
                        onDragEnd={() => {
                            endFolderDrag();
                            setDropTarget(null);
                        }} onClick={() => setCollapsed(v => {
                    const s = new Set(v);
                    s.has(f.id) ? s.delete(f.id) : s.add(f.id);
                    return s;
                })} aria-expanded={!collapsed.has(f.id)}>{collapsed.has(f.id) ? <ChevronRight size={14}/> :
                    <ChevronDown size={14}/>}<Folder size={15}/><span>{f.name}</span></button>
                <button aria-label={t('folders.createFolderIn', {name: f.name})} title={t('folders.create')}
                        onClick={() => {
                            setParent(f.id);
                            setValue('');
                            setDialog('folder');
                        }}><Folder size={14}/></button>
                <button aria-label={t('folders.createNoteIn', {name: f.name})} title={t('notes.create')}
                        onClick={() => createNote(f.id)}><Plus size={14}/></button>
                <TreeActions label={t('folders.actionsFor', {name: f.name})}>
                    <button onClick={() => {
                        setParent(f.id);
                        setValue(f.name);
                        setDialog('rename-folder');
                    }}>{t('folders.rename')}</button>
                    <button onClick={() => {
                        setParent(f.id);
                        setValue(f.parentId || '');
                        setDialog('move-folder');
                    }}>{t('folders.move')}</button>
                    <button className="danger" onClick={() => {
                        setParent(f.id);
                        setDialog('delete-folder');
                    }}>{t('folders.delete')}</button>
                </TreeActions>
            </div>
            {!collapsed.has(f.id) && folderTree(f.id, depth + 1)}
        </div>)}{folderNotes(w, parentId).map(n => <div
        className={`tree-note-row ${active === n.id ? 'active' : ''}${dropClass(n.id)}`} key={n.id}
        style={{paddingLeft: depth * 14}} {...noteDrop(parentId, n.id)}>
        <button className="tree-note" draggable onDragStart={event => {
            startNoteDrag(event.dataTransfer, n.id);
        }} onDragEnd={() => {
            endNoteDrag();
            setDropTarget(null);
        }} onClick={() => openNote(n.id)}><FileText size={15}/><span>{n.title || t('notes.untitled')}</span></button>
        <TreeActions label={t('notes.actionsFor', {name: n.title || t('notes.untitled')})}>
            <button onClick={() => {
                setActionNoteId(n.id);
                setValue(n.folderId || '');
                setDialog('move');
            }}>{t('workspace.moveToFolder')}</button>
            <button className="danger" onClick={() => {
                setActionNoteId(n.id);
                setDialog('delete-note');
            }}>{t('workspace.deleteNote')}</button>
        </TreeActions>
    </div>)}</>;
    return <RealtimeContext.Provider value={sync.realtime}><AttachmentContext.Provider value={w.attachments}>
        <div className={`app ${w.sidebar ? 'expanded' : 'collapsed'} ${mobileOpen ? 'mobile-open' : ''}`}
             style={{'--sidebar-width': `${w.sidebarWidth}px`} as React.CSSProperties}>
            {dropTarget && <div className="tree-drag-preview" aria-hidden="true"
                                style={{left: dropTarget.left, top: dropTarget.top}}>{dropTarget.kind === 'folder' ?
                <Folder size={14}/> : <FileText size={14}/>} {dropTarget.label}</div>}
            <a className="skip-link" href="#workspace">{t('workspace.skipToContent')}</a>{mobileOpen &&
            <button className="mobile-scrim" aria-label={t('workspace.closeNavigation')}
                    onClick={() => setMobileOpen(false)}/>}
            <aside className="sidebar" aria-label={t('workspace.navigation')}>
                <div className="brand"><span className="wordmark">Typealot<span>.</span></span>
                    <button title={t('nav.toggleSidebarShortcut')} aria-label={t('workspace.toggleSidebar')}
                            onClick={() => {
                                mutate(w => ({...w, sidebar: !w.sidebar}));
                                setMobileOpen(false);
                            }}>{w.sidebar ? <PanelLeftClose size={18}/> : <PanelLeftOpen size={18}/>}</button>
                </div>
                <nav>{nav.map(([key, Icon]) => <button key={key} title={t(titles[key])} aria-label={t(titles[key])}
                                                       className={section === key ? 'active' : ''} onClick={() => {
                    setSection(key);
                    setMobileOpen(false);
                    if (!w.sidebar) mutate(w => ({...w, sidebar: true}));
                }}><Icon size={18}/><span>{t(titles[key])}</span></button>)}</nav>
                <div className="sidebar-content">{section === 'notes' ? <>
                        <div className={`section-caption${dropClass('root')}`} {...folderDrop(null)}>
                            <span>{t('workspace.library')}</span>
                            <div>
                                <button aria-label={t('folders.create')} title={t('folders.create')} onClick={() => {
                                    setParent(null);
                                    setValue('');
                                    setDialog('folder');
                                }}><Folder size={15}/></button>
                                <button aria-label={t('notes.create')} title={t('notes.create')}
                                        onClick={() => createNote(null)}>
                                    <Plus size={16}/></button>
                            </div>
                        </div>
                        {folderTree(null)}</>
                    : section === 'boards' ? <>
                            <div className="section-caption"><span>{t('workspace.boards')}</span>
                                <button aria-label={t('canvas.create')} onClick={() => {
                                    setValue('');
                                    setDialog('board');
                                }}><Plus size={16}/></button>
                            </div>
                            {w.boards.map(b => <button className={`tree-note ${boardId === b.id ? 'active' : ''}`}
                                                       key={b.id}
                                                       onClick={() => {
                                                           setBoardId(b.id);
                                                           setMobileOpen(false);
                                                       }}><PanelsTopLeft size={15}/>{b.title}</button>)}
                            <div className={`section-caption${dropClass('root')}`} {...folderDrop(null)}>
                                <span>{t('workspace.library')}</span></div>
                            {folderTree(null)}</>
                        : section === 'search' ?
                            <div className="search-panel"><label>{t('workspace.searchAllNotes')}<input type="search"
                                                                                                       autoFocus
                                                                                                       placeholder={t('workspace.titleOrText')}
                                                                                                       value={query}
                                                                                                       onChange={e => setQuery(e.target.value)}/></label>
                            </div>
                            : null}</div>
                <div className="sidebar-bottom">
                    <span className={`save-status ${saveError ? 'error' : ''}`}
                          title={saveError ? errorText(saveError) : t('workspace.savedOnThisDevice')}
                          role="status">{saveError ? <AlertCircle size={13}/> : status === 'storage.saved' ?
                        <Check
                            size={13}/> : null}<span>{t(status === 'storage.saved' && sync.status ? sync.status : status)}</span></span>
                    <button title={t('workspace.switchTheme')} aria-label={t('workspace.switchTheme')}
                            onClick={() => mutate(w => ({
                                ...w,
                                theme: w.theme === 'dark' ? 'light' : 'dark'
                            }))}>{w.theme === 'dark' ? <Sun size={17}/> : <Moon size={17}/>}</button>
                </div>
                {w.sidebar && <div className="sidebar-resizer" role="separator" aria-label={t('workspace.sidebarWidth')}
                                   aria-valuenow={w.sidebarWidth} aria-valuemin={200} aria-valuemax={420}
                                   aria-orientation="vertical" tabIndex={0} onKeyDown={e => {
                    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') mutate(w => ({
                        ...w,
                        sidebarWidth: Math.max(200, Math.min(420, w.sidebarWidth + (e.key === 'ArrowLeft' ? -10 : 10)))
                    }));
                }} onPointerDown={e => {
                    if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
                }} onPointerMove={e => {
                    if (e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId)) mutate(w => ({
                        ...w,
                        sidebarWidth: Math.max(200, Math.min(420, e.clientX))
                    }));
                }}/>}
            </aside>
            <main className="workspace" id="workspace">
                <header className="workspace-header">
                    <button className="mobile-menu" aria-label={t('workspace.openNavigation')}
                            onClick={() => setMobileOpen(true)}>
                        <PanelLeftOpen size={20}/>{t('workspace.menu')}</button>
                    <div className="breadcrumbs"><span>{t(titles[section])}</span>{section === 'notes' && note && <>
                        <ChevronRight
                            size={13}/><span>{note.title || t('notes.untitled')}</span></>}{section === 'boards' && board && <>
                        <ChevronRight size={13}/><span>{board.title}</span></>}</div>
                    <div className="header-actions">{section === 'notes' && note &&
                        <button title={read ? t('workspace.edit') : t('workspace.readingMode')}
                                aria-label={read ? t('workspace.edit') : t('workspace.readingMode')} aria-pressed={read}
                                onClick={() => setRead(v => !v)}>{read ? <Pencil size={17}/> :
                            <BookOpen size={17}/>}<span>{read ? t('workspace.edit') : t('workspace.read')}</span>
                        </button>}
                        <details>
                            <summary aria-label={t('workspace.actions')}><MoreHorizontal size={20}/></summary>
                            <div className="popup right">
                                <button onClick={backup}>{t('workspace.exportWorkspace')}</button>
                                {note && section === 'notes' && <>
                                    <button
                                        onClick={() => download(`${note.title || t('notes.kind')}.html`, exportNoteHtml(note, w), 'text/html;charset=utf-8')}>{t('workspace.exportNoteHTML')}</button>
                                    <button onClick={() => {
                                        download(`${note.title || t('notes.kind')}.json`, JSON.stringify(note, null, 2));
                                    }}>{t('workspace.exportNoteJSON')}</button>
                                </>}{board && section === 'boards' && <>
                                <button onClick={() => {
                                    setValue(board.title);
                                    setDialog('rename-board');
                                }}>{t('workspace.renameCanvas')}</button>
                                <button onClick={() => setDialog('delete-board')}>{t('workspace.deleteCanvas')}</button>
                            </>}</div>
                        </details>
                    </div>
                </header>
                {section === 'notes' && note ? <>{!read && editor &&
                        <div className="ribbon"><FormatTools editor={editor} insert={kind => insert.current(kind)}/></div>}
                        <div className="document-scroll"><NoteEditor key={note.id} note={note} workspace={w}
                                                                     update={patch => patchNote(note.id, patch)}
                                                                     readOnly={read}
                                                                     register={register} attach={attach}/></div>
                    </>
                    : section === 'boards' && board ? <Canvas key={board.id} board={board} workspace={w}
                                                              update={patch => mutate(w => ({
                                                                  ...w,
                                                                  boards: w.boards.map(b => b.id === board.id ? {...b, ...(typeof patch === 'function' ? patch(b) : patch)} : b)
                                                              }))} openNote={openNote} attach={attach}/>
                        : section === 'search' ?
                            <div className="utility-page"><h1>{t('workspace.findAThought')}</h1><label
                                className="main-search">{t('nav.search')}<input
                                type="search" value={query} onChange={e => setQuery(e.target.value)}
                                placeholder={t('workspace.enterAWordOrPhrase')}/></label>{query.trim() ? <div
                                    className="search-results">{w.notes.filter(matchesSearch).map(n =>
                                    <button key={n.id} onClick={() => openNote(n.id)}>
                                        <strong>{n.title || t('notes.untitled')}</strong><span>{textOf(n.content).slice(0, 220)}</span>
                                    </button>)}{!w.notes.some(matchesSearch) &&
                                    <p>{t('workspace.nothingFoundTryAnotherWord')}</p>}</div> :
                                <p>{t('workspace.searchNoteTitlesAndFullContent')}</p>}</div>
                            : section === 'attachments' ? <div className="utility-page">
                                    <div className="page-heading"><h1>{t('nav.attachments')}</h1>
                                        <button onClick={() => upload.current?.click()}><Plus
                                            size={16}/>{t('workspace.addFile')}</button>
                                    </div>
                                    <p>{t('attachments.imageCompression')}</p>
                                    {w.attachments.length ?
                                        <div className="attachment-list">{w.attachments.map(a => <div className="attachment"
                                                                                                      key={a.id}>{/^image\/(png|jpeg|webp|gif)$/.test(a.mime) ?
                                            <img width="100" height="70" src={a.data} alt={a.name}/> :
                                            <Paperclip size={24}/>}<span>{a.name}</span>
                                            <button aria-label={t('attachments.renameNamed', {name: a.name})}
                                                    onClick={() => {
                                                        setAttachmentId(a.id);
                                                        setValue(splitFilename(a.name).base);
                                                        setRenameError('');
                                                        setDialog('rename-attachment');
                                                    }}>{t('attachments.rename')}</button>
                                            <button aria-label={t('attachments.downloadNamed', {name: a.name})}
                                                    onClick={() => {
                                                        downloadAttachment(a.name, a.data);
                                                    }}><Download size={18}/></button>
                                            <button onClick={() => {
                                                setValue(a.id);
                                                setDialog('delete-attachment');
                                            }}>{t('common.delete')}</button>
                                        </div>)}</div> : <p>{t('workspace.noAttachmentsYetAddAnImageOrAFile')}</p>}</div>
                                : section === 'settings' ?
                                    <SettingsPage>
                                        <section id="settings-appearance" tabIndex={-1}
                                                 aria-labelledby="settings-appearance-title"><h2
                                            id="settings-appearance-title">{t('settings.appearance')}</h2>
                                            <label>{t('settings.theme')}<select
                                                aria-label={t('settings.theme')} value={w.theme}
                                                onChange={e => mutate(w => ({
                                                    ...w,
                                                    theme: e.target.value as 'dark' | 'light'
                                                }))}>
                                                <option value="dark">{t('settings.dark')}</option>
                                                <option value="light">{t('settings.light')}</option>
                                            </select></label><label>{t('settings.language')}<select
                                                aria-label={t('settings.language')} value={language} onChange={e => {
                                                if (isLanguage(e.target.value)) setLanguage(e.target.value);
                                            }}>{supportedLanguages.map(code => <option key={code}
                                                                                       value={code}>{locales[code].nativeName}</option>)}</select></label>
                                        </section>
                                        <section id="settings-profile" tabIndex={-1}
                                                 aria-labelledby="settings-profile-title"><h2
                                            id="settings-profile-title">{t('profile.title')}</h2>
                                            <label>{t('profile.name')}<input
                                                value={w.profile.name}
                                                onChange={e => mutate(w => ({
                                                    ...w,
                                                    profile: {
                                                        ...w.profile,
                                                        name: e.target.value
                                                    }
                                                }))}/></label><label>{t('profile.handle')}<input
                                                value={w.profile.handle} onChange={e => mutate(w => ({
                                                ...w,
                                                profile: {...w.profile, handle: e.target.value}
                                            }))}/></label><p>{t('collaboration.profileDescription')}</p></section>
                                        <section id="settings-editing" tabIndex={-1}
                                                 aria-labelledby="settings-editing-title"><h2
                                            id="settings-editing-title">{t('workspace.editing')}</h2><label
                                            className="check-label"><input
                                            type="checkbox"
                                            checked={w.markdown}
                                            onChange={e => mutate(w => ({
                                                ...w,
                                                markdown: e.target.checked
                                            }))}/>{t('workspace.convertMarkdownMarkersWhileTyping')}</label></section>
                                        <section id="settings-transfer" tabIndex={-1}
                                                 aria-labelledby="settings-transfer-title"><h2
                                            id="settings-transfer-title">{t('workspace.backupsAndTransfer')}</h2>
                                            <div className="button-row">
                                                <button onClick={backup}><Download
                                                    size={16}/>{t('workspace.exportEverything')}</button>
                                                <button onClick={() => importInput.current?.click()}><Upload
                                                    size={16}/>{t('workspace.importBackup')}</button>
                                            </div>
                                            <p>{t('backups.importDescription')}</p></section>
                                        {sync.panel}{notice && <p role="status">{errorText(notice)}</p>}</SettingsPage>
                                    : <div className="empty-state"><FileText size={32}/>
                                        <h1>{section === 'boards' ? t('workspace.addYourFirstCanvas') : t('workspace.startANewNote')}</h1>
                                        <button className="primary" onClick={() => {
                                            if (section === 'boards') {
                                                setValue('');
                                                setDialog('board');
                                            } else createNote(null);
                                        }}>{section === 'boards' ? t('canvas.create') : t('notes.create')}</button>
                                    </div>}
                <UpdateNotice beforeInstall={async () => {
                    if (latest.current) {
                        const snapshot = latest.current;
                        serial.current = serial.current.catch(() => {
                        }).then(() => saveWorkspace(snapshot));
                        await serial.current;
                    }
                }}/>
                {saveError && <div role="alert" className="save-error">{errorText(saveError)}
                    <button onClick={backup}>{t('workspace.exportData')}</button>
                    <button onClick={() => {
                        saveWorkspace(w).then(() => {
                            setSaveError('');
                            setStatus('storage.saved');
                        }).catch(e => setSaveError(toError(e)));
                    }}>{t('common.retry')}</button>
                </div>}
            </main>
            <input hidden ref={upload} type="file" multiple onChange={async e => {
                try {
                    for (const f of Array.from(e.target.files || [])) await attach(f);
                } catch (err) {
                    setNotice(toError(err));
                    setDialog('notice');
                }
                e.target.value = '';
            }}/>
            <input hidden ref={importInput} type="file" accept="application/json,.json" onChange={async e => {
                const f = e.target.files?.[0];
                if (f) {
                    try {
                        if (f.size > 150 * 1024 * 1024) throw new LocalizedError('errors.backupTooLarge');
                        validateWorkspace(JSON.parse(await f.text()));
                        setValue(await f.text());
                        setDialog('import');
                    } catch (err) {
                        setNotice(toError(err));
                        setDialog('notice');
                    }
                }
                e.target.value = '';
            }}/>
            {dialog && <Modal title={{
                folder: t('folders.newDialog'),
                board: t('canvas.newDialog'),
                'rename-folder': t('folders.rename'),
                'move-folder': t('folders.move'),
                'delete-folder': t('folders.deleteConfirm'),
                'rename-board': t('workspace.renameCanvas'),
                'rename-attachment': t('attachments.rename'),
                move: t('workspace.moveNote'),
                'delete-note': t('notes.deleteConfirm'),
                'delete-board': t('canvas.deleteConfirm'),
                'delete-attachment': t('attachments.deleteConfirm'),
                import: t('workspace.replaceWorkspace'),
                notice: t('workspace.message')
            }[dialog] || ''} close={() => setDialog(null)}>
                {dialog === 'notice' ? <p role="status">{errorText(notice)}</p> : dialog === 'import' ? <>
                        <p>{t('backups.replaceDescription')}</p>
                        <button className="primary" onClick={async () => {
                            try {
                                await checkpoint(w);
                                const next = validateWorkspace(JSON.parse(value));
                                backup();
                                setW(next);
                                setActive(next.notes[0]?.id || '');
                                setBoardId(next.boards[0]?.id || '');
                                setDialog(null);
                                setNotice('workspace.workspaceImported');
                            } catch (error) {
                                setNotice(toError(error));
                                setDialog('notice');
                            }
                        }}>{t('workspace.exportAndReplace')}</button>
                    </>
                    : dialog.startsWith('delete-') ? <>
                            <p>{dialog === 'delete-folder' ? t('folders.deleteDescription') : dialog === 'delete-attachment' ? t('attachments.deleteDescription') : t('workspace.deleteDescription')}</p>
                            <button className="danger" onClick={() => {
                                if (dialog === 'delete-note') {
                                    mutate(w => ({...w, notes: w.notes.filter(n => n.id !== actionNoteId)}));
                                } else if (dialog === 'delete-board') {
                                    mutate(w => ({...w, boards: w.boards.filter(b => b.id !== boardId)}));
                                    setBoardId(w.boards.find(b => b.id !== boardId)?.id || '');
                                } else if (dialog === 'delete-folder' && parent) mutate(w => removeFolder(w, parent));
                                else mutate(w => ({...w, attachments: w.attachments.filter(a => a.id !== value)}));
                                setDialog(null);
                            }}>{t('common.delete')}</button>
                        </>
                        : <form onSubmit={e => {
                            e.preventDefault();
                            if (dialog === 'rename-attachment') {
                                const attachment = w.attachments.find(a => a.id === attachmentId);
                                if (!attachment) {
                                    setDialog(null);
                                    return;
                                }
                                try {
                                    const name = renameAttachment(attachment.name, value);
                                    mutate(w => ({
                                        ...w,
                                        attachments: w.attachments.map(a => a.id === attachmentId ? {...a, name} : a)
                                    }));
                                } catch (error) {
                                    setRenameError(toError(error));
                                    return;
                                }
                            } else if (dialog === 'move-folder' && parent) {
                                mutate(w => moveFolder(w, parent, value || null));
                            } else if (dialog === 'move') {
                                patchNote(actionNoteId, {folderId: value || null});
                            } else if (value.trim()) {
                                if (dialog === 'folder') {
                                    setCollapsed(v => {
                                        const next = new Set(v);
                                        if (parent) next.delete(parent);
                                        return next;
                                    });
                                    mutate(w => ({
                                        ...w,
                                        folders: [...w.folders, {id: uid(), name: value.trim(), parentId: parent}]
                                    }));
                                }
                                if (dialog === 'rename-folder') mutate(w => ({
                                    ...w,
                                    folders: w.folders.map(f => f.id === parent ? {...f, name: value.trim()} : f)
                                }));
                                if (dialog === 'rename-board') mutate(w => ({
                                    ...w,
                                    boards: w.boards.map(b => b.id === boardId ? {...b, title: value.trim()} : b)
                                }));
                                if (dialog === 'board') {
                                    const id = uid();
                                    mutate(w => ({
                                        ...w,
                                        boards: [...w.boards, {
                                            id,
                                            title: value.trim(),
                                            nodes: [],
                                            edges: [],
                                            viewport: {x: 0, y: 0, zoom: 1}
                                        }]
                                    }));
                                    setBoardId(id);
                                    setSection('boards');
                                }
                            } else return;
                            setDialog(null);
                        }}>
                            <label>{dialog === 'move' || dialog === 'move-folder' ? t('workspace.folder') : t('workspace.title')}{dialog === 'move' || dialog === 'move-folder' ?
                                <select aria-label={t('workspace.folder')} value={value}
                                        onChange={e => setValue(e.target.value)}>
                                    <option value="">{t('workspace.noFolder')}</option>
                                    {w.folders.filter(f => dialog !== 'move-folder' || !parent || !folderDescendants(w, parent).has(f.id)).map(f =>
                                        <option key={f.id} value={f.id}>{f.name}</option>)}</select> :
                                <input autoFocus required value={value}
                                       onChange={e => setValue(e.target.value)}/>}</label>{dialog === 'folder' &&
                            <label>{t('workspace.parentFolder')}<select aria-label={t('workspace.parentFolder')}
                                                                        value={parent || ''}
                                                                        onChange={e => setParent(e.target.value || null)}>
                                <option value="">{t('workspace.libraryRoot')}</option>
                                {w.folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select></label>}
                            {dialog === 'rename-attachment' && <>
                                <p>{t('attachments.extensionKept', {extension: splitFilename(w.attachments.find(a => a.id === attachmentId)?.name || '').extension})}</p>{renameError &&
                                <p role="alert">{errorText(renameError)}</p>}</>}
                            <footer>
                                <button className="primary" type="submit">{t('common.save')}</button>
                            </footer>
                        </form>}
            </Modal>}
            {sync.conflictDialog}</div>
    </AttachmentContext.Provider></RealtimeContext.Provider>;
}
