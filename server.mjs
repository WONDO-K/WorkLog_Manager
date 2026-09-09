import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadConfig} from './config.mjs';
import {backupStore} from './backup.mjs';

const states=['할 일','진행 중','완료','보류'];
export function openStore(path){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version>2){db.close();throw Error('지원하지 않는 DB 구조 버전');}
 db.exec(`CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 INSERT OR IGNORE INTO owners VALUES('local-owner','사용자');
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),title TEXT NOT NULL,request TEXT NOT NULL,criteria TEXT NOT NULL,deadline TEXT NOT NULL,target_date TEXT NOT NULL,next_action TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('할 일','진행 중','완료','보류')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),owner_id TEXT NOT NULL REFERENCES owners(id),created_at TEXT NOT NULL,note TEXT NOT NULL,changes TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_task ON events(task_id,created_at);`);
 if(version<1)db.exec('PRAGMA user_version=1;');
 if(version<2)db.exec(`CREATE TABLE daily_logs(work_date TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),internal_md TEXT NOT NULL,public_md TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('초안','확정')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,confirmed_at TEXT NOT NULL);
 CREATE INDEX daily_logs_updated ON daily_logs(updated_at);
 PRAGMA user_version=2;`);
 return db;
}
function fail(status,message){throw Object.assign(Error(message),{status});}
function fields(data){
 const result={};for(const key of ['title','request','criteria','deadline','target_date','next_action']){
  const v=data[key]??'';if(typeof v!=='string'||v.length>20000)fail(400,'입력 길이나 형식을 확인하세요.');result[key]=v.trim();
 }
 if(!result.title||!result.request)fail(400,'제목과 요청 내용은 필수입니다.');
 if(result.title.length>200)fail(400,'제목은 200자 이내로 입력하세요.');
 for(const k of ['deadline','target_date'])if(result[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(result[k])||Number.isNaN(Date.parse(result[k]))||new Date(result[k]).toISOString().slice(0,10)!==result[k]))fail(400,'날짜를 확인하세요.');return result;
}
export function createApp(db,config={companyName:'내 업무'}){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const page=readFileSync(new URL('./index.html',import.meta.url),'utf8').replaceAll('WORKLOG_COMPANY',escape(config.companyName));
 const get=id=>{const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(id);if(!t)fail(404,'업무를 찾지 못했습니다.');return {...t,events:db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY created_at,rowid').all(id)};};
 const getDaily=date=>db.prepare('SELECT * FROM daily_logs WHERE work_date=?').get(date)??{work_date:date,internal_md:'',public_md:'',status:'초안',version:0,created_at:'',updated_at:'',confirmed_at:''};
 const readJson=async req=>{
  if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'JSON 형식이 필요합니다.');
  let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>500000)fail(413,'입력이 너무 큽니다.');text+=chunk;}
  try{const data=JSON.parse(text);if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'입력 형식을 확인하세요.');return data;}catch(e){if(e.status)throw e;fail(400,'입력 형식을 확인하세요.');}
 };
 return createServer(async(req,res)=>{
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   const expected=`127.0.0.1:${req.socket.localPort}`;
   if(req.headers.host!==expected||(req.headers.origin&&req.headers.origin!==`http://${expected}`)||req.headers['sec-fetch-site']==='cross-site')fail(403,'이 PC의 로컬 화면에서 접근하세요.');
   const path=new URL(req.url,`http://${expected}`).pathname;
   if(req.method==='GET'&&path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff'});return res.end(page);}
   if(req.method==='GET'&&path==='/api/tasks')return json(200,db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC,rowid DESC').all());
   if(req.method==='POST'&&path==='/api/backup'){
    if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'JSON 형식이 필요합니다.');
    if(!config.dbPath)fail(503,'DB 경로 설정이 필요합니다.');
    try{return json(201,backupStore(db,resolve(dirname(config.dbPath),'backups')));}catch{fail(500,'백업에 실패했습니다. 기존 백업을 보존했습니다. 저장 공간과 권한을 확인하세요.');}
   }
   const daily=path.match(/^\/api\/daily-logs\/(\d{4}-\d{2}-\d{2})(\/confirm)?$/);
   if(daily){
    const date=daily[1];
    if(Number.isNaN(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail(400,'날짜를 확인하세요.');
    if(req.method==='GET'&&!daily[2])return json(200,getDaily(date));
    const data=await readJson(req);
    if(!Number.isInteger(data.version)||data.version<0)fail(400,'기록 버전을 확인하세요.');
    if(req.method==='PUT'&&!daily[2]){
     for(const key of ['internal_md','public_md'])if(typeof data[key]!=='string'||data[key].length>200000)fail(400,'요약 내용을 확인하세요.');
     const now=new Date().toISOString(),old=getDaily(date);
     if(data.version!==old.version)fail(409,'다른 변경이 먼저 저장되었습니다. 최신 일일 기록을 불러오세요.');
     db.exec('BEGIN IMMEDIATE');try{
      if(old.version===0)db.prepare('INSERT INTO daily_logs VALUES(?,?,?,?,?,?,?,?,?)').run(date,'local-owner',data.internal_md,data.public_md,'초안',1,now,now,'');
      else db.prepare("UPDATE daily_logs SET internal_md=?,public_md=?,status='초안',version=version+1,updated_at=?,confirmed_at='' WHERE work_date=?").run(data.internal_md,data.public_md,now,date);
      db.exec('COMMIT');
     }catch(e){db.exec('ROLLBACK');throw e;}
     return json(200,getDaily(date));
    }
    if(req.method==='POST'&&daily[2]){
     const old=getDaily(date);
     if(!old.version)fail(404,'먼저 일일 요약 초안을 저장하세요.');
     if(data.version!==old.version)fail(409,'다른 변경이 먼저 저장되었습니다. 최신 일일 기록을 불러오세요.');
     if(!old.public_md.trim())fail(400,'외부용 내용을 작성한 뒤 확정하세요.');
     const now=new Date().toISOString();db.prepare("UPDATE daily_logs SET status='확정',version=version+1,updated_at=?,confirmed_at=? WHERE work_date=?").run(now,now,date);
     return json(200,getDaily(date));
    }
    fail(405,'지원하지 않는 요청입니다.');
   }
   const id=path.startsWith('/api/tasks/')?path.slice('/api/tasks/'.length):null;
   if(req.method==='GET'&&id)return json(200,get(id));
   if(!((req.method==='POST'&&path==='/api/tasks')||(req.method==='PATCH'&&id)))fail(404,'지원하지 않는 경로입니다.');
   const data=await readJson(req);
   const input=fields(data),now=new Date().toISOString();
   if(req.method==='POST'){
    const taskId=randomUUID();db.exec('BEGIN IMMEDIATE');try{
     db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(taskId,'local-owner',input.title,input.request,input.criteria,input.deadline,input.target_date,input.next_action,'할 일',1,now,now);
     db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(randomUUID(),taskId,'local-owner',now,'요청 접수',JSON.stringify(input));db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}return json(201,get(taskId));
   }
   if(!states.includes(data.status))fail(400,'상태를 확인하세요.');
   if(typeof(data.note??'')!=='string'||(data.note??'').length>20000)fail(400,'기록 내용을 확인하세요.');
   const note=(data.note??'').trim();db.exec('BEGIN IMMEDIATE');try{
    const old=get(id);if(data.version!==old.version)fail(409,'다른 변경이 먼저 저장되었습니다. 입력 내용을 복사한 뒤 최신 기록을 불러오세요.');
    if(data.status!==old.status&&['완료','보류'].includes(data.status)&&!note)fail(400,'완료 검증 근거 또는 보류 사유를 진행 기록에 입력하세요.');
    const changes={};for(const [k,v]of Object.entries({...input,status:data.status}))if(old[k]!==v)changes[k]={before:old[k],after:v};
    if(!note&&!Object.keys(changes).length)fail(400,'변경 내용이 없습니다.');
    db.prepare('UPDATE tasks SET title=?,request=?,criteria=?,deadline=?,target_date=?,next_action=?,status=?,version=version+1,updated_at=? WHERE id=?').run(input.title,input.request,input.criteria,input.deadline,input.target_date,input.next_action,data.status,now,id);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?)').run(randomUUID(),id,'local-owner',now,note||'업무 정보 수정',JSON.stringify(changes));db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}return json(200,get(id));
  }catch(e){json(e.status??500,{error:e.status?e.message:'저장에 실패했습니다. 입력을 보존하고 다시 시도하세요.'});}
 });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const config=loadConfig(dirname(fileURLToPath(import.meta.url)));
 const db=openStore(config.dbPath);const port=config.port;const server=createApp(db,config);
 server.on('error',e=>{console.error(e.message);db.close();process.exitCode=1;});
 server.listen(port,'127.0.0.1',()=>console.log(`업무 기록: http://127.0.0.1:${port}`));
 const stop=()=>server.close(()=>{db.close();process.exit(0);});process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
