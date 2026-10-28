import { RankError } from './errors.js';
import { checkpoint } from './interrupt.js';
import { isRankArray, type RankValue } from './value.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
const byteChars: string[] = [];
const charBytes = new Map<string, number>();
let extra = 256;
for (let byte = 0; byte < 256; byte++) {
    const visible = byte >= 33 && byte <= 126 || byte >= 161 && byte <= 172 || byte >= 174;
    const character = String.fromCodePoint(visible ? byte : extra++);
    byteChars[byte] = character;
    charBytes.set(character, byte);
}
// GPT-2's regex uses Unicode White_Space; JavaScript's \s has a different set.
const pieces = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\p{White_Space}\p{L}\p{N}]+|\p{White_Space}+(?![^\p{White_Space}])|\p{White_Space}+/gu;
interface Codec {
    vocab: Map<string, number>;
    bytes: Map<number, Uint8Array>;
    ranks: Map<string, number>;
    specials: Map<string, number>;
    pattern?: RegExp;
    cache: Map<string, readonly bigint[]>;
}
let cached: { source: string; codec: Codec } | undefined;
function invalid(message: string): never { throw new RankError(`BPE tokenizer: ${message}`, 'InvalidTokenizer'); }
function object(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('expected an object');
    return value as Record<string, any>;
}
function codecFor(source: RankValue): Codec {
    if (typeof source !== 'string') throw new RankError('BPE tokenizer must be JSON text', 'TypeError');
    if (cached?.source === source) return cached.codec;
    let parsed: unknown;
    try { parsed = JSON.parse(source); } catch { invalid('invalid JSON'); }
    const config = object(parsed), model = object(config.model);
    if (config.normalizer != null || config.padding != null || config.truncation != null
        || config.pre_tokenizer?.type !== 'ByteLevel' || config.pre_tokenizer.add_prefix_space !== false
        || config.pre_tokenizer.use_regex === false || config.decoder?.type !== 'ByteLevel'
        || config.post_processor != null && config.post_processor.type !== 'ByteLevel'
        || model.type != null && model.type !== 'BPE' || model.dropout != null
        || model.unk_token != null || model.continuing_subword_prefix || model.end_of_word_suffix
        || model.fuse_unk || model.byte_fallback || model.ignore_merges) {
        invalid('requires unnormalized byte-level BPE without prefix space, padding, dropout or unknown tokens');
    }
    const vocab = new Map<string, number>(), bytes = new Map<number, Uint8Array>();
    const specials = new Map<string, number>(), ranks = new Map<string, number>();
    if (config.added_tokens != null && !Array.isArray(config.added_tokens)) invalid('added_tokens must be an array');
    for (const token of config.added_tokens ?? []) {
        if (!token || token.special !== true || token.single_word || token.lstrip || token.rstrip
            || typeof token.content !== 'string' || !token.content || !Number.isInteger(token.id) || token.id < 0 || token.id > 2147483647
            || specials.has(token.content)) invalid('unsupported added token');
        specials.set(token.content, token.id);
    }
    for (const [word, id] of Object.entries(object(model.vocab))) {
        checkpoint('loading BPE vocabulary');
        if (!word || typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id > 2147483647 || bytes.has(id)) invalid('invalid or duplicate vocabulary ID');
        vocab.set(word, id);
        const special = specials.get(word);
        if (special !== undefined) {
            if (special !== id) invalid('special token ID differs from vocabulary');
            bytes.set(id, encoder.encode(word));
        } else {
            const values = [...word].map(c => {
                const byte = charBytes.get(c);
                if (byte === undefined) invalid('vocabulary contains a non-byte symbol');
                return byte;
            });
            bytes.set(id, Uint8Array.from(values));
        }
    }
    for (const character of byteChars) if (!vocab.has(character)) invalid('vocabulary must cover all 256 bytes');
    for (const [word, id] of specials) if (vocab.get(word) !== id) invalid('special token must be present in vocabulary');
    if (!Array.isArray(model.merges)) invalid('merges must be an ordered array');
    for (const [rank, merge] of model.merges.entries()) {
        checkpoint('loading BPE merges');
        const pair = typeof merge === 'string' ? merge.split(' ') : merge;
        if (!Array.isArray(pair) || pair.length !== 2 || pair.some(p => typeof p !== 'string' || !vocab.has(p)) || !vocab.has(pair.join(''))) invalid('invalid merge');
        const key = pair.join(' ');
        if (ranks.has(key)) invalid('duplicate merge');
        ranks.set(key, rank);
    }
    const escaped = [...specials.keys()].sort((a, b) => b.length - a.length).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const codec: Codec = { vocab, bytes, ranks, specials, cache: new Map(), ...(escaped.length ? { pattern: new RegExp(escaped.join('|'), 'gu') } : {}) };
    cached = { source, codec };
    return codec;
}
function mergePiece(text: string, codec: Codec): readonly bigint[] {
    const found = codec.cache.get(text);
    if (found) return found;
    let symbols = Array.from(encoder.encode(text), byte => byteChars[byte]);
    while (symbols.length > 1) {
        let rank = Infinity, first = '', second = '';
        for (let i = 0; i < symbols.length - 1; i++) {
            checkpoint('merging BPE bytes');
            const candidate = codec.ranks.get(symbols[i] + ' ' + symbols[i + 1]);
            if (candidate !== undefined && candidate < rank) { rank = candidate; first = symbols[i]; second = symbols[i + 1]; }
        }
        if (rank === Infinity) break;
        const merged: string[] = [];
        for (let i = 0; i < symbols.length; i++) {
            if (symbols[i] === first && symbols[i + 1] === second) { merged.push(first + second); i++; }
            else merged.push(symbols[i]);
        }
        symbols = merged;
    }
    const ids = symbols.map(word => BigInt(codec.vocab.get(word)!));
    if (text.length <= 4096) {
        if (codec.cache.size >= 1024) codec.cache.delete(codec.cache.keys().next().value!);
        codec.cache.set(text, ids);
    }
    return ids;
}
export function bpeEncode(text: RankValue, source: RankValue): RankValue {
    if (typeof text !== 'string') throw new RankError('bpeencode expects text', 'TypeError');
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) throw new RankError('bpeencode requires well-formed Unicode', 'DomainError');
    const codec = codecFor(source), items: bigint[] = [];
    const normal = (value: string) => { for (const match of value.matchAll(pieces)) { checkpoint('encoding BPE text'); for (const id of mergePiece(match[0], codec)) items.push(id); } };
    let at = 0;
    if (codec.pattern) for (const match of text.matchAll(codec.pattern)) {
        normal(text.slice(at, match.index));
        items.push(BigInt(codec.specials.get(match[0])!));
        at = match.index! + match[0].length;
    }
    normal(text.slice(at));
    return { kind: 'array', shape: [items.length], items };
}
export function bpeDecode(value: RankValue, source: RankValue): string {
    if (!isRankArray(value) || value.shape.length !== 1) throw new RankError('bpedecode expects a rank-1 integer array', 'TypeError');
    const codec = codecFor(source), parts: Uint8Array[] = [];
    let length = 0;
    for (const id of value.items) {
        checkpoint('decoding BPE tokens');
        if (typeof id !== 'bigint' || id < 0n || id > 2147483647n || !codec.bytes.has(Number(id))) throw new RankError('bpedecode token ID is not in the vocabulary', 'DomainError');
        const part = codec.bytes.get(Number(id))!;
        parts.push(part); length += part.length;
    }
    const bytes = new Uint8Array(length);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    return decoder.decode(bytes);
}
