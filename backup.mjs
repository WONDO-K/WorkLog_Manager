import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,renameSync,unlinkSync,statSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';

// Synchronous snapshot: requests in this process cannot interleave with verification.
export function backupStore(db,directory){
 const root=resolve(directory);mkdirSync(root,{recursive:true});
 const name=`worklog-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID()}.sqlite`;
 const target=join(root,name),partial=target+'.partial';let check;
 try{
  db.prepare('VACUUM INTO ?').run(partial);
  check=new DatabaseSync(partial,{readOnly:true});
  if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length)throw Error('백업 무결성 확인 실패');
  for(const table of ['owners','tasks','events','daily_logs'])if(check.prepare(`SELECT count(*) AS n FROM ${table}`).get().n!==db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n)throw Error('백업 중 데이터가 변경되었습니다. 다시 시도하세요.');
  check.close();check=null;renameSync(partial,target);
 }catch(error){check?.close();if(existsSync(partial))unlinkSync(partial);throw error;}
 let warning='';
 const files=readdirSync(root).filter(n=>/^worklog-\d{4}-\d{2}-\d{2}T[\d-]+Z-[a-f0-9-]{36}\.sqlite$/.test(n)).map(n=>({name:n,time:statSync(join(root,n)).mtimeMs})).sort((a,b)=>b.time-a.time||b.name.localeCompare(a.name));
 // Delete only generated files in the exact backup directory, after a verified new snapshot.
 for(const item of files.slice(30)){const old=resolve(root,item.name);if(dirname(old)!==root)throw Error('잘못된 백업 경로');try{unlinkSync(old)}catch{warning='백업 완료. 일부 오래된 백업을 정리하지 못했습니다.'}}
 return {file:name,createdAt:new Date().toISOString(),warning};
}
