import type {Schema} from '@tiptap/pm/model';
import type * as Y from 'yjs';
import type {Note} from '../src/storage/model';

export function canonical(value: unknown): string;

export function generationOf(note: Note): string;

export function encode(bytes: Uint8Array): string;

export function decode(text: string): Uint8Array;

export function createNoteDocument(note: Note, schema: Schema): { doc: Y.Doc; generation: string };

export function noteSnapshot(note: Note, doc: Y.Doc, generation: string): Note;

export function mergeNotes(local: Note, remote: Note): Note | null;

export function replaceText(text: Y.Text, value: string, origin?: unknown): void;

export function assertDocument(content: unknown): void;

export function assertCollaboration(note: Note): void;
