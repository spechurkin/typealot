import {createContext} from 'react';
import type {Attachment} from './model';
import {LocalizedError} from './i18n';
import {fileData} from './storage';

export const AttachmentContext = createContext<Attachment[]>([]);

export function splitFilename(name: string) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? {base: name.slice(0, dot), extension: name.slice(dot)} : {base: name, extension: ''};
}

export function renameAttachment(name: string, newBase: string) {
    const {extension} = splitFilename(name);
    let base = newBase.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '');
    if (extension && base.toLowerCase().endsWith(extension.toLowerCase())) base = base.slice(0, -extension.length).trim();
    if (!base) throw new LocalizedError('errors.invalidFilename');
    return base.slice(0, 160) + extension;
}

export async function prepareAttachment(file: File): Promise<Omit<Attachment, 'id'>> {
    if (!file.type.startsWith('image/')) return {name: file.name, mime: file.type, data: await fileData(file)};
    const url = URL.createObjectURL(file);
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error();
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error()), 'image/jpeg', 0.82));
        if (blob.type !== 'image/jpeg') throw new Error();
        return {
            name: splitFilename(file.name).base + '.jpg',
            mime: blob.type,
            data: await fileData(new File([blob], 'image.jpg', {type: blob.type}))
        };
    } catch {
        throw new LocalizedError('errors.imageConversion');
    } finally {
        URL.revokeObjectURL(url);
    }
}
