import { ownedArray, ownedObject } from '../array-storage.js';
import { RankError } from '../errors.js';
import { checkpoint } from '../interrupt.js';
import type { RankValue } from '../value.js';
import { documentForm, nodeObject, nodeTable } from './document.js';
import { native } from './shared.js';
import type { RuntimeModule } from './types.js';

export const xmlModule: RuntimeModule = {
    xml: () => native('xml', [1, 2], arguments_ => {
        const text = arguments_[0];
        if (typeof text !== 'string') throw new RankError('xml expects text');
        const form = documentForm('xml', arguments_[1]);
        let root: XmlNode;
        try {
            root = new XmlParser(text).parse();
        } catch (error) {
            if (error instanceof RankError) throw error;
            const detail = error instanceof Error ? error.message : String(error);
            throw new RankError(`invalid XML: ${detail}`, 'InvalidXml');
        }
        return form === 'flat' ? xmlNodes(root) : xmlTree(root);
    }),
};

interface XmlNode {
    readonly kind: 'element' | 'text' | 'comment';
    readonly name: string;
    readonly value: string;
    readonly attributes: readonly (readonly [string, string])[];
    readonly children: readonly XmlNode[];
}

function fields(node: XmlNode): Record<string, RankValue> {
    return {
        kind: node.kind,
        name: node.name,
        value: node.value,
        attributes: ownedObject(node.attributes),
    };
}

/** A tree node has the fields of a flat row, with `.children` in place of `.depth` and `.parent`. */
function xmlTree(node: XmlNode): RankValue {
    checkpoint('building XML tree');
    return nodeObject({ ...fields(node), children: ownedArray(node.children.map(xmlTree)) });
}

function xmlNodes(root: XmlNode): RankValue {
    return nodeTable(root, fields, node => node.children);
}

const NAME = /[A-Za-z_:À-￿][\w.:\-·À-￿]*/y;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Elements, attributes, text, comments, CDATA and character references.
 * The prolog, processing instructions and a document type declaration are
 * skipped; namespaces are not resolved, so `a:b` is an ordinary name. Text that
 * is only whitespace between tags is dropped.
 */
class XmlParser {
    private position = 0;

    constructor(private readonly source: string) {}

    parse(): XmlNode {
        this.misc();
        if (this.source[this.position] !== '<') this.fail('expected a root element');
        const root = this.element();
        this.misc();
        if (this.position !== this.source.length) this.fail('unexpected content after the root element');
        return root;
    }

    /** Whitespace, comments, processing instructions and a doctype outside the root. */
    private misc(): void {
        for (;;) {
            this.whitespace();
            if (this.source.startsWith('<?', this.position)) this.skipPast('?>');
            else if (this.source.startsWith('<!--', this.position)) this.skipPast('-->');
            else if (this.source.startsWith('<!DOCTYPE', this.position)) this.doctype();
            else return;
        }
    }

    private element(): XmlNode {
        checkpoint('parsing XML');
        this.expect('<');
        const name = this.name();
        const attributes: [string, string][] = [];
        for (;;) {
            const spaced = this.whitespace();
            if (this.take('/')) {
                this.expect('>');
                return { kind: 'element', name, value: '', attributes, children: [] };
            }
            if (this.take('>')) break;
            if (!spaced) this.fail('expected whitespace before an attribute');
            const key = this.name();
            if (attributes.some(([existing]) => existing === key)) this.fail(`duplicate attribute ${key}`);
            this.whitespace();
            this.expect('=');
            this.whitespace();
            attributes.push([key, this.quoted()]);
        }
        const children: XmlNode[] = [];
        for (;;) {
            if (this.position >= this.source.length) this.fail(`unclosed element ${name}`);
            if (this.source.startsWith('</', this.position)) {
                this.position += 2;
                const closing = this.name();
                if (closing !== name) this.fail(`expected </${name}> but found </${closing}>`);
                this.whitespace();
                this.expect('>');
                return { kind: 'element', name, value: '', attributes, children };
            }
            if (this.source.startsWith('<!--', this.position)) {
                const start = this.position + 4;
                this.skipPast('-->');
                children.push(leaf('comment', this.source.slice(start, this.position - 3)));
            } else if (this.source.startsWith('<![CDATA[', this.position)) {
                const start = this.position + 9;
                this.skipPast(']]>');
                appendText(children, this.source.slice(start, this.position - 3));
            } else if (this.source.startsWith('<?', this.position)) {
                this.skipPast('?>');
            } else if (this.source[this.position] === '<') {
                children.push(this.element());
            } else {
                appendText(children, this.text());
            }
        }
    }

    private text(): string {
        const end = this.source.indexOf('<', this.position);
        const raw = this.source.slice(this.position, end < 0 ? this.source.length : end);
        this.position += raw.length;
        return this.decode(raw);
    }

    private quoted(): string {
        const quote = this.source[this.position];
        if (quote !== '"' && quote !== "'") this.fail('expected a quoted attribute value');
        const end = this.source.indexOf(quote, this.position + 1);
        if (end < 0) this.fail('unterminated attribute value');
        const raw = this.source.slice(this.position + 1, end);
        if (raw.includes('<')) this.fail('< is not allowed in an attribute value');
        this.position = end + 1;
        return this.decode(raw);
    }

    private decode(raw: string): string {
        return raw.replace(/&([^;&\s]*);?/g, (match, entity: string) => {
            if (!match.endsWith(';')) this.fail('unterminated entity reference');
            if (entity.startsWith('#')) {
                const code = entity[1] === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
                if (!Number.isInteger(code) || code < 0 || code > 0x10FFFF) this.fail(`invalid character reference &${entity};`);
                return String.fromCodePoint(code);
            }
            const decoded = ENTITIES[entity];
            if (decoded === undefined) this.fail(`unknown entity &${entity};`);
            return decoded;
        });
    }

    private doctype(): void {
        // An internal subset in brackets may itself contain `>`.
        let depth = 0;
        while (this.position < this.source.length) {
            const character = this.source[this.position++];
            if (character === '[') depth += 1;
            else if (character === ']') depth -= 1;
            else if (character === '>' && depth === 0) return;
        }
        this.fail('unterminated document type declaration');
    }

    private name(): string {
        NAME.lastIndex = this.position;
        const found = NAME.exec(this.source);
        if (!found) this.fail('expected a name');
        this.position = NAME.lastIndex;
        return found[0];
    }

    private whitespace(): boolean {
        const start = this.position;
        while (/\s/u.test(this.source[this.position] ?? '')) this.position += 1;
        return this.position > start;
    }

    private skipPast(token: string): void {
        const end = this.source.indexOf(token, this.position);
        if (end < 0) this.fail(`expected ${token}`);
        this.position = end + token.length;
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

function leaf(kind: 'text' | 'comment', value: string): XmlNode {
    return { kind, name: '', value, attributes: [], children: [] };
}

/** Adjacent text and CDATA form one text node; whitespace between markup is dropped. */
function appendText(children: XmlNode[], value: string): void {
    const last = children.at(-1);
    if (last?.kind === 'text') {
        children[children.length - 1] = leaf('text', last.value + value);
    } else if (value.trim() !== '') {
        children.push(leaf('text', value));
    }
}
