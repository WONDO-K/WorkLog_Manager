import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {loadConfig} from './config.mjs';

const states=['할 일','진행 중','완료','보류'];
export function openStore(path){
 mkdirSync(dirname(path),{recursive:true});const db=new DatabaseSync(path);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version>1){db.close();throw Error('지원하지 않는 DB 구조 버전');}
 db.exec(`CREATE TABLE IF NOT EXISTS owners(id TEXT PRIMARY KEY,name TEXT NOT NULL);
 INSERT OR IGNORE INTO owners VALUES('local-owner','사용자');
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES owners(id),title TEXT NOT NULL,request TEXT NOT NULL,criteria TEXT NOT NULL,deadline TEXT NOT NULL,target_date TEXT NOT NULL,next_action TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('할 일','진행 중','완료','보류')),version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES tasks(id),owner_id TEXT NOT NULL REFERENCES owners(id),created_at TEXT NOT NULL,note TEXT NOT NULL,changes TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS events_task ON events(task_id,created_at);
 PRAGMA user_version=1;`);return db;
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
 return createServer(async(req,res)=>{
  const json=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));};
  try{
   const expected=`127.0.0.1:${req.socket.localPort}`;
   if(req.headers.host!==expected||(req.headers.origin&&req.headers.origin!==`http://${expected}`)||req.headers['sec-fetch-site']==='cross-site')fail(403,'이 PC의 로컬 화면에서 접근하세요.');
   const path=new URL(req.url,`http://${expected}`).pathname;
   if(req.method==='GET'&&path==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff'});return res.end(page);}
   if(req.method==='GET'&&path==='/api/tasks')return json(200,db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC,rowid DESC').all());
   const id=path.startsWith('/api/tasks/')?path.slice('/api/tasks/'.length):null;
   if(req.method==='GET'&&id)return json(200,get(id));
   if(!((req.method==='POST'&&path==='/api/tasks')||(req.method==='PATCH'&&id)))fail(404,'지원하지 않는 경로입니다.');
   if(!req.headers['content-type']?.startsWith('application/json'))fail(415,'JSON 형식이 필요합니다.');
   let body='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>100000)fail(413,'입력이 너무 큽니다.');body+=chunk;}
   let data;try{data=JSON.parse(body);}catch{fail(400,'입력 형식을 확인하세요.');}
   if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'입력 형식을 확인하세요.');
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
