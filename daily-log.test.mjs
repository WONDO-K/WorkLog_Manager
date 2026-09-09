import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore,createApp} from './server.mjs';

test('일일 요약 초안 저장, 검토 확정, 수정 충돌 및 재접속 보존',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wm-daily-'));const path=join(dir,'daily.sqlite');
 let db=openStore(path);const server=createApp(db);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const call=async(method,path,data)=>{const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin},body:data===undefined?undefined:JSON.stringify(data)});return [r.status,await r.json()]};
 try{
  let [code,log]=await call('GET','/api/daily-logs/2026-09-09');assert.equal(code,200);assert.equal(log.version,0);
  [code,log]=await call('PUT','/api/daily-logs/2026-09-09',{version:0,internal_md:'# 내부',public_md:''});assert.equal(code,200);assert.equal(log.status,'초안');
  assert.equal((await call('PUT','/api/daily-logs/2026-09-09',{version:0,internal_md:'오래된 화면',public_md:''}))[0],409);
  assert.equal((await call('POST','/api/daily-logs/2026-09-09/confirm',{version:log.version}))[0],400);
  [code,log]=await call('PUT','/api/daily-logs/2026-09-09',{version:log.version,internal_md:'# 내부',public_md:'# 외부'});assert.equal(code,200);
  [code,log]=await call('POST','/api/daily-logs/2026-09-09/confirm',{version:log.version});assert.equal(code,200);assert.equal(log.status,'확정');
  [code,log]=await call('PUT','/api/daily-logs/2026-09-09',{version:log.version,internal_md:'# 내부 보완',public_md:'# 외부'});assert.equal(code,200);assert.equal(log.status,'초안');
  await new Promise(r=>server.close(r));db.close();db=openStore(path);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
  assert.equal(db.prepare('SELECT internal_md FROM daily_logs WHERE work_date=?').get('2026-09-09').internal_md,'# 내부 보완');
 }finally{if(server.listening)await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});
