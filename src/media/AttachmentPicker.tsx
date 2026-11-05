import {t, useLanguage} from '../locales/i18n';
import {useState} from 'react';
import type {Attachment} from '../storage/model';
import {Modal} from '../ui/ui';

export default function AttachmentPicker({attachments, imagesOnly = false, choose, close}: {
    attachments: Attachment[];
    imagesOnly?: boolean;
    choose: (attachment: Attachment) => void;
    close: () => void
}) {
    useLanguage();
    const [query, setQuery] = useState('');
    const items = attachments.filter(a => (!imagesOnly || /^image\/(png|jpeg|gif|webp)$/.test(a.mime)) && a.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    return <Modal title={t('attachments.attachmentLibrary')} close={close}><label>{t('attachments.findFile')}<input
        type="search" autoFocus value={query} onChange={e => setQuery(e.target.value)}/></label>
        <div className="attachment-picker">{items.map(a => <button key={a.id}
                                                                   onClick={() => choose(a)}>{/^image\/(png|jpeg|gif|webp)$/.test(a.mime) ?
            <img src={a.data} width="64" height="48" alt=""/> :
            <span>{t('attachments.file')}</span>}<span>{a.name}</span></button>)}{!items.length &&
            <p>{query ? t('attachments.noFilesFound') : t('attachments.noMatchingFiles')}</p>}</div>
    </Modal>;
}
