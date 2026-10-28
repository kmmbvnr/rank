async page => {
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'GPU Linear',exact:true}).click();
    await page.getByRole('button',{name:'dense.ram',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'RAM module source'});
    const original=await editor.inputValue();
    try {
        await editor.fill("use ml\narg X .f32 shape 2 3\narg W .f32 shape 3 12 = array shape 3 12 fill 0.5\nP = X W linear\nQ = (P # (0 till 4)) reshape 1 2 2 2\nK = (P # (4 till 8)) reshape 1 2 2 2\nQ = Q transpose axis 0 2 1 3\nK = K transpose axis 0 2 3 1\nreturn Q matmul K rank 2 2\n");
        await page.getByRole('button',{name:'Program',exact:true}).click();
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('18 -18 -18 18 18 -18 -18 18') && document.querySelector('#screen').textContent.includes('real [1 2 2 2]'), {}, {timeout:30000});
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
        await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        if(!(await editor.inputValue()).includes('return Q matmul K rank 2 2')) throw Error('Source lost after reload');
        return {compiledInApp:true,qkvHeadsQkt:true,persisted:true};
    } finally {
        // Always restore the example created by this check.
        if(!await editor.isVisible()) await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        await editor.fill(original);
        await page.getByRole('button',{name:'Program',exact:true}).click();
    }
}
