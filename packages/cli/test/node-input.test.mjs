import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {NodeInput} from '../out/node-io.js';

function readMock(t, implementation) {
 t.mock.method(fs,'readSync',implementation);
 syncBuiltinESMExports();
 t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
}

test('stdin waits through EAGAIN and retains buffered tokens',t=>{
 let attempts=0;
 readMock(t,(_fd,buffer)=>{
  if (++attempts===1) throw Object.assign(new Error('would block'),{code:'EAGAIN'});
  if (attempts===2) {buffer.write('42 hello\n');return 9;}
  return 0;
 });
 const input=new NodeInput();
 assert.equal(input.readToken(),'42');
 assert.equal(input.readToken(),'hello');
 assert.equal(input.readToken(),undefined);
 assert.equal(attempts,3);
});

test('stdin preserves permanent read failures',t=>{
 const error=Object.assign(new Error('bad descriptor'),{code:'EBADF'});
 readMock(t,()=>{throw error;});
 assert.throws(()=>new NodeInput().readToken(),error);
});
