import {t, useLanguage} from './i18n';
import {type ReactNode, useEffect, useRef} from 'react';
import {MoreHorizontal, X} from 'lucide-react';

export function TreeActions({label, children}: { label: string; children: ReactNode }) {
    return <details className="tree-actions">
        <summary aria-label={label} title={label}><MoreHorizontal size={14}/></summary>
        <div className="popup right tree-popup" onClick={e => {
            if ((e.target as Element).closest('button')) {
                const details = e.currentTarget.closest('details')!;
                details.open = false;
                details.querySelector('summary')?.focus();
            }
        }}>{children}</div>
    </details>;
}

export function Modal({title, children, close}: { title: string; children: ReactNode; close: () => void }) {
    useLanguage();
    const ref = useRef<HTMLDialogElement>(null);
    useEffect(() => {
        const d = ref.current!;
        d.showModal();
        return () => d.close();
    }, []);
    return <dialog ref={ref} onCancel={close} onClick={e => {
        if (e.target === e.currentTarget) close();
    }}>
        <header><h2>{title}</h2>
            <button onClick={close} aria-label={t('common.close')}><X size={18}/></button>
        </header>
        {children}</dialog>;
}
