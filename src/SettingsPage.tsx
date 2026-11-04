import {type ReactNode, useRef, useState} from 'react';
import {t, useLanguage, type TranslationKey} from './i18n';

const categories: Array<{ id: string; title: TranslationKey }> = [
    {id: 'settings-appearance', title: 'settings.appearance'},
    {id: 'settings-profile', title: 'profile.title'},
    {id: 'settings-editing', title: 'workspace.editing'},
    {id: 'settings-transfer', title: 'workspace.backupsAndTransfer'},
    {id: 'settings-sync', title: 'sync.title'},
    {id: 'settings-backups', title: 'sync.automaticBackups'}
];

export default function SettingsPage({children}: { children: ReactNode }) {
    useLanguage();
    const content = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(categories[0].id);
    const updateActive = () => {
        const scroller = content.current;
        if (!scroller) return;
        const top = scroller.getBoundingClientRect().top;
        let current = categories[0].id;
        for (const category of categories) {
            const section = scroller.querySelector<HTMLElement>(`#${category.id}`);
            if (section && section.getBoundingClientRect().top <= top + 40) current = category.id;
        }
        if (scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
            current = categories[categories.length - 1].id;
        }
        setActive(current);
    };
    return <div className="settings-layout">
        <nav className="settings-navigation" aria-label={t('settings.categories')}>
            {categories.map(category => <a key={category.id} href={`#${category.id}`}
                                           aria-current={active === category.id ? 'location' : undefined}
                                           onClick={event => {
                                               event.preventDefault();
                                               const scroller = content.current;
                                               const section = scroller?.querySelector<HTMLElement>(`#${category.id}`);
                                               if (!scroller || !section) return;
                                               scroller.scrollTop += section.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 28;
                                               section.focus({preventScroll: true});
                                               updateActive();
                                           }}>{t(category.title)}</a>)}
        </nav>
        <div ref={content} className="utility-page settings" onScroll={updateActive}>
            <h1>{t('nav.settings')}</h1>
            {children}
        </div>
    </div>;
}
