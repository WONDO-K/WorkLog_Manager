import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
export function loadConfig(root){
 const file=join(root,'config.local.json');
 const raw=existsSync(file)?JSON.parse(readFileSync(file,'utf8').replace(/^\uFEFF/,'')):{};
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('config.local.json 형식을 확인하세요.');
 const config={companyName:'내 업무',dbPath:'data/worklog.sqlite',exportDir:'',port:8765,...raw};
 if(typeof config.companyName!=='string'||!config.companyName.trim()||config.companyName.length>100)throw Error('회사명은 1~100자 문자열이어야 합니다.');
 if(typeof config.dbPath!=='string'||!config.dbPath.trim())throw Error('DB 경로를 확인하세요.');
 if(typeof config.exportDir!=='string')throw Error('Markdown 내보내기 경로를 확인하세요.');
 if(!Number.isInteger(config.port)||config.port<1024||config.port>65535)throw Error('포트는 1024~65535 정수여야 합니다.');
 config.dbPath=resolve(root,config.dbPath);config.exportDir=config.exportDir.trim()?resolve(root,config.exportDir):'';return config;
}
