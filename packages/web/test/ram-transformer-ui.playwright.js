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
        await editor.fill(__RAM_SOURCE__);
        await page.getByRole('button',{name:'Program',exact:true}).click();
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        try {
            await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('real [1 1 3]'), {}, {timeout:30000});
        } catch(error) { throw Error(String(error)+'; screen: '+await page.locator('#screen').textContent()); }
        await page.getByText('real [1 1 3]',{exact:true}).click();
        const viewer=page.getByRole('dialog',{name:'X dense',exact:true});
        const numbers=(await viewer.getByRole('cell').allTextContents()).map(Number),expected=__EXPECTED__;
        if(numbers.length!==expected.length || numbers.some((n,i)=>!Number.isFinite(n)||Math.abs(n-expected[i])>1e-5+1e-5*Math.abs(expected[i]))) throw Error('Displayed transformer output differs from reference');
        await page.getByRole('button',{name:'Close viewer'}).click();
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
        await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        if(!(await editor.inputValue()).includes('return Output')) throw Error('Source lost after reload');
        return {compiledInApp:true,transformer:true,displayCompared:true,persisted:true};
    } finally {
        const close=page.getByRole('button',{name:'Close viewer'});
        if(await close.isVisible()) await close.click();
        // Always restore the example created by this check.
        if(!await editor.isVisible()) await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        await editor.fill(original);
        await page.getByRole('button',{name:'Program',exact:true}).click();
    }
}
