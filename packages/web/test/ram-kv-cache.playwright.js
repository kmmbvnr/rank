// Substitute __KV_FIXTURE__ with scripts/mlrank-kv-check.mjs --fixture output.
async page => {
 const fixture=__KV_FIXTURE__;
 await page.waitForFunction(()=>document.querySelector('#input')?.getAttribute('aria-busy')!=='true',null,{timeout:120000});
 return page.evaluate(async fixture=>{
  const check=eval('('+fixture.check+')');
  const send=async request=>{
   const id=crypto.randomUUID();
   await window.Capacitor.nativePromise('RamGpu','submit',{id,payload:JSON.stringify(request)});
   return fetch('/__rank_ml_result?id='+id).then(r=>r.json());
  };
  return check(send,fixture.models);
 },fixture);
}
