export interface TextEdit {
    /** Replaced range of the previous text. */
    readonly from: number;
    readonly to: number;
    readonly text: string;
}

/**
 * The single edit that turns `previous` into `value`. A plain prefix/suffix diff is ambiguous
 * with repeated characters (deleting either `a` of `aa` looks the same), so the edit is anchored
 * at `caret`, where the field left its caret: the text after it is the unchanged suffix.
 */
export function textEdit(previous: string, value: string, caret?: number | null): TextEdit {
    let end = previous.length;
    let nextEnd = value.length;
    const anchored = caret ?? -1;
    const anchoredEnd = previous.length - (value.length - anchored);
    if (anchored >= 0 && anchored <= value.length && anchoredEnd >= 0
        && previous.slice(anchoredEnd) === value.slice(anchored)) {
        end = anchoredEnd;
        nextEnd = anchored;
    } else {
        let start = 0;
        while (start < previous.length && start < value.length && previous[start] === value[start]) start++;
        while (end > start && nextEnd > start && previous[end - 1] === value[nextEnd - 1]) { end--; nextEnd--; }
    }
    let start = 0;
    while (start < end && start < nextEnd && previous[start] === value[start]) start++;
    return { from: start, to: end, text: value.slice(start, nextEnd) };
}
