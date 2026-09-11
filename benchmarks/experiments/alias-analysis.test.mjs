import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from '../../packages/interpreter/out/index.js';
import { analyzeFunction } from './alias-analysis.mjs';

const analyze = body => analyzeFunction(parse(`fun inspect N\n${body}\nend`).statements[0]);
const a = body => analyze(body).find(item => item.name === 'A');
test('finds a fresh unused binding without claiming its element type', () => {
  assert.equal(a('A = array 1 2\nreturn 0').candidate, true);
});
test('propagates writes through transitive aliases', () => {
  const result = a('A = array 1 2\nB = A\nC = B\nC 0 = 9\nreturn 0');
  assert.equal(result.candidate, false);
  assert(result.reasons.includes('content write'));
  assert.deepEqual(result.aliases, ['A', 'B', 'C']);
});
test('treats possible selectors as unknown calls without a type contract', () => {
  assert(a('A = array 1 2\nX = A N\nreturn 0').reasons.includes('unknown application'));
});
test('tracks returned aliases and lazy dependencies', () => {
  assert.equal(a('A = array 1 2\nB = A\nreturn B').candidate, false);
  assert.equal(a('A = array 1 2\nB = A + 1\nreturn B').candidate, false);
});
test('marks storage in containers and captures', () => {
  assert.equal(a('A = array 1 2\nB = array A\nreturn 0').candidate, false);
  assert(a('A = array 1 2\nfun nested\n return A\nend\nreturn 0').reasons.includes('closure capture'));
});
test('does not assume that iterated elements are detached primitive values', () => {
  assert.equal(a('Inner = array 1\nA = array Inner\nfor Item in A\n Item 0 = 2\nend\nreturn 0').candidate, false);
});
test('rejects repeated and loop-carried bindings', () => {
  assert.equal(a('A = array 1 2\nA = array 3 4\nreturn 0').candidate, false);
  assert.equal(a('for I in 0 until N\n A = array 1 2\nend\nreturn 0').candidate, false);
  assert.equal(a('A = array 1 2\nfor A in 0 until N\n 0\nend\nreturn 0').candidate, false);
});
