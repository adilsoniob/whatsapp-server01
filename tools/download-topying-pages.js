const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../src/config');
const BASE = 'https://msg.topying.net';
const OUT = path.join(__dirname, '..', 'data', 'topying-pages');
fs.mkdirSync(OUT, { recursive: true });
const routes = ['/sendSms/sendSmsShortcut','/sendSms/dynamicSmsContent','/sendSms/sendQueue','/sendSms/cycleSmsJob','/bill/sendRcd','/bill/receiveRcd','/bill/topupRcd','/count/userStat','/user/consumerRate','/sysconfig/consumerMyNumbers','/sysconfig/userSender','/quickconfig/setupWizard','/home'];
function mergeCookies(existing, response) { const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : []; const jar = new Map(existing); for (const cookie of setCookie) { const [pair] = cookie.split(';'); const i = pair.indexOf('='); if (i > 0) jar.set(pair.slice(0,i), pair.slice(i+1)); } return jar; }
function cookieHeader(jar) { return Array.from(jar.entries()).map(([k,v]) => `${k}=${v}`).join('; '); }
async function request(pathname, options = {}, jar = new Map()) { const response = await fetch(`${BASE}${pathname}`, { redirect:'manual', ...options, headers: { 'user-agent':'Mozilla/5.0 SMS Rotator Config Inspector', 'accept':'text/html,application/json,*/*', 'cookie':cookieHeader(jar), ...(options.headers||{}) }}); const nextJar=mergeCookies(jar,response); const text=await response.text(); return {response,text,jar:nextJar}; }
function pem(k){ return `-----BEGIN PUBLIC KEY-----\n${k.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`; }
function enc(k,p){ return crypto.publicEncrypt({key:pem(k),padding:crypto.constants.RSA_PKCS1_PADDING},Buffer.from(p,'utf8')).toString('base64'); }
(async()=>{
 const config=getConfig(); const account=config.accounts[0]; let jar=new Map(); let r=await request('/login',{},jar); jar=r.jar; r=await request('/loadPuk',{method:'POST'},jar); jar=r.jar; const puk=JSON.parse(r.text); const body=new URLSearchParams({username:account.account,pwd:enc(puk.data,process.env.SMS_PASSWORD_1||''),'CSRF-TOKEN':''}); r=await request('/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body},jar); jar=r.jar; if(r.response.status!==302) throw new Error('login failed '+r.response.status);
 const results=[];
 for (const route of routes) {
   try { const page=await request(route,{},jar); jar=page.jar; const name=route.replace(/^\//,'').replace(/[\/]/g,'_')+'.html'; fs.writeFileSync(path.join(OUT,name), page.text); results.push({route,status:page.response.status, length:page.text.length, terms:['smpp','api','host','port','gateway','sender','source','http','smtp'].filter(t=>page.text.toLowerCase().includes(t))}); }
   catch(e){ results.push({route,error:e.message}); }
 }
 console.log(JSON.stringify(results,null,2));
})();
