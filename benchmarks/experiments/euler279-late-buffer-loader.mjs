// Research control: avoid allocating the wide temporary when the compact
// integer kernel succeeds. No production module or compiled output is edited.
export async function load(url,context,nextLoad) {
    const result=await nextLoad(url,context);
    if(!url.endsWith('/interpreter/out/jit/integer-array-kernel.js'))return result;
    let source=String(result.source);
    const allocation='    const cells = new Float64Array(size);';
    const success='    if (fast)\n        return typedArray(fast, shape);';
    if(source.split(allocation).length!==2||!source.includes(success))throw new Error('integer kernel layout changed');
    if(source.indexOf(allocation)>source.indexOf(success))return result;
    source=source.replace(allocation,'').replace(success,`${success}\n${allocation}`);
    return {...result,source};
}
