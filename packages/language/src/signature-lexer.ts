import { DefaultLexer, type LexerResult, type TokenizeOptions } from 'langium';
import type { IToken } from 'chevrotain';
import type { FunctionCallSignature } from './function-call-signature.js';

interface Header {
    readonly right: readonly boolean[];
    readonly words: ReadonlySet<string>;
}
const symbolic = new Set(['+', '-', '*', '**', '/', '//', 'mod', 'and', 'or', 'xor',
    'equal', 'notequal', 'less', 'greater', 'atleast', 'atmost']);
const lowercase = (token: IToken | undefined) => !!token && /^[a-z][A-Za-z0-9_]*$/.test(token.image);
const uppercase = (token: IToken | undefined) => !!token && /^[A-Z][A-Za-z0-9_]*$/.test(token.image);
const newline = (token: IToken | undefined) => token?.tokenType.name === 'NL' || token?.tokenType.name === 'REM_COMMENT';

/** Retain keyword/operator tokens everywhere except a position declared by a call signature. */
export class SignatureLexer extends DefaultLexer {
    signatures: ReadonlyMap<string, FunctionCallSignature> = new Map();

    imports(text: string): { path: string; alias?: string }[] {
        const tokens = super.tokenize(text).tokens;
        const imports: { path: string; alias?: string }[] = [];
        for (let i = 0; i < tokens.length - 1; i++) {
            if (tokens[i].image !== 'use' || tokens[i + 1].tokenType.name !== 'STRING'
                || i > 0 && !newline(tokens[i - 1])) continue;
            imports.push({ path: JSON.parse(tokens[i + 1].image),
                alias: tokens[i + 2]?.image === 'as' ? tokens[i + 3]?.image : undefined });
        }
        return imports;
    }

    override tokenize(text: string, options?: TokenizeOptions): LexerResult {
        return this.contextualTokens(text, options, new Map());
    }

    private contextualTokens(text: string, options: TokenizeOptions | undefined, literalWords: ReadonlyMap<number, string>): LexerResult {
        // A declared word may otherwise start a comment or a combined builtin token.
        // Keep its width and source offsets while asking the base lexer for its value tokens.
        let input = text;
        for (const [offset, word] of literalWords) {
            input = input.slice(0, offset) + word[0] + '_' + word.slice(2) + input.slice(offset + word.length);
        }
        const result = super.tokenize(input, options);
        for (const token of result.tokens) {
            const word = literalWords.get(token.startOffset);
            if (word) token.image = word;
        }
        const comments = result.hidden.filter(token => token.tokenType.name === 'REM_COMMENT');
        const tokens = [...result.tokens, ...comments].sort((a, b) => a.startOffset - b.startOffset);
        result.tokens = tokens;
        const contextualWords = new Map(literalWords);
        interface Scope {
            parent?: Scope;
            names: Map<string, Header | { alias: string } | null>;
            inline?: boolean;
        }
        const root: Scope = { names: new Map([...this.signatures].map(([name, signature]) => [name, {
            right: signature.rightParameters.map(parameter => parameter.kind === 'function'),
            words: new Set(signature.words.map(group => group.word)),
        }])) };
        let scope = root;
        const scopes: Scope[] = [];
        const declarations = new Set<number>();
        for (let index = 0; index < tokens.length; index++) {
            if (newline(tokens[index]) && scope.inline) scope = scope.parent!;
            const lineStart = index === 0 || newline(tokens[index - 1]);
            const token = tokens[index];
            if (lineStart && token.image === 'end' && scope.parent) scope = scope.parent;
            if (lineStart && ['else', 'elif', 'catch', 'finally'].includes(token.image) && scope.parent) {
                scope = { parent: scope.parent, names: new Map() };
            }
            scopes[index] = scope;
            if (tokens[index - 1]?.image !== '.') {
                let arrayBlock = false;
                if (token.image === 'array' && tokens[index + 1]?.image === 'shape') {
                    arrayBlock = true;
                    for (let cursor = index + 2; tokens[cursor] && !newline(tokens[cursor]); cursor++) {
                        if (tokens[cursor].image === 'fill') { arrayBlock = false; break; }
                    }
                }
                const blockExpression = ['record', 'select', 'filter', 'update', 'with'].includes(token.image)
                    && newline(tokens[index + 1])
                    || token.image === 'text' && (lineStart || ['=', 'return', '('].includes(tokens[index - 1]?.image))
                        && (newline(tokens[index + 1])
                        || ['lines', 'joined'].includes(tokens[index + 1]?.image) && newline(tokens[index + 2]))
                    || arrayBlock;
                if (blockExpression) scope = { parent: scope, names: new Map() };
            }
            if (!lineStart) continue;
            if (['for', 'if', 'try', 'test'].includes(token.image)) {
                scope = { parent: scope, names: new Map() };
                continue;
            }
            if (lowercase(token) && tokens[index + 1]?.image === '=' &&
                /^[a-z][A-Za-z0-9_.]*$/.test(tokens[index + 2]?.image ?? '') && newline(tokens[index + 3])) {
                scope.names.set(token.image, { alias: tokens[index + 2].image });
            }
            if (!['fun', 'memo'].includes(token.image)) continue;
            const start = index;
            let cursor = index + 1;
            while (uppercase(tokens[cursor])) {
                cursor++;
                if (tokens[cursor]?.image === "'") cursor++;
            }
            if (!lowercase(tokens[cursor])) continue;
            const name = tokens[cursor++].image;
            const right: boolean[] = [], callbacks: string[] = [];
            while (!newline(tokens[cursor]) && (uppercase(tokens[cursor]) || lowercase(tokens[cursor])) && tokens[cursor].image !== 'rank') {
                const callback = lowercase(tokens[cursor]);
                right.push(callback);
                if (callback) callbacks.push(tokens[cursor].image);
                cursor++;
                if (tokens[cursor]?.image === "'") cursor++;
            }
            const words = new Set<string>();
            for (;;) {
                if (newline(tokens[cursor])) {
                    let next = cursor;
                    while (newline(tokens[next])) next++;
                    if (tokens[next]?.image !== '.' || !lowercase(tokens[next + 1])) break;
                    cursor = next;
                }
                if (tokens[cursor]?.image !== '.' || !lowercase(tokens[cursor + 1])) break;
                const dot = tokens[cursor], word = tokens[cursor + 1];
                const tokenType = this.definition.SIGNATURE_WORD;
                tokens.splice(cursor, 2, { ...dot, image: '.' + word.image,
                    endOffset: word.endOffset, endLine: word.endLine, endColumn: word.endColumn,
                    tokenType, tokenTypeIdx: tokenType.tokenTypeIdx! });
                words.add(word.image);
                cursor++;
                if (uppercase(tokens[cursor])) {
                    cursor++;
                    if (tokens[cursor]?.image === "'") cursor++;
                }
                if (tokens[cursor]?.image === '=') cursor = atomEnd(tokens, cursor + 1);
            }
            scope.names.set(name, { right, words });
            if (tokens[cursor]?.image === 'rank') {
                while (tokens[cursor] && !newline(tokens[cursor]) && tokens[cursor].image !== '=') cursor++;
            }
            for (let position = start; position < cursor; position++) {
                declarations.add(position);
                scopes[position] = scope;
            }
            scope = { parent: scope, names: new Map(callbacks.map(name => [name, null])),
                inline: tokens[cursor]?.image === '=' };
            index = cursor - 1;
        }
        const lookup = (name: string, scope: Scope | undefined, seen = new Set<string>()): Header | undefined => {
            if (seen.has(name)) return undefined;
            seen.add(name);
            for (let current = scope; current; current = current.parent) {
                if (!current.names.has(name)) continue;
                const value = current.names.get(name);
                return value && 'alias' in value ? lookup(value.alias, current, seen) : value ?? undefined;
            }
            return undefined;
        };
        const removed = new Set<number>();
        const replace = (index: number, type: string) => {
            const tokenType = this.definition[type];
            tokens[index] = { ...tokens[index], tokenType, tokenTypeIdx: tokenType.tokenTypeIdx! };
        };
        for (let index = 0; index < tokens.length; index++) {
            if (declarations.has(index) || removed.has(index)) continue;
            const header = lookup(tokens[index].image, scopes[index]);
            if (!header) continue;
            let cursor = index + 1;
            for (const functionOperand of header.right) {
                if (!tokens[cursor] || newline(tokens[cursor])) break;
                const pair = `${tokens[cursor].image} ${tokens[cursor + 1]?.image}`;
                const comparison = ({ 'not equal': 'notequal', 'at least': 'atleast', 'at most': 'atmost' } as Record<string, string>)[pair];
                if (functionOperand && comparison) {
                    replace(cursor, 'CALL_OPERATOR');
                    const last = tokens[cursor + 1];
                    tokens[cursor] = { ...tokens[cursor], image: comparison,
                        endOffset: last.endOffset, endLine: last.endLine, endColumn: last.endColumn };
                    removed.add(cursor + 1);
                    cursor += 2;
                } else if (functionOperand && symbolic.has(tokens[cursor].image)) {
                    replace(cursor, 'CALL_OPERATOR');
                    cursor++;
                } else cursor = atomEnd(tokens, cursor);
            }
            while (tokens[cursor]) {
                const token = tokens[cursor];
                const word = token.image.split(/[\t ]/)[0];
                if (!header.words.has(word)) break;
                if (token.tokenType.name === 'REM_COMMENT' || token.tokenType.name === 'HIGHER_ORDER') {
                    contextualWords.set(token.startOffset, word);
                    break;
                }
                replace(cursor++, 'WORD');
                if (!tokens[cursor] || newline(tokens[cursor])) break;
                cursor = atomEnd(tokens, cursor);
            }
        }
        if (contextualWords.size > literalWords.size) return this.contextualTokens(text, options, contextualWords);
        for (const index of [...removed].sort((a, b) => b - a)) tokens.splice(index, 1);
        result.tokens = tokens.filter(token => token.tokenType.name !== 'REM_COMMENT');
        return result;
    }
}

function atomEnd(tokens: readonly IToken[], start: number): number {
    const token = tokens[start];
    if (!token || newline(token)) return start;
    if (token.image === '(') {
        let depth = 1, cursor = start + 1;
        for (; cursor < tokens.length && depth; cursor++) {
            if (tokens[cursor].image === '(') depth++;
            else if (tokens[cursor].image === ')') depth--;
        }
        return cursor;
    }
    if (['-', '+', '.'].includes(token.image)) return Math.min(start + 2, tokens.length);
    return start + 1;
}
