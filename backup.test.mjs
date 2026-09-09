import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {openStore} from './server.mjs';
import {backupStore} from './backup.mjs';
test('검증된 백업 30개 보존, 복구 가능, 실패 시 기존 백업 보존',()=>{
 const dir=mkdtempSync(join(tmpdir(),'wm-backup-'));const db=openStore(join(dir,'source.sqlite'));const dest=join(dir,'backups');
 try{
  db.prepare('UPDATE owners SET name=? WHERE id=?').run('복구 확인','local-owner');
  for(let n=0;n<31;n++)backupStore(db,dest);
  const files=readdirSync(dest);assert.equal(files.length,30);
  const restore=new DatabaseSync(join(dest,files.at(-1)),{readOnly:true});
  assert.equal(restore.prepare('SELECT name FROM owners').get().name,'복구 확인');restore.close();
  const before=readdirSync(dest);db.close();assert.throws(()=>backupStore(db,dest));assert.deepEqual(readdirSync(dest),before);
  writeFileSync(join(dest,'keep.txt'),'unrelated');assert.ok(readdirSync(dest).includes('keep.txt'));
 }finally{try{db.close()}catch{}}
});
