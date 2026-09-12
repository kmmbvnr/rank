import {
    formatValue, isRankArray, isRankSequence, isRankSequenceMask,
    type RankArray, type RankValue,
} from 'rank-interpreter';

/** Items shown before a value is cut short. */
export const PREVIEW_ITEMS = 20;

/** Characters shown of one long text or opaque value. */
export const PREVIEW_TEXT = 200;

/**
 * How far a preview will walk a sequence to find its end. Beyond this the tail
 * is not worth the wait, and a plan whose size is unknown may have no end.
 */
export const SCAN_LIMIT = 100_000;

export interface Preview {
    readonly text: string;
    /** What was left out, ready to print under the value; empty when nothing was. */
    readonly note: string;
}

/**
 * A value as the REPL shows it.
 *
 * A result is an answer to look at, not output to keep, so a long one is cut to
 * its two ends. That matters most for what the language makes easy: a sequence
 * may be unbounded, and printing it in full is at best unreadable and at worst
 * never finishes. Nothing here iterates further than it prints, so previewing
 * costs strictly less than formatting did.
 */
export function preview(value: RankValue): Preview {
    if (typeof value === 'string') {
        const characters = [...value];
        if (characters.length <= PREVIEW_TEXT) return { text: value, note: '' };
        return {
            text: characters.slice(0, PREVIEW_TEXT).join('') + ' ...',
            note: `${characters.length} characters`,
        };
    }
    if (isRankArray(value) && value.kind === 'array') return arrayPreview(value);
    if (typeof value === 'object' && value.kind === 'queue') {
        return listPreview(value.items.length, index => value.items[index], 'values');
    }
    if (isRankSequenceMask(value)) {
        return sequencePreview(
            value.source.plan,
            item => value.predicate.test(item),
        );
    }
    if (isRankSequence(value)) return sequencePreview(value.plan, item => item);
    const text = formatValue(value);
    return text.length <= PREVIEW_TEXT
        ? { text, note: '' }
        : { text: `${text.slice(0, PREVIEW_TEXT)} ...`, note: `${text.length} characters` };
}

function arrayPreview(value: RankArray): Preview {
    const count = value.shape.reduce((total, axis) => total * axis, 1);
    // A lazy array computes on demand, so only the shown items are asked for.
    const at = value.itemAt ?? ((index: number) => value.items[index]);
    const note = value.shape.length > 1 ? `shape ${value.shape.join(' ')}` : 'values';
    return listPreview(count, at, note);
}

function sequencePreview(
    plan: {
        readonly size: { readonly kind: string; readonly value?: bigint };
        iterate(): IterableIterator<RankValue>;
    },
    map: (item: RankValue) => RankValue,
): Preview {
    if (plan.size.kind === 'infinite') {
        // An unbounded plan has no end to show, so take only a beginning.
        return { text: `${take(plan, map, edge()).join(' ')} ...`, note: 'unbounded' };
    }
    const { head, tail, count, whole } = scan(plan, map);
    if (whole && count <= PREVIEW_ITEMS) {
        return { text: [...head, ...tail].map(item => formatValue(item)).join(' '), note: '' };
    }
    const shown = head.map(item => formatValue(item));
    if (!whole) {
        return { text: `${shown.join(' ')} ...`, note: `over ${SCAN_LIMIT} values` };
    }
    const ending = tail.map(item => formatValue(item));
    return { text: [...shown, '...', ...ending].join(' '), note: `${count} values` };
}

/**
 * One pass that keeps both ends. A finite sequence has no index to seek with in
 * general, and walking it twice would consume a single-pass source twice, so
 * the last items ride along in a ring while the middle is dropped.
 */
function scan(
    plan: { iterate(): IterableIterator<RankValue> },
    map: (item: RankValue) => RankValue,
): { head: RankValue[]; tail: RankValue[]; count: number; whole: boolean } {
    const head: RankValue[] = [];
    const ring: RankValue[] = [];
    let count = 0;
    for (const item of plan.iterate()) {
        count += 1;
        if (count > SCAN_LIMIT) return { head, tail: [], count, whole: false };
        if (head.length < edge()) head.push(map(item));
        else {
            ring.push(map(item));
            if (ring.length > edge()) ring.shift();
        }
    }
    return { head, tail: ring, count, whole: true };
}

function take(
    plan: { iterate(): IterableIterator<RankValue> },
    map: (item: RankValue) => RankValue,
    count: number,
): string[] {
    const shown: string[] = [];
    for (const item of plan.iterate()) {
        if (shown.length >= count) break;
        shown.push(formatValue(map(item)));
    }
    return shown;
}

function listPreview(
    count: number,
    at: (index: number) => RankValue,
    note: string,
): Preview {
    const items = (from: number, to: number): string[] => {
        const shown: string[] = [];
        for (let index = from; index < to; index += 1) shown.push(formatValue(at(index)));
        return shown;
    };
    if (count <= PREVIEW_ITEMS) {
        return { text: items(0, count).join(' '), note: note === 'values' ? '' : note };
    }
    const text = [...items(0, edge()), '...', ...items(count - edge(), count)].join(' ');
    return { text, note: note === 'values' ? `${count} values` : `${note}, ${count} values` };
}

function edge(): number {
    return PREVIEW_ITEMS / 2;
}
