const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfig } = require('../src/config');
const BASE='https://msg.topying.net';
function merge(j,r){ const sc=r.headers.getSetCookie?r.headers.getSetCookie():[]; const n=new Map(j); for(const c of sc){const [p]=c.split(';'); const i=p.indexOf('='); if(i>0)n.set(p.slice(0,i),p.slice(i+1));} return n; }
function ch(j){return Array.from(j.entries()).map(([k,v])=>`${k}=${v}`).join('; ')}
async function req(p,o={},j=new Map()){const r=await fetch(BASE+p,{redirect:'manual',...o,headers:{'user-agent':'Mozilla/5.0','cookie':ch(j),...(o.headers||{})}}); const t=await r.arrayBuffer(); return {r,buf:Buffer.from(t),text:Buffer.from(t).toString('utf8'),j:merge(j,r)};}
function pem(k){return `-----BEGIN PUBLIC KEY-----\n${k.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`}
function enc(k,p){return crypto.publicEncrypt({key:pem(k),padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(p)).toString('base64')}
(async()=>{let j=new Map(); let x=await req('/login',{},j); j=x.j; x=await req('/loadPuk',{method:'POST'},j); j=x.j; const puk=JSON.parse(x.text); const c=getConfig(); const body=new URLSearchParams({username:c.accounts[0].account,pwd:enc(puk.data,process.env.SMS_PASSWORD_1||''),'CSRF-TOKEN':''}); x=await req('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body},j); j=x.j; x=await req('/fileDownload/manual/downloadManual.ajax',{method:'POST'},j); j=x.j; console.log({status:x.r.status, type:x.r.headers.get('content-type'), disposition:x.r.headers.get('content-disposition'), length:x.buf.length, preview:x.text.slice(0,200)}); fs.writeFileSync(path.join(__dirname,'..','data','manual-download.bin'),x.buf);})();
