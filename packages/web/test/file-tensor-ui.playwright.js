async page => {
    await page.waitForFunction(()=>!document.querySelector('#brand').disabled);
    const original = await page.evaluate(()=>localStorage.getItem('rank-active-notebook-v1'));
    const menu = page.getByRole('button',{name:'Terminal commands'});
    if(await menu.getAttribute('aria-expanded')==='true') await menu.click();
    const history = page.getByRole('button',{name:'Open notebook history'});
    await history.click();
    await page.getByRole('button',{name:'New notebook',exact:true}).click();
    const created = await page.evaluate(()=>localStorage.getItem('rank-active-notebook-v1'));
    const input=page.getByRole('textbox',{name:'Rank terminal input'});
    try {
        for(const line of ['rem File tensor check','use io','F = "models/large.safetensors" open',"W' = F tensor \"weight\"",'W']) {
            await input.fill(line); await input.press('Enter');
            await page.waitForFunction(()=>document.querySelector('#input').getAttribute('aria-busy')==='false');
        }
        await page.getByText('real [2 3]',{exact:true}).last().click();
        const viewer=page.locator('#value-viewer');
        await viewer.waitFor({state:'visible'});
        await page.waitForFunction(()=>document.querySelectorAll('#value-viewer tbody td').length===6);
        const values=(await viewer.getByRole('cell').allTextContents()).map(Number);
        if(JSON.stringify(values)!=='[1,-2,3,4,5,6]') throw Error('Wrong displayed values: '+values);
        await page.getByRole('button',{name:'Close viewer'}).click();
        return {ui:true,viewer:true,values,restoredNotebook:original};
    } finally {
        const close=page.getByRole('button',{name:'Close viewer'});
        if(await close.isVisible()) await close.click();
        await history.click();
        await page.locator(`.history-row[data-id="${original}"] .history-title`).click();
        await history.click();
        await page.locator(`.history-row[data-id="${created}"]`).getByRole('button',{name:'Notebook options'}).click();
        await page.getByRole('menuitem',{name:'Delete',exact:true}).click();
        await page.getByRole('dialog',{name:'Delete notebook',exact:true}).getByRole('button',{name:'Delete',exact:true}).click();
        await page.getByRole('button',{name:'Close notebook history'}).click();
    }
}
