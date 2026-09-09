import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createApp} from './server.mjs';

test('업무 보존, 완료 근거, 충돌 보호 및 접근 제한', async()=>{
 const dir=mkdtempSync(join(tmpdir(),'worklog-test-'));const path=join(dir,'test.sqlite');
 let store=openStore(path);let server=createApp(store);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url=`http://127.0.0.1:${server.address().port}`;
 const call=async(method,path,data,extra={})=>{const r=await fetch(url+path,{method,headers:{'Content-Type':'application/json',Origin:url,...extra},body:data===undefined?undefined:JSON.stringify(data)});return [r.status,await r.json()]};
 try{
  let [code,t]=await call('POST','/api/tasks',{title:'테스트 요청',request:'최초 조회 오류',criteria:'정상 표시'});assert.equal(code,201);
  assert.equal((await call('POST','/api/tasks',{title:' ',request:'x'}))[0],400);
  assert.equal((await call('PATCH','/api/tasks/'+t.id,{...t,status:'완료',note:''}))[0],400);
  assert.equal((await call('PATCH','/api/tasks/'+t.id,{...t,status:'진행 중',note:'원인 확인'}))[0],200);
  assert.equal((await call('PATCH','/api/tasks/'+t.id,{...t,status:'보류',note:'이전 화면'}))[0],409);
  t=(await call('GET','/api/tasks/'+t.id))[1];assert.equal(t.events.length,2);
  assert.equal((await call('PATCH','/api/tasks/'+t.id,{...t,status:'완료',note:'최초 조회와 전환 검증 완료'}))[0],200);
  assert.equal((await call('GET','/api/tasks',undefined,{Origin:'https://example.com'}))[0],403);
  await new Promise(r=>server.close(r));store.close();store=openStore(path);
  const saved=store.prepare('SELECT * FROM tasks WHERE id=?').get(t.id);assert.equal(saved.status,'완료');assert.equal(saved.version,3);
  assert.equal(store.prepare('PRAGMA foreign_key_check').all().length,0);
 } finally {if(server.listening)await new Promise(r=>server.close(r));store.close();rmSync(dir,{recursive:true,force:true});}
});
