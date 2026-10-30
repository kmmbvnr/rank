// Research-only in-memory compiler experiment. Does not change source or out/.
export async function load(url,context,nextLoad){
  const result=await nextLoad(url,context);
  if(!url.endsWith('/jit/integer-loop-wide.js')&&!url.endsWith('/jit/integer-loop-statements.js'))return result;
  let source=String(result.source);
  function replace(from,to){if(!source.includes(from))throw new Error(`unexpected compiler layout: ${from}`);source=source.replace(from,to);}
  if(url.endsWith('/jit/integer-loop-wide.js')){
    replace(`        if (isIfStatement(node)) {
            read(node.condition);
            node.elifClauses.forEach(branch => read(branch.condition));
        }`,``);
    replace(`if (type !== 'integer')`, `if (type !== 'integer' && type !== 'boolean')`);
  }else{
    source=`import { AstUtils } from 'langium';\n`+source;
    replace(`const exactExpressions = state.wideScalars.size ? createLoopExpressions(state, true) : undefined;`,
      `const exactExpressions = state.wideScalars.size ? createLoopExpressions(state, true) : undefined;
    const hasWide = node => [node, ...AstUtils.streamAllContents(node)].some(item => isNameExpression(item) && state.wideScalars.has(item.name));`);
    replace(`const condition = emit(branch.condition, lines, 'boolean');`,
      `const condition = (exactExpressions && hasWide(branch.condition) ? exactExpressions : expressions).emit(branch.condition, lines, 'boolean');`);
    replace(`const wide = state.wideScalars.has(assignment.name);`,
      `const wide = state.wideScalars.has(assignment.name) || exactExpressions && hasWide(assignment.value);`);
  }
  return {...result,source};
}
