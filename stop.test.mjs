import {test} from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';

test('stop.cmd는 설정된 포트의 worklog Node 서버를 종료한다',{skip:process.platform!=='win32'},async()=>{
 const source=fileURLToPath(new URL('./stop.cmd',import.meta.url));
 assert.equal(existsSync(source),true,'stop.cmd가 필요합니다.');
 const dir=mkdtempSync(join(tmpdir(),'wm-stop-'));let child;
 try{
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  copyFileSync(source,join(dir,'stop.cmd'));writeFileSync(join(dir,'config.local.json'),JSON.stringify({port}));
  writeFileSync(join(dir,'server.mjs'),`import{createServer}from'node:http';createServer((q,s)=>s.end()).listen(${port},'127.0.0.1');`);
  child=spawn(process.execPath,['server.mjs'],{cwd:dir,stdio:'ignore'});
  await new Promise((resolve,reject)=>{const limit=Date.now()+5000;const check=()=>{const socket=new Socket();socket.once('connect',()=>{socket.destroy();resolve()});socket.once('error',()=>Date.now()<limit?setTimeout(check,50):reject(Error('서버 시작 실패')));socket.connect(port,'127.0.0.1')};check()});
  const result=spawnSync('cmd.exe',['/c','stop.cmd'],{cwd:dir,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr||result.stdout);assert.match(result.stdout,/stopped/);if(child.exitCode===null)await new Promise((resolve,reject)=>{child.once('exit',resolve);setTimeout(()=>reject(Error('서버가 종료되지 않음')),3000)});
 }finally{if(child&&child.exitCode===null)child.kill();await new Promise(r=>setTimeout(r,500));rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
