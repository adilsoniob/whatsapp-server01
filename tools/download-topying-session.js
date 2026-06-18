const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getConfig } = require('../src/config');

const BASE = 'https://msg.topying.net';
const OUT = path.join(__dirname, '..', 'data', 'topying-inspect');
fs.mkdirSync(OUT, { recursive: true });

function mergeCookies(existing, response) {
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  const jar = new Map(existing);
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const index = pair.indexOf('=');
    if (index > 0) jar.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return jar;
}

function cookieHeader(jar) {
  return Array.from(jar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
}

async function request(pathname, options = {}, jar = new Map()) {
  const url = pathname.startsWith('http') ? pathname : `${BASE}${pathname}`;
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      'user-agent': 'Mozilla/5.0 SMS Rotator Config Inspector',
      'accept': 'text/html,application/json,*/*',
      'cookie': cookieHeader(jar),
      ...(options.headers || {})
    }
  });
  const nextJar = mergeCookies(jar, response);
  const text = await response.text();
  return { response, text, jar: nextJar, url };
}

function publicKeyPem(base64Key) {
  return `-----BEGIN PUBLIC KEY-----\n${base64Key.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
}

function encryptPassword(publicKey, password) {
  return crypto.publicEncrypt({ key: publicKeyPem(publicKey), padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(password, 'utf8')).toString('base64');
}

function extractAssets(html) {
  const found = new Set();
  for (const regex of [/src=["']([^"']+)["']/gi, /href=["']([^"']+)["']/gi]) {
    let match;
    while ((match = regex.exec(html))) {
      const value = match[1];
      if (value.startsWith('/assets/') && !value.includes('/css/') && !value.match(/\.(png|jpg|gif|ico|css)/i)) found.add(value);
    }
  }
  return Array.from(found);
}

(async () => {
  const config = getConfig();
  const account = config.accounts[0];
  let jar = new Map();
  let result = await request('/login', {}, jar);
  jar = result.jar;
  result = await request('/loadPuk', { method: 'POST' }, jar);
  jar = result.jar;
  const puk = JSON.parse(result.text);
  const encrypted = encryptPassword(puk.data, process.env.SMS_PASSWORD_1 || '');
  const body = new URLSearchParams({ username: account.account, pwd: encrypted, 'CSRF-TOKEN': '' });
  result = await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }, jar);
  jar = result.jar;
  const location = result.response.headers.get('location') || '/index';
  result = await request(location, {}, jar);
  jar = result.jar;
  fs.writeFileSync(path.join(OUT, 'index.html'), result.text);

  const assets = extractAssets(result.text).slice(0, 200);
  const saved = [];
  for (const asset of assets) {
    try {
      const assetResult = await request(asset, {}, jar);
      const safeName = asset.replace(/^\//, '').replace(/[\\/:*?"<>|=&]/g, '_');
      fs.writeFileSync(path.join(OUT, safeName), assetResult.text);
      saved.push(asset);
    } catch (error) {
      saved.push(`${asset} ERROR ${error.message}`);
    }
  }

  console.log(JSON.stringify({ loggedIn: true, savedDir: OUT, assets: saved }, null, 2));
})();
