import {isFolderDrag} from '../library/folder-drag';
import {draggedNote, isNoteDrag} from '../library/note-drag';
import {type DisplayError, errorText, t, toError, useLanguage} from '../locales/i18n';
import {createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom';
import {
    addEdge,
    applyEdgeChanges,
    applyNodeChanges,
    Background,
    BackgroundVariant,
    ConnectionMode,
    Handle,
    MarkerType,
    type NodeProps,
    NodeResizer,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Viewport,
    ViewportPortal
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    GitBranch,
    Group,
    Hand,
    Image,
    Layers,
    Maximize,
    MousePointer2,
    Pencil,
    Square,
    StickyNote,
    Trash2,
    Type,
    ZoomIn,
    ZoomOut
} from 'lucide-react';
import type {Board, Workspace} from '../storage/model';
import {uid} from '../storage/model';
import {renderNoteContent} from '../storage/export';
import AttachmentPicker from '../media/AttachmentPicker';
import NoteLinkPicker from '../editor/NoteLinkPicker';
import {type BoardCollaboration, useBoardCollaboration} from '../sync/board-collaboration';
import CanvasPresence from './CanvasPresence';
import CollaborationStatus from '../sync/CollaborationStatus';

function NoteContent({note, workspace}: { note: Workspace['notes'][number]; workspace: Workspace }) {
    return <div className="board-note-content document-body" inert
                dangerouslySetInnerHTML={{__html: renderNoteContent(note, workspace)}}/>;
}

const BoardContext = createContext<{
    workspace: Workspace;
    openNote: (id: string) => void;
    collaboration: BoardCollaboration | null
}>({
    workspace: null!,
    collaboration: null,
    openNote: () => {
    }
});

function ObjectNode({data, selected, id}: NodeProps) {
    useLanguage();
    const {workspace, openNote, collaboration} = useContext(BoardContext);
    const {updateNodeData} = useReactFlow();
    const kind = data.kind as string;
    const note = workspace.notes.find(n => n.id === data.noteId);
    const busy = collaboration?.foreignLock(id);
    return <div className={`board-object ${kind} ${selected ? 'selected' : ''}`}
                style={{
                    background: kind === 'shape' ? String(data.color || 'var(--surface)') : undefined,
                    borderRadius: kind === 'shape' && data.shape === 'ellipse' ? '50%' : undefined
                }}>
        {busy && <span className="block-edit-owner">{t('collaboration.objectEditedBy', {name: busy.name})}</span>}
        <NodeResizer isVisible={!!selected && !data.locked && !busy} minWidth={160} minHeight={100}
                     keepAspectRatio={kind === 'image'} onResizeStart={() => {
            void collaboration?.claim(id);
        }} onResizeEnd={() => collaboration?.release(id)}/>
        {[Position.Top, Position.Right, Position.Bottom, Position.Left].map(position =>
            <Handle key={position} id={position} type="source" position={position}
                    aria-label={t('canvas.connectionHandle', {direction: t(`canvas.side.${position}`)})}/>
        )}
        {kind === 'note' ? <><span className="object-label">{t('notes.kind')}</span>
                <button className="card-title nodrag"
                        onClick={() => note && openNote(note.id)}>{note?.title || t('canvas.noteDeleted')}</button>
                {note ? <NoteContent note={note} workspace={workspace}/> : <p>{t('canvas.deletedNoteDescription')}</p>}</>
            : kind === 'image' ?
                <img src={String(data.src)} alt={String(data.alt || t('canvas.canvasImage'))} draggable={false}/>
                : kind === 'drawing' ?
                    <svg viewBox={`0 0 ${Number(data.viewBoxWidth) || 300} ${Number(data.viewBoxHeight) || 160}`}
                         preserveAspectRatio="none" width="100%" height="100%">
                        <path d={String(data.path)} stroke={String(data.color || '#81ad9b')} strokeWidth="3" fill="none"
                              strokeLinecap="round"/>
                    </svg>
                    : <textarea className="nodrag"
                                aria-label={kind === 'shape' ? t('canvas.shapeText') : t('canvas.canvasText')}
                                readOnly={!!data.locked || !!collaboration && !collaboration.editable(id)}
                                onFocus={() => {
                                    void collaboration?.claim(id);
                                }} onBlur={() => collaboration?.release(id)}
                                title={busy ? t('collaboration.objectEditedBy', {name: busy.name}) : undefined}
                                style={{fontSize: `${Number(data.fontSize) || 18}px`}} value={String(data.text || '')}
                                placeholder={kind === 'shape' ? t('canvas.shape') : t('canvas.text')}
                                onChange={e => updateNodeData(id, {text: e.target.value})}/>}
    </div>;
}

const nodeTypes = {object: ObjectNode};
type BoardUpdate = Partial<Board> | ((board: Board) => Partial<Board>);

function TextSizeInput({value, onChange}: { value: number; onChange: (size: number) => void }) {
    const [draft, setDraft] = useState<string | null>(null);
    const commit = () => {
        if (draft !== null && draft.trim() !== '' && Number.isFinite(Number(draft))) {
            onChange(Math.min(96, Math.max(12, Number(draft))));
        }
        setDraft(null);
    };
    return <input aria-label={t('canvas.canvasTextSize')} type="number" min="12" max="96"
                  value={draft ?? value}
                  onChange={event => {
                      const raw = event.target.value, size = event.target.valueAsNumber;
                      setDraft(raw);
                      if (Number.isFinite(size) && size >= 12 && size <= 96) onChange(size);
                  }}
                  onBlur={commit}
                  onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                  }}/>;
}

export default function Canvas(props: {
    board: Board;
    workspace: Workspace;
    update: (patch: BoardUpdate) => void;
    openNote: (id: string) => void;
    attach: (file: File) => Promise<string>
}) {
    useLanguage();
    return <ReactFlowProvider><CanvasInner {...props}/></ReactFlowProvider>;
}

function CanvasInner({board, workspace, update, openNote, attach}: {
    board: Board;
    workspace: Workspace;
    update: (patch: BoardUpdate) => void;
    openNote: (id: string) => void;
    attach: (file: File) => Promise<string>
}) {
    useLanguage();
    const flow = useReactFlow();
    const collaboration = useBoardCollaboration(board, workspace, update);
    const [tool, setTool] = useState('select');
    const [notePreview, setNotePreview] = useState<{ id: string; x: number; y: number } | null>(null);
    useEffect(() => {
        const clear = () => setNotePreview(null);
        document.addEventListener('dragend', clear);
        return () => document.removeEventListener('dragend', clear);
    }, []);
    const previewNote = workspace.notes.find(n => n.id === notePreview?.id);
    const [error, setError] = useState<DisplayError>('');
    const input = useRef<HTMLInputElement>(null);
    const points = useRef<{ x: number; y: number }[]>([]);
    const [path, setPath] = useState('');
    const [choose, setChoose] = useState(false);
    const noteButton = useRef<HTMLButtonElement>(null);
    const notePicker = useRef<HTMLDivElement>(null);
    const notePickerId = useId();
    useLayoutEffect(() => {
        const anchor = noteButton.current, popup = notePicker.current;
        if (!choose || !anchor || !popup) return;
        let active = true;
        const cleanup = autoUpdate(anchor, popup, () => {
            void computePosition(anchor, popup, {
                strategy: 'fixed', placement: 'bottom-start',
                middleware: [offset(7), flip(), shift({padding: 10})]
            }).then(({x, y}) => {
                if (active) Object.assign(popup.style, {left: `${x}px`, top: `${y}px`});
            });
        });
        const outside = (event: PointerEvent) => {
            if (!anchor.contains(event.target as globalThis.Node) && !popup.contains(event.target as globalThis.Node)) setChoose(false);
        };
        const keyboard = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setChoose(false);
            anchor.focus();
        };
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', keyboard);
        return () => {
            active = false;
            cleanup();
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', keyboard);
        };
    }, [choose]);
    const [library, setLibrary] = useState(false);
    const nodes = board.nodes;
    const chosen = nodes.filter(n => n.selected && !collaboration.foreignLock(n.id));
    const edge = board.edges.find(e => e.selected);
    const image = chosen.length === 1 && chosen[0].data.kind === 'image';
    const shape = chosen.length === 1 && chosen[0].data.kind === 'shape';
    const clearSelection = () => {
        setTool('select');
        update({
            nodes: nodes.map(n => ({...n, selected: false})),
            edges: board.edges.map(e => ({...e, selected: false}))
        });
    };
    const text = chosen.length === 1 && chosen[0].data.kind === 'text';
    const drawing = chosen.length === 1 && chosen[0].data.kind === 'drawing';
    const resizeImage = (delta: number) => update(current => ({
        nodes: current.nodes.map(node => {
            if (node.id !== chosen[0]?.id || node.data.kind !== 'image') return node;
            const width = node.width ?? node.measured?.width ?? (Number(node.style?.width) || 300);
            const height = node.height ?? node.measured?.height ?? Number(node.style?.height);
            if (!(width > 0 && height > 0)) return node;
            const nextWidth = Math.max(160, 100 * width / height, width + delta);
            const nextHeight = height * nextWidth / width;
            return {
                ...node,
                width: nextWidth,
                height: nextHeight,
                style: {...node.style, width: nextWidth, height: nextHeight}
            };
        })
    }));
    const changeData = (patch: Record<string, unknown>) => update(current => ({
        nodes: current.nodes.map(n => chosen.some(selected => selected.id === n.id) ? {
            ...n,
            data: {...n.data, ...patch}
        } : n)
    }));
    const patchEdge = (patch: Partial<(typeof board.edges)[number]>) => update({edges: board.edges.map(e => e.id === edge?.id ? {...e, ...patch} : e)});
    const layerOrder = (id: string, direction: 'front' | 'back') => {
        const ranks = nodes.map(n => n.zIndex || 0);
        update({
            nodes: nodes.map(n => n.id === id ? {
                ...n,
                zIndex: direction === 'front' ? Math.max(0, ...ranks) + 1 : Math.min(0, ...ranks) - 1
            } : n)
        });
    };
    const add = (kind: string, extra: Record<string, unknown> = {}) => {
        const bounds = document.querySelector('.canvas-area')!.getBoundingClientRect();
        const pos = flow.screenToFlowPosition({x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2});
        update({
            nodes: [...nodes.map(n => ({...n, selected: false})), {
                id: uid(),
                type: 'object',
                position: pos,
                selected: true,
                data: {kind, text: '', ...extra},
                style: {width: kind === 'text' ? 260 : 300}
            }]
        });
        setTool('select');
    };
    const remove = () => {
        const ids = new Set(chosen.map(n => n.id));
        update({
            nodes: nodes.filter(n => !ids.has(n.id)).map(n => ids.has(n.parentId || '') ? {
                ...n,
                parentId: undefined,
                position: {
                    x: n.position.x + (nodes.find(p => p.id === n.parentId)?.position.x || 0),
                    y: n.position.y + (nodes.find(p => p.id === n.parentId)?.position.y || 0)
                }
            } : n), edges: board.edges.filter(e => !e.selected && !ids.has(e.source) && !ids.has(e.target))
        });
    };
    const group = () => {
        const items = chosen.filter(n => !n.parentId);
        if (items.length < 2) return;
        const x = Math.min(...items.map(n => n.position.x)) - 24, y = Math.min(...items.map(n => n.position.y)) - 40;
        const width = Math.max(...items.map(n => n.position.x + (n.measured?.width || 300))) - x + 24,
            height = Math.max(...items.map(n => n.position.y + (n.measured?.height || 180))) - y + 24;
        const id = uid();
        const ids = new Set(items.map(n => n.id));
        update({
            nodes: [{
                id,
                type: 'group',
                position: {x, y},
                data: {},
                style: {width, height, background: 'var(--group)', border: '1px solid var(--accent)'}
            }, ...nodes.map(n => ids.has(n.id) ? {
                ...n,
                parentId: id,
                selected: false,
                position: {x: n.position.x - x, y: n.position.y - y}
            } : n)]
        });
    };
    return <>
        <div className="ribbon canvas-ribbon" role="toolbar" aria-label={t('canvas.canvasTools')}
             onFocusCapture={() => {
                 for (const node of chosen) void collaboration.claim(node.id);
             }} onBlurCapture={event => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node)) for (const node of chosen) collaboration.release(node.id);
        }}>
            {image ? <><span>{t('media.image')}</span>
                    <button onClick={() => resizeImage(-40)}>{t('canvas.makeSmaller')}</button>
                    <button onClick={() => resizeImage(40)}>{t('canvas.makeLarger')}</button>
                </>
                : edge ? <><span>{t('canvas.connection')}</span><label>{t('canvas.color')}<input type="color"
                                                                                                 value={String(edge.style?.stroke || '#81ad9b')}
                                                                                                 onChange={e => update({
                                                                                                     edges: board.edges.map(x => x.id === edge.id ? {
                                                                                                         ...x,
                                                                                                         markerStart: typeof x.markerStart === 'object' ? {
                                                                                                             ...x.markerStart,
                                                                                                             color: e.target.value
                                                                                                         } : x.markerStart,
                                                                                                         markerEnd: typeof x.markerEnd === 'object' ? {
                                                                                                             ...x.markerEnd,
                                                                                                             color: e.target.value
                                                                                                         } : x.markerEnd,
                                                                                                         style: {
                                                                                                             ...x.style,
                                                                                                             stroke: e.target.value
                                                                                                         }
                                                                                                     } : x)
                                                                                                 })}/></label><label>{t('connection.width')}<input
                        type="range" min="1"
                        max="8"
                        value={Number(edge.style?.strokeWidth || 2)}
                        onChange={e => update({
                            edges: board.edges.map(x => x.id === edge.id ? {
                                ...x,
                                style: {
                                    ...x.style,
                                    strokeWidth: +e.target.value
                                }
                            } : x)
                        })}/></label>
                        <label>{t('canvas.label')}<input aria-label={t('canvas.connectionLabel')}
                                                         value={String(edge.label || '')}
                                                         onChange={e => patchEdge({label: e.target.value})}/></label>
                        <label>{t('canvas.line')}<select aria-label={t('canvas.line')} value={edge.type || 'default'}
                                                         onChange={e => patchEdge({type: e.target.value})}>
                            <option value="default">{t('canvas.curved')}</option>
                            <option value="straight">{t('canvas.straight')}</option>
                            <option value="smoothstep">{t('canvas.elbow')}</option>
                        </select></label>
                        <label>{t('canvas.arrows')}<select aria-label={t('canvas.arrows')}
                                                           value={edge.markerStart ? 'both' : edge.markerEnd ? 'end' : 'none'}
                                                           onChange={e => {
                                                               const marker = {
                                                                   type: MarkerType.ArrowClosed,
                                                                   color: String(edge.style?.stroke || '#81ad9b')
                                                               };
                                                               patchEdge({
                                                                   markerStart: e.target.value === 'both' ? marker : undefined,
                                                                   markerEnd: e.target.value === 'none' ? undefined : marker
                                                               });
                                                           }}>
                            <option value="end">{t('canvas.atEnd')}</option>
                            <option value="both">{t('canvas.bothEnds')}</option>
                            <option value="none">{t('canvas.noArrows')}</option>
                        </select></label>
                        <button aria-pressed={!!edge.style?.strokeDasharray} onClick={() => patchEdge({
                            style: {
                                ...edge.style,
                                strokeDasharray: edge.style?.strokeDasharray ? undefined : '6 5'
                            }
                        })}>{t('canvas.dashed')}</button>
                    </>
                    : shape ? <><span>{t('canvas.shape')}</span><label>{t('canvas.fill')}<input type="color"
                                                                                                value={String(chosen[0].data.color || '#384942')}
                                                                                                onChange={e => update({
                                                                                                    nodes: nodes.map(n => n.selected ? {
                                                                                                        ...n,
                                                                                                        data: {
                                                                                                            ...n.data,
                                                                                                            color: e.target.value
                                                                                                        }
                                                                                                    } : n)
                                                                                                })}/></label>
                            <label>{t('canvas.shapeType')}<select value={String(chosen[0].data.shape || 'rectangle')}
                                                                  onChange={e => changeData({shape: e.target.value})}>
                                <option value="rectangle">{t('canvas.rectangle')}</option>
                                <option value="ellipse">{t('canvas.ellipse')}</option>
                            </select></label>
                            <button onClick={clearSelection}>{t('canvas.select')}</button>
                        </>
                        : text ? <><span>{t('canvas.textBlock')}</span><label>{t('common.textSize')}<TextSizeInput
                                key={chosen[0].id}
                                value={Number(chosen[0].data.fontSize) || 18}
                                onChange={fontSize => changeData({fontSize})}/></label>
                                <button onClick={clearSelection}>{t('canvas.select')}</button>
                            </>
                            : drawing ? <><span>{t('canvas.drawing')}</span><label>{t('canvas.drawingColor')}<input
                                    type="color" value={String(chosen[0].data.color || '#81ad9b')}
                                    onChange={e => changeData({color: e.target.value})}/></label>
                                    <button onClick={clearSelection}>{t('canvas.select')}</button>
                                </>
                                : <>{[[MousePointer2, t('canvas.select'), 'select'], [Hand, t('canvas.pan'), 'pan'], [StickyNote, t('canvas.noteCard'), 'note'], [Type, t('canvas.textBlock'), 'text'], [Pencil, t('canvas.draw'), 'draw'], [Square, t('canvas.shape'), 'shape'], [GitBranch, t('canvas.connections'), 'connect'], [Image, t('media.image'), 'image']].map(([Icon, label, key]) => {
                                    const I = Icon as typeof Hand;
                                    return <button key={String(key)} title={String(label)} aria-label={String(label)}
                                                   ref={key === 'note' ? noteButton : undefined}
                                                   aria-expanded={key === 'note' ? choose : undefined}
                                                   aria-controls={key === 'note' && choose ? notePickerId : undefined}
                                                   aria-pressed={tool === key} onClick={() => {
                                        if (key === 'note') setChoose(v => !v); else if (key === 'image') input.current?.click(); else if (key === 'shape' || key === 'text') add(String(key)); else setTool(String(key));
                                    }}><I size={18}/></button>;
                                })}</>}
            <i/>
            <button aria-label={t('canvas.fromImageLibrary')} title={t('canvas.fromImageLibrary')}
                    onClick={() => setLibrary(true)}><Image size={18}/></button>
            <button title={t('canvas.groupSelection')} aria-label={t('canvas.groupSelection')}
                    disabled={chosen.filter(n => !n.parentId).length < 2} onClick={group}><Group size={18}/></button>
            {chosen.some(n => n.type === 'group') && <button onClick={() => {
                const ids = new Set(chosen.filter(n => n.type === 'group').map(n => n.id));
                update({
                    nodes: nodes.filter(n => !ids.has(n.id)).map(n => ids.has(n.parentId || '') ? {
                        ...n,
                        parentId: undefined,
                        position: {
                            x: n.position.x + (nodes.find(p => p.id === n.parentId)?.position.x || 0),
                            y: n.position.y + (nodes.find(p => p.id === n.parentId)?.position.y || 0)
                        }
                    } : n)
                });
            }}>{t('canvas.ungroup')}</button>}
            <details>
                <summary aria-label={t('canvas.layers')}><Layers size={18}/></summary>
                <div className="popup">{nodes.length ? nodes.map(n => <div className="layer" key={n.id}>
                    <button onClick={() => {
                        update({nodes: nodes.map(x => ({...x, selected: x.id === n.id}))});
                        flow.fitView({nodes: [n], duration: 200});
                    }}>{n.data.kind === 'note' ? workspace.notes.find(x => x.id === n.data.noteId)?.title || t('notes.kind') : n.type === 'group' ? t('canvas.group') : ({
                        text: t('canvas.text'),
                        shape: t('canvas.shape'),
                        drawing: t('canvas.drawing'),
                        image: t('media.image')
                    } as Record<string, string>)[String(n.data.kind)] || t('canvas.object')}</button>
                    <button title={t('canvas.bringToFront')} aria-label={t('canvas.bringToFront')}
                            onClick={() => update({
                                nodes: nodes.map(x => x.id === n.id ? {
                                    ...x,
                                    zIndex: Math.max(0, ...nodes.map(y => y.zIndex || 0)) + 1
                                } : x)
                            })}>↑
                    </button>
                    <button aria-label={t('canvas.sendToBack')} title={t('canvas.sendToBack')}
                            onClick={() => layerOrder(n.id, 'back')}>↓
                    </button>
                    <button aria-label={n.hidden ? t('canvas.showLayer') : t('canvas.hideLayer')}
                            onClick={() => update({
                                nodes: nodes.map(x => x.id === n.id ? {
                                    ...x,
                                    hidden: !x.hidden
                                } : x)
                            })}>{n.hidden ? '◉' : '○'}</button>
                    <button aria-label={n.data.locked ? t('canvas.unlockLayer') : t('canvas.lockLayer')}
                            onClick={() => update({
                                nodes: nodes.map(x => x.id === n.id ? {
                                    ...x,
                                    draggable: !!x.data.locked,
                                    data: {...x.data, locked: !x.data.locked}
                                } : x)
                            })}>{n.data.locked ? t('canvas.unlock') : t('canvas.lock')}</button>
                </div>) : <p>{t('canvas.noObjectsYet')}</p>}</div>
            </details>
            <button title={t('canvas.deleteSelectionShortcut')} aria-label={t('canvas.deleteSelected')}
                    disabled={!chosen.length && !edge}
                    onClick={remove}><Trash2 size={18}/></button>
            <i/>
            <button aria-label={t('canvas.zoomOut')} onClick={() => flow.zoomOut()}><ZoomOut size={18}/></button>
            <span className="zoom-value">{Math.round(board.viewport.zoom * 100)}%</span>
            <button aria-label={t('canvas.zoomIn')} onClick={() => flow.zoomIn()}><ZoomIn size={18}/></button>
            <button aria-label={t('canvas.fitAll')} title={t('canvas.fitAll')}
                    onClick={() => flow.fitView({padding: .2})}><Maximize
                size={18}/></button>
        </div>
        <CollaborationStatus channel={collaboration.channel} awareness={collaboration.session.awareness}/>
        {choose && <div className="board-note-picker" ref={notePicker} id={notePickerId}
                        role="region" aria-label={t('canvas.noteCard')}>
            <NoteLinkPicker workspace={workspace} emptyMessage={t('canvas.notePickerEmpty')} choose={note => {
                add('note', {noteId: note.id});
                setChoose(false);
            }}/>
        </div>}
        <div className="canvas-area" onDragOver={event => {
            if (isFolderDrag(event.dataTransfer)) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'none';
                setNotePreview(null);
                return;
            }
            if (!isNoteDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            const source = draggedNote(event.dataTransfer, workspace);
            const position = flow.screenToFlowPosition({x: event.clientX, y: event.clientY});
            setNotePreview(source ? {id: source.id, ...position} : null);
        }} onDragLeave={event => {
            if (!(event.relatedTarget instanceof globalThis.Node) || !event.currentTarget.contains(event.relatedTarget))
                setNotePreview(null);
        }} onDrop={event => {
            setNotePreview(null);
            if (isFolderDrag(event.dataTransfer)) {
                event.preventDefault();
                return;
            }
            if (!isNoteDrag(event.dataTransfer)) return;
            event.preventDefault();
            const source = draggedNote(event.dataTransfer, workspace);
            if (!source) return;
            update({
                nodes: [...nodes, {
                    id: uid(), type: 'object',
                    position: flow.screenToFlowPosition({x: event.clientX, y: event.clientY}),
                    data: {kind: 'note', noteId: source.id}, style: {width: 300}
                }]
            });
            setTool('select');
        }} onPointerMove={event => collaboration.pointer(flow.screenToFlowPosition({
            x: event.clientX,
            y: event.clientY
        }))} onPointerLeave={() => collaboration.pointer(null)}><BoardContext.Provider
            value={{workspace, openNote, collaboration}}><ReactFlow nodes={nodes.map(node => ({
            ...node,
            draggable: tool === 'select' && !node.data.locked && !collaboration.foreignLock(node.id),
            deletable: !collaboration.foreignLock(node.id)
        }))}
                                                                    edges={board.edges}
                                                                    nodeTypes={nodeTypes}
                                                                    onNodesChange={changes => update(current => ({nodes: applyNodeChanges(changes, current.nodes)}))}
                                                                    onEdgesChange={changes => update(current => ({edges: applyEdgeChanges(changes, current.edges)}))}
                                                                    onNodeDragStart={(_, node) => {
                                                                        void collaboration.claim(node.id);
                                                                    }}
                                                                    onNodeDragStop={(_, node) => collaboration.release(node.id)}
                                                                    onConnect={connection => update({
                                                                        edges: addEdge({
                                                                            ...connection,
                                                                            markerEnd: {
                                                                                type: MarkerType.ArrowClosed,
                                                                                color: '#81ad9b'
                                                                            },
                                                                            style: {
                                                                                stroke: '#81ad9b',
                                                                                strokeWidth: 2
                                                                            }
                                                                        }, board.edges)
                                                                    })}
                                                                    defaultViewport={board.viewport}
                                                                    onMoveEnd={(_, v: Viewport) => update({viewport: v})}
                                                                    minZoom={.15}
                                                                    maxZoom={3}
                                                                    connectionMode={ConnectionMode.Loose}
                                                                    panOnDrag={tool === 'pan' ? [0, 1] : [1]}
                                                                    selectionOnDrag={tool === 'select'}
                                                                    nodesDraggable={tool === 'select'}
                                                                    nodesConnectable={tool === 'connect' || tool === 'select'}
                                                                    colorMode={workspace.theme}
                                                                    deleteKeyCode={['Backspace', 'Delete']}><Background
            variant={BackgroundVariant.Dots} gap={24} size={1} color="var(--grid)"/>
            {notePreview && previewNote && <ViewportPortal>
                <div className="board-object note board-drop-preview"
                     aria-hidden="true"
                     style={{transform: `translate(${notePreview.x}px, ${notePreview.y}px)`, width: 300}}>
                    <span className="object-label">{t('notes.kind')}</span>
                    <div className="card-title">{previewNote.title || t('notes.untitled')}</div>
                    <NoteContent note={previewNote} workspace={workspace}/>
                </div>
            </ViewportPortal>}
        </ReactFlow><CanvasPresence
            awareness={collaboration.session.awareness}/></BoardContext.Provider>
            {tool === 'draw' && <svg className="draw-overlay" onPointerDown={e => {
                e.currentTarget.setPointerCapture(e.pointerId);
                const bounds = e.currentTarget.getBoundingClientRect();
                points.current = [{x: e.clientX - bounds.left, y: e.clientY - bounds.top}];
            }} onPointerMove={e => {
                if (!e.buttons || !points.current.length) return;
                const bounds = e.currentTarget.getBoundingClientRect();
                points.current.push({x: e.clientX - bounds.left, y: e.clientY - bounds.top});
                setPath(points.current.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' '));
            }} onPointerUp={e => {
                const p = points.current;
                if (p.length > 1) {
                    const bounds = e.currentTarget.getBoundingClientRect();
                    const padding = 1.5; // Include the full 3px stroke in the object's bounds.
                    const minX = Math.min(...p.map(v => v.x)) - padding,
                        minY = Math.min(...p.map(v => v.y)) - padding;
                    const width = Math.max(...p.map(v => v.x)) + padding - minX,
                        height = Math.max(...p.map(v => v.y)) + padding - minY;
                    const pos = flow.screenToFlowPosition({x: bounds.left + minX, y: bounds.top + minY});
                    const zoom = flow.getZoom();
                    update({
                        nodes: [...nodes, {
                            id: uid(),
                            type: 'object',
                            position: pos,
                            data: {
                                kind: 'drawing',
                                path: p.map((v, i) => `${i ? 'L' : 'M'}${v.x - minX},${v.y - minY}`).join(' '),
                                viewBoxWidth: width,
                                viewBoxHeight: height
                            },
                            style: {width: width / zoom, height: height / zoom}
                        }]
                    });
                }
                points.current = [];
                setPath('');
            }}>
                <path d={path} stroke="var(--accent)" strokeWidth="3" fill="none" strokeLinecap="round"/>
            </svg>}
            <div
                className={`canvas-hint ${tool === 'draw' || tool === 'connect' || tool === 'pan' ? '' : 'desktop-input-hint'}`}>{tool === 'draw' ? t('canvas.drawWithAMouseOrTouch') : tool === 'connect' ? t('canvas.connectHandlesOnObjectEdges') : tool === 'pan' ? t('canvas.dragTheCanvasToPan') : t('canvas.shiftSelectMultipleObjectsWheelZoom')}</div>
        </div>
        {library && <AttachmentPicker attachments={workspace.attachments} imagesOnly close={() => setLibrary(false)}
                                      choose={a => {
                                          add('image', {src: a.data, alt: a.name});
                                          setLibrary(false);
                                      }}/>}
        <input ref={input} hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async e => {
            const f = e.target.files?.[0];
            if (f) {
                try {
                    add('image', {src: await attach(f), alt: f.name});
                } catch (err) {
                    setError(toError(err));
                }
            }
            e.target.value = '';
        }}/>{error && <div role="alert" className="error">{errorText(error)}
        <button onClick={() => setError('')}>{t('common.close')}</button>
    </div>}</>;
}
