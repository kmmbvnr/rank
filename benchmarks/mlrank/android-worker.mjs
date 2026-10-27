import { runCosts } from './costs.mjs';
self.onmessage = ({data}) => {
    try {
        const result=runCosts(message=>{
            const id=crypto.randomUUID(), payload=JSON.stringify(message);
            self.postMessage({ram:{id,payload}});
            const request=new XMLHttpRequest();
            request.open('GET',data.origin+'/__rank_ml_result?id='+id,false);request.send();
            if(request.status!==200) throw Error('Native RAM request failed');
            return JSON.parse(request.responseText);
        },{progress:event=>self.postMessage({progress:event})});
        self.postMessage({result});
    } catch(error) {self.postMessage({error:String(error),stack:error.stack});}
};
