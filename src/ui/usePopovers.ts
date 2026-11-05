import {useEffect} from 'react';
import {autoUpdate, computePosition, flip, offset, shift} from '@floating-ui/dom';

export function usePopovers() {
    useEffect(() => {
        const cleanups = new Map<HTMLDetailsElement, () => void>();
        const toggle = (event: Event) => {
            const details = event.target;
            if (!(details instanceof HTMLDetailsElement)) return;
            cleanups.get(details)?.();
            cleanups.delete(details);
            if (!details.open) return;
            const anchor = details.querySelector('summary');
            const popup = details.querySelector<HTMLElement>('.popup');
            if (!anchor || !popup) return;
            const position = () => computePosition(anchor, popup, {
                strategy: 'fixed',
                placement: 'bottom-start',
                middleware: [offset(7), flip(), shift({padding: 10})]
            }).then(({x, y}) => {
                Object.assign(popup.style, {position: 'fixed', left: `${x}px`, top: `${y}px`, right: 'auto'});
            });
            cleanups.set(details, autoUpdate(anchor, popup, position));
        };
        const outside = (event: PointerEvent) => {
            document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(d => {
                if (!d.contains(event.target as globalThis.Node)) d.open = false;
            });
        };
        const keyboard = (event: KeyboardEvent) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const details = target.closest('details');
            if (!(details instanceof HTMLDetailsElement)) return;
            const popup = details.querySelector<HTMLElement>('.popup'), summary = details.querySelector('summary');
            if (!popup || !summary) return;
            const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
            if (target === summary && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
                event.preventDefault();
                details.open = true;
                queueMicrotask(() => buttons[event.key === 'ArrowDown' ? 0 : buttons.length - 1]?.focus());
                return;
            }
            if (!details.open) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                details.open = false;
                summary.focus();
                return;
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && popup.contains(target)) {
                event.preventDefault();
                const index = buttons.indexOf(target as HTMLButtonElement);
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
                buttons[next]?.focus();
            }
        };
        document.addEventListener('toggle', toggle, true);
        document.addEventListener('pointerdown', outside);
        document.addEventListener('keydown', keyboard);
        return () => {
            cleanups.forEach(fn => fn());
            document.removeEventListener('toggle', toggle, true);
            document.removeEventListener('pointerdown', outside);
            document.removeEventListener('keydown', keyboard);
        };
    }, []);
}
