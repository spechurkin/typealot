import {describe, expect, it} from 'vitest';
import {hashtagsIn, matchesHashtag} from '../src/hashtags';

describe('hashtags', () => {
    it('recognizes Unicode tags and punctuation, excluding URL fragments and embedded hashes', () => {
        expect(hashtagsIn('#заметки, (#Café) #план_2026! #中文 #е\u0308ж https://site.test/#anchor word#no ##heading #').map(tag => tag.text))
            .toEqual(['#заметки', '#Café', '#план_2026', '#中文', '#е\u0308ж']);
    });
    it('matches whole tags across formatting, case and normalization, without joining paragraphs', () => {
        const content = {
            type: 'doc', content: [
                {
                    type: 'paragraph',
                    content: [{type: 'text', text: '#За'}, {type: 'text', text: 'метки', marks: [{type: 'bold'}]}]
                },
                {type: 'paragraph', content: [{type: 'text', text: '#cafe\u0301'}]},
                {type: 'paragraph', content: [{type: 'text', text: '#дру'}]},
                {type: 'paragraph', content: [{type: 'text', text: 'гое'}]}
            ]
        };
        expect(matchesHashtag(content, '#заметки')).toBe(true);
        expect(matchesHashtag(content, '#café')).toBe(true);
        expect(matchesHashtag(content, '#заметка')).toBe(false);
        expect(matchesHashtag(content, '#другое')).toBe(false);
    });
    it('excludes code and explicit hyperlinks', () => {
        for (const marks of [[{type: 'code'}], [{type: 'link', attrs: {href: 'https://example.com'}}]]) {
            expect(matchesHashtag({
                type: 'paragraph',
                content: [{type: 'text', text: '#hidden', marks}]
            }, '#hidden')).toBe(false);
        }
        expect(matchesHashtag({type: 'codeBlock', content: [{type: 'text', text: '#hidden'}]}, '#hidden')).toBe(false);
    });
});
