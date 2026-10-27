async page => {
    const original = await page.evaluate(async () => {
        const native=(method,options)=>window.Capacitor.nativePromise('Notebooks',method,options);
        const {items}=await native('list',{limit:25});
        const item=items.find(item=>item.title==='GPU MLP: XOR');
        if(!item) throw Error('Missing MLP notebook');
        const {book}=await native('get',{id:item.id});
        const original=JSON.parse(JSON.stringify(book));
        if(Object.keys(book.snapshot.attachments??{}).length!==4) throw Error('Missing persisted weights');
        const data=Uint8Array.from(atob(book.snapshot.attachments['b2.rwt']),c=>c.charCodeAt(0));
        const view=new DataView(data.buffer), length=view.getUint32(4,true);
        view.setFloat32(8+length,-2,true);view.setFloat32(12+length,2,true);
        const header=JSON.parse(new TextDecoder().decode(data.subarray(8,8+length)));
        header.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data.subarray(8+length))),x=>x.toString(16).padStart(2,'0')).join('');
        data.set(new TextEncoder().encode(JSON.stringify(header)),8);
        book.snapshot.attachments['b2.rwt']=btoa(String.fromCharCode(...data));
        await native('save',{book});
        return original;
    });
    const run=async expected=>{
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
        await page.getByRole('button',{name:'Program',exact:true}).click();
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        await page.waitForFunction(value=>document.querySelector('#screen').textContent.includes(value),expected,{timeout:30000});
    };
    try {await run('0.017986');}
    finally {await page.evaluate(book=>window.Capacitor.nativePromise('Notebooks','save',{book}),original);}
    await run('0.982013');
    return {persistedWeights:4,changedBinaryOutput:true,restoredOriginal:true};
}
