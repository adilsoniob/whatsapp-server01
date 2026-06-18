const crypto = require('crypto');
const { getConfig } = require('../src/config');

const BASE = 'https://msg.topying.net';

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

async function request(path, options = {}, jar = new Map()) {
  const response = await fetch(`${BASE}${path}`, {
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
  return { response, text, jar: nextJar };
}

function publicKeyPem(base64Key) {
  return `-----BEGIN PUBLIC KEY-----\n${base64Key.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
}

function encryptPassword(publicKey, password) {
  return crypto.publicEncrypt({
    key: publicKeyPem(publicKey),
    padding: crypto.constants.RSA_PKCS1_PADDING
  }, Buffer.from(password, 'utf8')).toString('base64');
}

function extractLinks(html) {
  const links = [];
  const regex = /href=["']([^"'#]+)["']/gi;
  let match;
  while ((match = regex.exec(html)) && links.length < 80) {
    links.push(match[1]);
  }
  return Array.from(new Set(links));
}

function findInteresting(text) {
  const terms = ['smpp', 'api', 'http', 'smtp', 'interface', 'password', 'gateway', 'port', 'host', 'source', 'sender', 'account'];
  const lower = text.toLowerCase();
  return terms.filter((term) => lower.includes(term));
}

(async () => {
  const config = getConfig();
  const account = config.accounts[0];
  if (!account) throw new Error('Nenhuma conta configurada.');

  let jar = new Map();
  let result = await request('/login', {}, jar);
  jar = result.jar;

  result = await request('/loadPuk', { method: 'POST' }, jar);
  jar = result.jar;
  const puk = JSON.parse(result.text);
  if (puk.state !== 0 || !puk.data) throw new Error(`Falha ao carregar chave publica: ${result.text}`);

  const encrypted = encryptPassword(puk.data, process.env.SMS_PASSWORD_1 || '');
  const body = new URLSearchParams({
    username: account.account,
    pwd: encrypted,
    'CSRF-TOKEN': ''
  });

  result = await request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  }, jar);
  jar = result.jar;

  console.log(JSON.stringify({
    loginStatus: result.response.status,
    loginLocation: result.response.headers.get('location'),
    loginInterestingTerms: findInteresting(result.text),
    loginPreview: result.text.replace(/\s+/g, ' ').slice(0, 500)
  }, null, 2));

  const location = result.response.headers.get('location');
  if (location) {
    const nextPath = location.startsWith('http') ? new URL(location).pathname : location;
    result = await request(nextPath, {}, jar);
    jar = result.jar;
    console.log(JSON.stringify({
      homeStatus: result.response.status,
      homePath: nextPath,
      homeInterestingTerms: findInteresting(result.text),
      links: extractLinks(result.text),
      homePreview: result.text.replace(/\s+/g, ' ').slice(0, 800)
    }, null, 2));
  }
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
