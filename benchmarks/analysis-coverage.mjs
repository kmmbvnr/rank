import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { AstUtils, EmptyFileSystem } from 'langium';
import {
  analyzeValues, createRankServices, flatArrayBorrowProofs, functionEffects,
  functionTestExamples, isForStatement, isFunctionStatement,
} from '../packages/language/out/index.js';

const parser = createRankServices(EmptyFileSystem).Rank.parser.LangiumParser;
const paths = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.ra') && !entry.name.endsWith('_test.ra')) paths.push(path);
  }
}
collect('demos');
paths.sort();

const groups = new Map();
for (const path of paths) {
  const parsed = parser.parse(readFileSync(path, 'utf8'));
  if (parsed.parserErrors.length) throw new Error(`${path}: ${parsed.parserErrors[0].message}`);
  const definitions = parsed.value.statements.filter(isFunctionStatement);
  const byName = new Map(definitions.map(definition => [definition.name, definition]));
  const effects = functionEffects(name => byName.get(name), name => byName.has(name));
  const group = path.split('/')[1];
  const counts = groups.get(group) ?? {
    files: 0, functions: 0, knownEffects: 0, borrowCandidates: 0,
    guardedBuiltinBorrowCandidates: 0,
    loopFunctions: 0, knownLoopEffects: 0, testExamples: 0, knownExampleResults: 0,
    knownExampleEffects: 0, exampleExpectationConflicts: 0,
  };
  counts.files++;
  for (const definition of definitions) {
    counts.functions++;
    const known = !effects(definition.name).unknown;
    const hasLoop = [...AstUtils.streamAllContents(definition)].some(isForStatement);
    if (known) counts.knownEffects++;
    if (hasLoop) {
      counts.loopFunctions++;
      if (known) counts.knownLoopEffects++;
    }
    if (flatArrayBorrowProofs(definition, name => byName.get(name)).size) counts.borrowCandidates++;
    if (flatArrayBorrowProofs(definition, name => byName.get(name), name => !byName.has(name)).size) {
      counts.guardedBuiltinBorrowCandidates++;
    }
  }
  const testPath = path.replace(/\.ra$/, '_test.ra');
  if (existsSync(testPath)) {
    const testProgram = parser.parse(readFileSync(testPath, 'utf8'));
    if (testProgram.parserErrors.length) throw new Error(`${testPath}: ${testProgram.parserErrors[0].message}`);
    const moduleName = path.split('/').at(-1).replace(/\.ra$/, '');
    const examples = functionTestExamples(testProgram.value, moduleName, new Set(byName.keys()));
    counts.testExamples += examples.length;
    counts.knownExampleEffects += examples.filter(example =>
      !effects(example.name, example.arguments).unknown).length;
    if (examples.length) {
      try {
        const results = analyzeValues(parsed.value, new Map(), new Map(), examples).functionResults;
        counts.knownExampleResults += results.filter(result => result.types.length > 0).length;
        for (const [index, result] of results.entries()) {
          const expected = examples[index].expected;
          if (!result.types.length || !expected.types.length) continue;
          // Numeric equality in a Rank test does not assert the result's numeric type.
          const numeric = [result, expected].every(value => value.types.every(type =>
            type === 'integer' || type === 'real'));
          const incompatibleType = !numeric && result.types.every(type => !expected.types.includes(type));
          const incompatibleRank = result.rank !== undefined && expected.rank !== undefined
            && result.rank !== expected.rank;
          if (incompatibleType || incompatibleRank) counts.exampleExpectationConflicts++;
        }
      } catch (error) { throw new Error(`${path}: ${error.message}`, { cause: error }); }
    }
  }
  groups.set(group, counts);
}
const total = { files: 0, functions: 0, knownEffects: 0, borrowCandidates: 0,
  guardedBuiltinBorrowCandidates: 0,
  loopFunctions: 0, knownLoopEffects: 0, testExamples: 0, knownExampleResults: 0,
  knownExampleEffects: 0, exampleExpectationConflicts: 0 };
for (const counts of groups.values()) {
  for (const key of Object.keys(total)) total[key] += counts[key];
}
console.log(JSON.stringify({ total, groups: Object.fromEntries(groups) }, null, 2));
