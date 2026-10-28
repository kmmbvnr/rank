async page => {
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    await page.getByRole('button',{name:'Terminal commands'}).click();
    await page.getByRole('button',{name:'GPU Linear',exact:true}).click();
    await page.getByRole('button',{name:'dense.ram',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'RAM module source'});
    const original=await editor.inputValue();
    try {
        await editor.fill('use ml\narg X .f32 shape 2 3\nH = X layernorm\nreturn H gelu_new');
        await page.getByRole('button',{name:'Program',exact:true}).click();
        await page.getByRole('button',{name:'Terminal commands'}).click();
        await page.getByRole('button',{name:'Run program',exact:true}).click();
        await page.waitForFunction(()=>document.querySelector('#screen').textContent.includes('-0.135353'), {}, {timeout:30000});
        await page.reload();
        await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
        await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        if(!(await editor.inputValue()).includes('return H gelu_new')) throw Error('Source lost after reload');
        return {compiledInApp:true,layernormGelu:true,persisted:true};
    } finally {
        // Always restore the example created by this check.
        if(!await editor.isVisible()) await page.getByRole('button',{name:'dense.ram',exact:true}).click();
        await editor.fill(original);
        await page.getByRole('button',{name:'Program',exact:true}).click();
    }
}
