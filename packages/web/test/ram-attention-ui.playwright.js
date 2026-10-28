async page => {
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'GPU Linear',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('X dense'));
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'Run program',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('real [2 4]'));
    await page.getByRole('button',{name:'dense.ram',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'RAM module source'});
    const original=await editor.inputValue();
    try {
        await editor.fill("use ml\narg X .f32 shape 2 3\narg W .f32 shape 3 9 = array shape 3 9 fill 1\narg O .f32 shape 3 3 = array shape 3 3 fill 1\narg Scale .f32 shape 1 = array 0.577350269\narg Mask .f32 shape 1 1 2 2 = array shape 1 1 2 2\n0 -10000 0 0\nend\nP = X W linear\nQ = (P # (0 till 3)) reshape 1 2 1 3\nK = (P # (3 till 6)) reshape 1 2 1 3\nV = (P # (6 till 9)) reshape 1 2 1 3\nQ = Q transpose axis 0 2 1 3\nK = K transpose axis 0 2 3 1\nV = V transpose axis 0 2 1 3\nScores = Q matmul K rank 2 2 * Scale\nProbabilities = Scores + Mask softmax\nContext = Probabilities matmul V rank 2 2\nMerged = Context transpose axis 0 2 1 3\nMerged = Merged reshape 1 2 3\nreturn Merged O linear\n");
        await page.getByRole('button',{name:'Program',exact:true}).click();
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        try {
            await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('18 18 18 -18 -18 -18') && document.querySelector('#screen').textContent.includes('real [1 2 3]'), {}, {timeout:30000});
        } catch(error) { throw Error(String(error)+'; screen: '+await page.locator('#screen').textContent()); }
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
        await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        if(!(await editor.inputValue()).includes('return Merged O linear')) throw Error('Source lost after reload');
        return {compiledInApp:true,causalAttention:true,persisted:true};
    } finally {
        // Always restore the example created by this check.
        if(!await editor.isVisible()) await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        await editor.fill(original);
        await page.getByRole('button',{name:'Program',exact:true}).click();
    }
}
