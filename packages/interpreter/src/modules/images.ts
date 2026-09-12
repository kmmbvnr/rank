import { RankError } from '../errors.js';
import { isRankArray, isRankObject, type RankArray, type RankValue } from '../value.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const imagesModule: RuntimeModule = {
    images: context => native('images', 1, ([directory]) => {
        if (typeof directory !== 'string') throw new RankError('images expects a directory path', 'TypeError');
        const io = context.io;
        if (!io?.listImages) throw new RankError('image access is unavailable in this host');
        const files = io.listImages(directory);
        const items: RankValue[] = files.map(({ name, path }) => ({
            kind: 'object',
            entries: new Map<string, RankValue>([['name', name], ['path', path]]),
        }));
        return { kind: 'array', items, shape: [items.length] };
    }),
    resize: context => native('resize', 3, ([source, height, width]) => {
        if (!isRankArray(source) || source.shape.length !== 1) {
            throw new RankError('resize expects a rank-1 image table', 'DimensionMismatch');
        }
        if (typeof height !== 'bigint' || typeof width !== 'bigint'
            || height <= 0n || width <= 0n
            || height > BigInt(Number.MAX_SAFE_INTEGER)
            || width > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new RankError('resize dimensions must be positive integers', 'DomainError');
        }
        const paths = source.items.map(item => {
            if (!isRankObject(item) || typeof item.entries.get('path') !== 'string') {
                throw new RankError('resize expects image rows with text paths', 'TypeError');
            }
            return item.entries.get('path') as string;
        });
        const h = Number(height);
        const w = Number(width);
        const size = paths.length * h * w * 3;
        if (!Number.isSafeInteger(size)) throw new RankError('image tensor is too large', 'DomainError');
        const io = context.io;
        if (!io?.resizeImages) throw new RankError('image decoding is unavailable in this host');
        const pixels = io.resizeImages(paths, h, w);
        if (pixels.length !== size) throw new RankError('image decoder returned an unexpected pixel count');
        let materialized: RankValue[] | undefined;
        return {
            kind: 'array',
            shape: [paths.length, h, w, 3],
            itemAt: index => BigInt(pixels[index]),
            get items() {
                materialized ??= Array.from(pixels, byte => BigInt(byte));
                return materialized;
            },
        } as RankArray;
    }),
};
