import { ownedArray, ownedObject } from '../array-storage.js';
import { RankError } from '../errors.js';
import { isRankArray, isRankLabel, isRankObject, type RankObject, type RankValue } from '../value.js';
import { documentForm, nodeTable } from './document.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const jsonModule: RuntimeModule = {
    json: () => native('json', [1, 2], arguments_ => {
        const text = arguments_[0];
        if (typeof text !== 'string') throw new RankError('json expects text');
        const form = documentForm('json', arguments_[1]);
        let value: RankValue;
        try {
            value = new JsonParser(text).parse();
        } catch (error) {
            if (error instanceof RankError) throw error;
            const detail = error instanceof Error ? error.message : String(error);
            throw new RankError(`invalid JSON: ${detail}`, 'InvalidJson');
        }
        return form === 'flat' ? jsonNodes(value) : value;
    }),
};

interface JsonNode {
    readonly name: string;
    readonly value: RankValue;
}

/** Containers keep `""` as their value; their contents follow as rows of their own. */
function jsonNodes(root: RankValue): RankValue {
    return nodeTable<JsonNode>(
        { name: '', value: root },
        ({ name, value }) => {
            const container = isRankArray(value) || isRankObject(value);
            return {
                kind: isRankLabel(value) ? value.name : typeof value === 'bigint' ? 'integer'
                    : typeof value === 'number' ? 'real' : typeof value === 'string' ? 'text'
                    : typeof value === 'boolean' ? 'boolean' : value.kind,
                name,
                value: container ? '' : value,
            };
        },
        ({ value }) => isRankObject(value) ? [...value.entries].map(([name, item]) => ({ name, value: item }))
            : isRankArray(value) ? (value.items as RankValue[]).map(item => ({ name: '', value: item }))
            : [],
    );
}

class JsonParser {
    private position = 0;

    constructor(private readonly source: string) {}

    parse(): RankValue {
        const value = this.value();
        this.whitespace();
        if (this.position !== this.source.length) this.fail('unexpected trailing input');
        return value;
    }

    private value(): RankValue {
        this.whitespace();
        const character = this.source[this.position];
        if (character === '"') return this.string();
        if (character === '[') return this.array();
        if (character === '{') return this.object();
        if (character === '-' || isDigit(character)) return this.number();
        if (this.consume('true')) return true;
        if (this.consume('false')) return false;
        if (this.consume('null')) return { kind: 'label', name: 'null' };
        this.fail('expected a JSON value');
    }

    private string(): string {
        const start = this.position;
        this.position += 1;
        let escaped = false;
        while (this.position < this.source.length) {
            const character = this.source[this.position];
            this.position += 1;
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                return JSON.parse(this.source.slice(start, this.position)) as string;
            } else if (character.charCodeAt(0) < 0x20) {
                this.fail('unescaped control character in string');
            }
        }
        this.fail('unterminated string');
    }

    private number(): RankValue {
        const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;
        match.lastIndex = this.position;
        const found = match.exec(this.source);
        if (!found) this.fail('invalid number');
        this.position = match.lastIndex;
        const token = found[0];
        if (!token.includes('.') && !/[eE]/.test(token)) return BigInt(token);
        const value = Number(token);
        if (!Number.isFinite(value)) this.fail('real number is out of range');
        return value;
    }

    private array(): RankValue {
        this.position += 1;
        const items: RankValue[] = [];
        this.whitespace();
        if (this.take(']')) return ownedArray(items);
        for (;;) {
            items.push(this.value());
            this.whitespace();
            if (this.take(']')) break;
            this.expect(',');
        }
        return ownedArray(items);
    }

    private object(): RankObject {
        this.position += 1;
        const entries = new Map<string, RankValue>();
        this.whitespace();
        if (this.take('}')) return ownedObject(entries);
        for (;;) {
            this.whitespace();
            if (this.source[this.position] !== '"') this.fail('object key must be text');
            const key = this.string();
            this.whitespace();
            this.expect(':');
            entries.set(key, this.value());
            this.whitespace();
            if (this.take('}')) break;
            this.expect(',');
        }
        return ownedObject(entries);
    }

    private whitespace(): void {
        while (/\s/u.test(this.source[this.position] ?? '')) this.position += 1;
    }

    private consume(token: string): boolean {
        if (!this.source.startsWith(token, this.position)) return false;
        this.position += token.length;
        return true;
    }

    private take(character: string): boolean {
        if (this.source[this.position] !== character) return false;
        this.position += 1;
        return true;
    }

    private expect(character: string): void {
        if (!this.take(character)) this.fail(`expected ${character}`);
    }

    private fail(message: string): never {
        throw new Error(`${message} at position ${this.position}`);
    }
}

function isDigit(character: string | undefined): boolean {
    return character !== undefined && character >= '0' && character <= '9';
}
