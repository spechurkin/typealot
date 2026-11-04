import type {Board} from '../src/model';

export type BoardPatch = {
    nodes: { remove: string[]; upsert: unknown[] };
    edges: { remove: string[]; upsert: unknown[] };
    title?: string
};

export function diffBoard(before: Board, after: Board): BoardPatch | null;

export function applyBoardPatch(board: Board, patch: BoardPatch): Board;
