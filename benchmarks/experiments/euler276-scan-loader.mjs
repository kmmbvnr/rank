// Research-only loader. Guard every long-prefix addition instead of rejecting
// all Int32 axes above 2^21 cells; exact fallback owns unsafe prefixes.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if(url.endsWith('/interpreter/out/reduction.js')) {
    let source=String(result.source);
    if(source.includes("const compact = scanInt32Axis('+', value, value.shape, 0);")) return result;
    const point="if (operator === '+' && isRankArray(value) && this.isTensorFusion()) {";
    if(!source.includes(point))throw new Error('scan dispatch changed');
    source=source.replace(point, `if (operator === '+' && seed === undefined && isRankArray(value) && value.shape.length === 1) {
      const compact=scanInt32Axis('+', value, value.shape, 0);
      if(compact) return compact;
    }
    ${point}`);
    return {...result,source};
  }
  if (!url.endsWith('/interpreter/out/runtime/axis-order.js')) return result;
  let source = String(result.source);
  if (source.includes('length > 2 ** 21 && !Number.isSafeInteger(next)')) return result;
  if (!source.includes('length > 2 ** 21')) throw new Error('scan guard changed');
  source = source.replace(' || length > 2 ** 21', '');
  source = source.replace('out[i] = out[i - inner] + cells[i];', '{ const next = out[i - inner] + cells[i]; if (length > 2 ** 21 && !Number.isSafeInteger(next)) return undefined; out[i] = next; }');
  if(process.env.TRACE_SCAN)source=source.replace('const length = shape[axis];', 'const length = shape[axis]; console.error("compact scan", op, length, !!cells);');
  return {...result, source};
}
