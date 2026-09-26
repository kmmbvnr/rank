import { describe, expect, it } from 'vitest';
import { run } from './support.js';

const XML = 'use xml\nuse tables\nuse text\n';
const JSON_ = 'use json\nuse tables\n';
const CASE = 'Input = "<Case>\\n  <Params Price=\\"150000\\" Rate=\\"1.5\\" />\\n  <!-- note -->\\n  <Title>Buy &amp; rent</Title>\\n</Case>"\n';

describe('xml', () => {
    it('decodes a tree whose nodes have the fields of a flat row and their children', () => {
        expect(run(`${XML}${CASE}Doc = Input xml\nDoc .name`)).toBe('Case');
        expect(run(`${XML}${CASE}Doc = Input xml\nKids = Doc .children\nKids .kind`)).toBe('element comment element');
        expect(run(`${XML}${CASE}Doc = Input xml\nDoc .children 0 .attributes "Rate"`)).toBe('1.5');
        expect(run(`${XML}${CASE}Doc = Input xml\nDoc .children 2 .children 0 .value`)).toBe('Buy & rent');
    });

    it('decodes a flat table of nodes in document order with parents before children', () => {
        const flat = `${XML}${CASE}Nodes = Input xml .flat\n`;
        expect(run(`${flat}Nodes .name`)).toBe('Case Params  Title ');
        expect(run(`${flat}Nodes .kind`)).toBe('element element comment element text');
        expect(run(`${flat}Nodes .depth`)).toBe('0 1 1 1 2');
        expect(run(`${flat}Nodes .parent`)).toBe('-1 0 0 0 3');
        expect(run(`${flat}Params = Nodes filter .name equal "Params"\nParams 0 .attributes "Price"`)).toBe('150000');
    });

    it('reads attributes in a listed order', () => {
        expect(run(`${XML}${CASE}Keys = "Rate Price" " " split\nNodes = Input xml .flat\nNodes 1 .attributes Keys real rank 0`))
            .toBe('1.5 150000');
        expect(() => run(`${XML}${CASE}Nodes = Input xml .flat\nNodes 1 .attributes (array "Rate" "Term")`))
            .toThrow('missing object key: Term');
    });

    it('skips the prolog and keeps CDATA and character references as text', () => {
        expect(run('use xml\nDoc = "<?xml version=\\"1.0\\"?><!DOCTYPE a><a><![CDATA[<b>]]>&#65;&#x42;</a>" xml\nDoc .children 0 .value'))
            .toBe('<b>AB');
        expect(run('use xml\nDoc = "<a>\\n  <b/>\\n</a>" xml\nDoc .children len')).toBe('1');
    });

    it('reports malformed documents as InvalidXml', () => {
        for (const source of ['<a>', '<a></b>', '<a x="1" x="2"/>', '<a>&nope;</a>', '<a/><b/>', 'text']) {
            expect(() => run(`use xml\n${JSON.stringify(source)} xml`)).toThrow(/invalid XML/);
        }
        expect(() => run('use xml\n"<a/>" .deep xml')).toThrow('xml accepts only the .flat modifier');
    });
});

describe('json .flat', () => {
    const DOC = 'Doc = "{\\"a\\": [1, 2.5, {\\"b\\": \\"red\\"}], \\"c\\": null}"\n';

    it('shares the flat row fields with xml', () => {
        const flat = `${JSON_}${DOC}Nodes = Doc json .flat\n`;
        expect(run(`${flat}Nodes .kind`)).toBe('object array integer real object text null');
        expect(run(`${flat}Nodes .name`)).toBe(' a    b c');
        expect(run(`${flat}Nodes .depth`)).toBe('0 1 2 2 2 3 1');
        expect(run(`${flat}Nodes .parent`)).toBe('-1 0 1 1 1 4 0');
    });

    it('selects leaves at any depth with an ordinary filter', () => {
        const flat = `${JSON_}${DOC}Nodes = Doc json .flat\n`;
        expect(run(`${flat}(Nodes filter .kind equal "integer") .value sum`)).toBe('1');
        expect(run(`${flat}Red = Nodes filter .value equal "red"\nRed 0 .parent`)).toBe('4');
    });

    it('takes the whole pipeline before it as the document and lets the pipeline continue', () => {
        expect(run(`${JSON_}${DOC}Doc text json .flat len`)).toBe('7');
        expect(run(`${JSON_}${DOC}N = Doc json .flat len\nN`)).toBe('7');
    });

    it('leaves a label after a program function of the same name as a field read', () => {
        expect(run('fun json T\n  return record\n    .flat = T\n  end\nend\n"x" json .flat')).toBe('x');
    });

    it('keeps the tree as the default form', () => {
        expect(run(`${JSON_}${DOC}Data = Doc json\n(Data "a") 0`)).toBe('1');
    });
});
