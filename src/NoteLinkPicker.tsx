import {type ReactNode, useId, useState} from 'react';
import {ChevronDown, ChevronRight, FileText, Folder} from 'lucide-react';
import {t, useLanguage} from './i18n';
import type {Note, Workspace} from './model';

export default function NoteLinkPicker({workspace, currentNoteId, choose, emptyMessage}: {
    workspace: Workspace;
    currentNoteId?: string;
    choose: (note: Note) => void;
    emptyMessage?: string;
}) {
    useLanguage();
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const id = useId();
    const notes = workspace.notes.filter(note => note.id !== currentNoteId);
    const branch = (parentId: string | null): ReactNode => <>
        {workspace.folders.filter(folder => folder.parentId === parentId).map(folder => {
            const expanded = !collapsed.has(folder.id);
            const contentsId = `${id}-${folder.id}`;
            return <div className="note-choice-folder" key={folder.id}>
                <button type="button" aria-expanded={expanded} aria-controls={contentsId}
                        onClick={() => setCollapsed(previous => {
                            const next = new Set(previous);
                            next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id);
                            return next;
                        })}>
                    {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                    <Folder size={16}/><span>{folder.name}</span>
                </button>
                <div id={contentsId} className="note-choice-children" hidden={!expanded}>
                    {branch(folder.id)}
                </div>
            </div>;
        })}
        {notes.filter(note => note.folderId === parentId).map(note =>
            <button type="button" className="note-choice" key={note.id} onClick={() => choose(note)}>
                <FileText size={16}/><span>{note.title || t('notes.untitled')}</span>
            </button>)}
    </>;
    return <div className="note-choices">
        {notes.length ? branch(null) : <p>{emptyMessage || t('editor.noteLinkEmpty')}</p>}
    </div>;
}
