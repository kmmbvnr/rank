import {afterEach,describe,expect,it,vi} from 'vitest';
const native=vi.hoisted(()=>({openSession:vi.fn(),closeSession:vi.fn(),submit:vi.fn()}));
vi.mock('@capacitor/core',()=>({registerPlugin:()=>native}));
import {browserSession} from '../src/session.js';

class FakeWorker {
    static all:FakeWorker[]=[];
    onmessage?: (event:any)=>void;
    onerror?: (event:any)=>void;
    onmessageerror?: ()=>void;
    messages:any[]=[];
    terminate=vi.fn();
    constructor(){FakeWorker.all.push(this);}
    postMessage(message:any){this.messages.push(message);}
    emit(data:any){this.onmessage?.({data});}
}
const sessions:ReturnType<typeof browserSession>[]=[];
const create=()=>{
    vi.stubGlobal('Worker',FakeWorker);
    vi.stubGlobal('Capacitor',{getPlatform:()=> 'android'});
    const session=browserSession(vi.fn(),vi.fn());sessions.push(session);return session;
};
afterEach(async()=>{
    sessions.splice(0).forEach(s=>s.dispose());
    await Promise.resolve();await Promise.resolve();
    FakeWorker.all=[];vi.clearAllMocks();vi.unstubAllGlobals();
});
describe('Android GPU worker ownership',()=>{
    it('closes an owner that arrives after worker disposal, without starting the worker',async()=>{
        let opened!:(owner:{sessionId:string})=>void;
        native.openSession.mockImplementationOnce(()=>new Promise(resolve=>{opened=resolve;}));
        native.closeSession.mockResolvedValue({});
        const session=create(),worker=FakeWorker.all[0];
        session.dispose();opened({sessionId:'late'});
        await vi.waitFor(()=>expect(native.closeSession).toHaveBeenCalledWith({sessionId:'late'}));
        expect(worker.messages).toEqual([]);expect(worker.terminate).toHaveBeenCalledTimes(1);
    });
    it.each(['worker','native'])('releases %s failures and rejects pending calls',async kind=>{
        native.openSession.mockResolvedValue({sessionId:'owner'});
        native.closeSession.mockResolvedValue({});native.submit.mockResolvedValue(undefined);
        const session=create(),worker=FakeWorker.all[0];
        await vi.waitFor(()=>expect(worker.messages.length).toBe(1));
        worker.emit({ram:{id:'request',payload:JSON.stringify({action:'invoke',sessionId:'forged'})}});
        expect(JSON.parse(native.submit.mock.calls[0][0].payload).sessionId).toBe('owner');
        const pending=session.setModules({});
        const rejected=expect(pending).rejects.toThrow('worker failed');
        if(kind==='worker')worker.onerror?.({message:'worker failed'});
        else worker.emit({ramFailure:'worker failed'});
        await rejected;
        await vi.waitFor(()=>expect(native.closeSession).toHaveBeenCalledWith({sessionId:'owner'}));
        worker.emit({ram:{id:'late',payload:'{}'}});
        expect(native.submit).toHaveBeenCalledTimes(1);
    });
    it('does not deliver queued requests to a replacement worker',async()=>{
        native.openSession.mockResolvedValue({sessionId:'owner'});
        native.closeSession.mockResolvedValue({});
        const session=create();
        const pending=session.setModules({});
        const rejected=expect(pending).rejects.toThrow('Stopped');
        session.interrupt();
        await rejected;
        await vi.waitFor(()=>expect(FakeWorker.all[1].messages.length).toBe(1));
        expect(FakeWorker.all[1].messages[0]).not.toHaveProperty('method');
        expect(FakeWorker.all[0].terminate).toHaveBeenCalledTimes(1);
    });
});
