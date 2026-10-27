async page => {
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'GPU MLP',exact:true}).click();
    const run = async () => {
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('0.982013'),{},{timeout:30000});
    };
    await run();
    await page.reload();
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'classifier.ram',exact:true}).click();
    const source=await page.getByRole('textbox',{name:'RAM module source'}).inputValue();
    for(const name of ['w1','b1','w2','b2']) if(!source.includes('"'+name+'.rwt"')) throw Error('Missing binary weight reference');
    await page.getByRole('button',{name:'Program',exact:true}).click();
    await run();
    return {binaryMlp:true,reload:true};
}
