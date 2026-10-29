// Substitute __RETURN_NOTEBOOK_ID__ with the notebook to restore after the test.
async page => {
 const returnId=__RETURN_NOTEBOOK_ID__;
 let testId;
 const select=async id=>{
  await page.getByRole('button',{name:'Open notebook history'}).click();
  await page.locator('.history-row[data-id="'+id+'"] .history-title').click();
 };
 const run=async text=>{
  await page.getByRole('button',{name:'Terminal commands'}).click();
  await page.getByRole('button',{name:'Run program',exact:true}).click();
  await page.waitForFunction(text=>document.querySelector('#input')?.getAttribute('aria-busy')==='false'&&document.querySelector('#screen')?.textContent.includes(text),text,{timeout:30000});
 };
 const states=async expected=>page.waitForFunction(async count=>{
  const status=await window.Capacitor.nativePromise('RamGpu','closeSession',{sessionId:'nonexistent'});
  return status.residentStates===count;
 },expected,{timeout:15000});
 try{
  await select(returnId);
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#brand')&&!document.querySelector('#brand').disabled);
  const program='use ml\nuse "hold.ram"\nkeep = (hold gpukeep)\nState = (array 2.0 3.0 shape 1 2) keep\nState';
  const save=async failure=>page.evaluate(async ({id,program,failure})=>{
   const now=Date.now(),key=id??crypto.randomUUID();
   await window.Capacitor.nativePromise('Notebooks','save',{book:{id:key,title:'GPU lifetime test',manual:true,created:now,updated:now,snapshot:{cells:[program+(failure?'\n.DomainError "injected cell failure" raise':'')],draft:'',modules:[{name:'hold.ram',source:'use ml\narg X .f32 shape 1 2\nreturn X relu'}]}}});
   return key;
  },{id:testId,program,failure});
  testId=await save(false);await select(testId);await run('<object>');await states(1);
  const worker=page.workers().at(-1);
  if(!worker)throw Error('No application worker found');
  try{await worker.evaluate(()=>{setTimeout(()=>{throw Error('Injected worker failure');},0);});}
  catch(error){if(!String(error).includes('closed'))throw error;}
  await states(0);
  await run('<object>');await states(1);
  // A normal clean restart must dispose the previous interpreter's state too.
  await run('<object>');await states(1);
  await select(returnId);
  await save(true);await select(testId);await run('injected cell failure');await states(0);
  await select(returnId);
  return {workerFailureReclaimed:true,restartedWithoutPageReload:true,cleanRunReclaimed:true,failedCellReclaimed:true,finalStateBytes:0};
 }finally{
  if(testId){
   await select(returnId);
   await page.evaluate(id=>window.Capacitor.nativePromise('Notebooks','remove',{id}),testId);
  }
 }
}
