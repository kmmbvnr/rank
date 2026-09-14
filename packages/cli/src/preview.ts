import {
    formatValue, isRankArray, isRankSequence, isRankSequenceMask,
    type RankArray, type RankValue,
} from '@rank/interpreter';

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

/** What stands in for the items a preview left out. */
const DOTS = '...';

/**
 * A value as the REPL shows it, on one line no wider than `width`.
 *
 * A result is an answer to look at, not output to keep, so a long one is cut to
 * its two ends. That matters most for what the language makes easy: a sequence
 * may be unbounded, and printing it in full is at best unreadable and at worst
 * never finishes. A value that wraps over four rows of a narrow screen is no
 * more readable than one that never ends, which is why the width cuts as well
 * as the count. Unknown sizes get a bounded head; known finite sequences
 * are scanned up to SCAN_LIMIT to retain both ends.
 */
export function preview(value: RankValue, width = Infinity): Preview {
    if (typeof value === 'string') return textPreview([...value], value, width);
    if (isRankArray(value) && value.kind === 'array') return arrayPreview(value, width);
    if (typeof value === 'object' && value.kind === 'queue') {
        return listPreview(value.items.length, index => value.items[index], 'values', width);
    }
    if (isRankSequenceMask(value)) {
        return sequencePreview(
            value.source.plan,
            item => value.predicate.test(item),
            width,
        );
    }
    if (isRankSequence(value)) return sequencePreview(value.plan, item => item, width);
    const text = formatValue(value);
    return textPreview([...text], text, width);
}

/** Characters rather than items, so the cut is one end and a count. */
function textPreview(characters: readonly string[], text: string, width: number): Preview {
    const limit = Math.min(PREVIEW_TEXT, width);
    if (characters.length <= limit) return { text, note: '' };
    const kept = Math.max(1, limit - DOTS.length - 1);
    return {
        text: `${characters.slice(0, kept).join('')} ${DOTS}`,
        note: `${characters.length} characters`,
    };
}

function arrayPreview(value: RankArray, width: number): Preview {
    const count = value.shape.reduce((total, axis) => total * axis, 1);
    // A lazy array computes on demand, so only the shown items are asked for.
    const at = value.itemAt ?? ((index: number) => value.items[index]);
    const note = value.shape.length > 1 ? `shape ${value.shape.join(' ')}` : 'values';
    return listPreview(count, at, note, width);
}

/**
 * One line of at most `width` characters. What does not fit is dropped from the
 * middle: both ends of a value are what identify it, and the middle of a long
 * one says the least. `gap` marks two lists that already have items missing
 * between them, where the dots stand whether the width cuts or not.
 */
function fit(
    head: readonly string[],
    tail: readonly string[],
    width: number,
    gap: boolean,
): { text: string; cut: boolean } {
    const line = (front: readonly string[], back: readonly string[]): string =>
        [...front, DOTS, ...back].join(' ');
    if (gap) {
        if (line(head, tail).length <= width) return { text: line(head, tail), cut: false };
    } else {
        const whole = [...head, ...tail].join(' ');
        if (whole.length <= width) return { text: whole, cut: false };
    }
    // A value with no gap of its own is one list, opened in the middle.
    const items = gap ? undefined : [...head, ...tail];
    const half = items === undefined ? 0 : Math.ceil(items.length / 2);
    const front = items === undefined ? [...head] : items.slice(0, half);
    const back = items === undefined ? [...tail] : items.slice(half);
    while (front.length + back.length > 1 && line(front, back).length > width) {
        if (front.length > back.length) front.pop();
        else back.shift();
    }
    return { text: line(front, back), cut: true };
}

function sequencePreview(
    plan: {
        readonly size: { readonly kind: string; readonly value?: bigint };
        iterate(): IterableIterator<RankValue>;
    },
    map: (item: RankValue) => RankValue,
    width: number,
): Preview {
    if (plan.size.kind !== 'exact') {
        // Without a known size, take a bounded head; finding the end may never finish.
        const head = take(plan, map, edge());
        const line = fit(head.items, [], width, !head.whole);
        return {
            text: line.text,
            note: head.whole ? (line.cut ? `${head.items.length} values` : '')
                : plan.size.kind === 'infinite' ? 'unbounded' : 'size unknown',
        };
    }
    const { head, tail, count, whole } = scan(plan, map);
    const shown = head.map(item => formatValue(item));
    if (whole && count <= PREVIEW_ITEMS) {
        const line = fit([...shown, ...tail.map(item => formatValue(item))], [], width, false);
        return { text: line.text, note: line.cut ? `${count} values` : '' };
    }
    if (!whole) {
        return { text: fit(shown, [], width, true).text, note: `over ${SCAN_LIMIT} values` };
    }
    const ending = tail.map(item => formatValue(item));
    return { text: fit(shown, ending, width, true).text, note: `${count} values` };
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
): { items: string[]; whole: boolean } {
    const shown: string[] = [];
    for (const item of plan.iterate()) {
        shown.push(formatValue(map(item)));
        if (shown.length >= count) return { items: shown, whole: false };
    }
    return { items: shown, whole: true };
}

function listPreview(
    count: number,
    at: (index: number) => RankValue,
    note: string,
    width: number,
): Preview {
    const items = (from: number, to: number): string[] => {
        const shown: string[] = [];
        for (let index = from; index < to; index += 1) shown.push(formatValue(at(index)));
        return shown;
    };
    if (count <= PREVIEW_ITEMS) {
        const line = fit(items(0, count), [], width, false);
        if (!line.cut) return { text: line.text, note: note === 'values' ? '' : note };
        return { text: line.text, note: counted(note, count) };
    }
    const line = fit(items(0, edge()), items(count - edge(), count), width, true);
    return { text: line.text, note: counted(note, count) };
}

/** The note for a value that was cut: what it is, then how much of it there is. */
function counted(note: string, count: number): string {
    return note === 'values' ? `${count} values` : `${note}, ${count} values`;
}

function edge(): number {
    return PREVIEW_ITEMS / 2;
}
