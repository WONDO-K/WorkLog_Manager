import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadConfig} from './config.mjs';
test('개인 설정과 기본 저장 경로 및 잘못된 설정',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wm-config-'));
 try{let c=loadConfig(dir);assert.equal(c.companyName,'내 업무');assert.equal(c.dbPath,join(dir,'data','worklog.sqlite'));
 writeFileSync(join(dir,'config.local.json'),JSON.stringify({companyName:'테스트 회사',dbPath:'private/test.sqlite',port:8766}));
 c=loadConfig(dir);assert.equal(c.companyName,'테스트 회사');assert.equal(c.port,8766);assert.equal(c.dbPath,join(dir,'private','test.sqlite'));
 writeFileSync(join(dir,'config.local.json'),'{');assert.throws(()=>loadConfig(dir));
 writeFileSync(join(dir,'config.local.json'),JSON.stringify({port:-1}));assert.throws(()=>loadConfig(dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
