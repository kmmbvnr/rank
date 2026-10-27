// Native persistence beyond SQLite CursorWindow's single-row size.
async page => page.evaluate(async () => {
    const call=(method,options)=>window.Capacitor.nativePromise('Notebooks',method,options);
    const id=crypto.randomUUID(), now=Date.now();
    const data=new Uint8Array(700000*4);
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),x=>x.toString(16).padStart(2,'0')).join('');
    const header=new TextEncoder().encode(JSON.stringify({dtype:'f32',shape:[700000],sha256:digest}));
    const bytes=new Uint8Array(8+header.length+data.length);
    bytes.set(new TextEncoder().encode('RWT1'));new DataView(bytes.buffer).setUint32(4,header.length,true);bytes.set(header,8);
    let text='';for(let i=0;i<bytes.length;i+=8192) text+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const snapshot={cells:[],draft:'rem storage check',attachments:{'large.rwt':btoa(text)}};
    try {
        await call('save',{book:{id,title:'RAM storage check',manual:false,created:now,updated:now,snapshot}});
        const {book}=await call('get',{id});
        if(JSON.stringify(book.snapshot)!==JSON.stringify(snapshot)) throw Error('Large binary attachment changed');
        return {binaryBytes:bytes.length,snapshotBytes:JSON.stringify(snapshot).length,roundTrip:true};
    } finally {await call('remove',{id});}
})
