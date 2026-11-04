import {describe, expect, it} from 'vitest';
import {parseMedia, safeMedia} from '../src/media';
import {initialWorkspace, textOf, validateWorkspace} from '../src/model';

describe('media boundaries', () => {
    it.each(['https://youtu.be/dQw4w9WgXcQ?t=1m30s', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=90', 'https://www.youtube.com/shorts/dQw4w9WgXcQ?start=90'])('normalizes video %s', url => {
        expect(parseMedia(url)).toMatchObject({provider: 'youtube', externalId: 'dQw4w9WgXcQ', start: 90});
    });
    it('accepts playlists and all six supported Spotify resources', () => {
        expect(parseMedia('https://www.youtube.com/playlist?list=PLabcdefghijk')).toMatchObject({contentType: 'playlist'});
        for (const kind of ['track', 'album', 'playlist', 'artist', 'show', 'episode']) expect(parseMedia(`https://open.spotify.com/${kind}/0123456789abcdefghijkl`)).toMatchObject({
            provider: 'spotify',
            contentType: kind
        });
    });
    it.each(['javascript:alert(1)', 'https://youtube.com.attacker.example/watch?v=dQw4w9WgXc', 'https://evil@youtube.com/watch?v=dQw4w9WgXc', 'http://youtu.be/dQw4w9WgXc', 'https://open.spotify.com/evil/0123456789abcdefghijkl', 'https://youtube.com:888/watch?v=dQw4w9WgXc'])('rejects %s', url => expect(parseMedia(url)).toBeNull());
    it('revalidates imported media rather than trusting iframe source', () => {
        expect(safeMedia({
            provider: 'youtube',
            externalId: 'bad',
            canonicalUrl: 'https://youtu.be/dQw4w9WgXc'
        })).toBeNull();
    });
});
describe('workspace portability', () => {
    it('rejects duplicate ids, unsafe media and executable imported links', () => {
        const duplicate = initialWorkspace();
        duplicate.notes.push(structuredClone(duplicate.notes[0]));
        expect(() => validateWorkspace(duplicate)).toThrow('errors.duplicateOrInvalidIdentifier');
        const media = initialWorkspace();
        media.notes[0].content.content!.push({
            type: 'media',
            attrs: {provider: 'youtube', externalId: 'dQw4w9WgXcQ', canonicalUrl: 'https://attacker.example/embed'}
        });
        expect(() => validateWorkspace(media)).toThrow('errors.unsafeOrInvalidMediaBlock');
        const link = initialWorkspace();
        link.notes[0].content.content!.push({
            type: 'paragraph',
            content: [{type: 'text', text: 'unsafe', marks: [{type: 'link', attrs: {href: 'javascript:alert(1)'}}]}]
        });
        expect(() => validateWorkspace(link)).toThrow('errors.unsafeLink');
    });
    it('rejects malformed canvas parent cycles and preserves safe short metadata', () => {
        const bad = initialWorkspace();
        bad.boards[0].nodes[0].parentId = bad.boards[0].nodes[0].id;
        expect(() => validateWorkspace(bad)).toThrow('errors.invalidCanvasGroup');
        const m = parseMedia('https://www.youtube.com/shorts/dQw4w9WgXcQ')!;
        expect(safeMedia(m)?.contentType).toBe('short');
    });
    it('round-trips structured media and never adds a frame to previews', () => {
        const w = initialWorkspace();
        w.notes[0].content.content!.push({type: 'media', attrs: parseMedia('https://youtu.be/dQw4w9WgXcQ')!});
        const copy = validateWorkspace(JSON.parse(JSON.stringify(w)));
        expect(copy.notes[0].content).toEqual(w.notes[0].content);
        expect(textOf(copy.notes[0].content)).toContain('[YouTube]');
        expect(textOf(copy.notes[0].content)).not.toContain('<iframe');
    });
    it('rejects cycles and unrecognized executable nodes', () => {
        const w = initialWorkspace();
        w.folders[0].parentId = w.folders[0].id;
        expect(() => validateWorkspace(w)).toThrow('errors.folderCycle');
        w.folders = [];
        w.notes[0].folderId = null;
        w.notes[0].content = {type: 'doc', content: [{type: 'script'}]};
        expect(() => validateWorkspace(w)).toThrow('errors.unknownBlockType');
    });
});
