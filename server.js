const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getConfig } = require('./src/config');
const { AccountRotator } = require('./src/accountRotator');
const { JobStore } = require('./src/jobStore');
const { SmsProvider } = require('./src/smsProvider');
const { UserStore } = require('./src/auth/userStore');
const { SessionStore } = require('./src/auth/sessionStore');
const { verifyPassword } = require('./src/auth/passwords');
const { parseCookies, setCookie, clearCookie } = require('./src/auth/http');
const { SmsAccountStore } = require('./src/smsAccountStore');
const { StorefrontStore } = require('./src/storefrontStore');

let config = getConfig();
const store = new JobStore({ dataDir: config.dataDir });
const users = new UserStore({ dataDir: config.dataDir });
const sessions = new SessionStore({ dataDir: config.dataDir });
const smsAccounts = new SmsAccountStore({ dataDir: config.dataDir });
const storefront = new StorefrontStore({ dataDir: config.dataDir });
const rotator = new AccountRotator({
  accounts: config.accounts,
  rotationLimit: config.rotationLimit,
  statePath: path.join(config.dataDir, 'rotation-state.json')
});
const provider = new SmsProvider({ mode: config.providerMode, api: config.api, smpp: config.smpp, panel: config.panel });

let processing = false;

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendJsonError(res, statusCode, message, extra) {
  const payload = { error: message };
  if (extra && typeof extra === 'object') {
    for (const [key, value] of Object.entries(extra)) {
      if (value === undefined) continue;
      payload[key] = value;
    }
  }
  sendJson(res, statusCode, payload);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function reloadAccounts() {
  // Atualiza a lista de contas carregadas (env + data/accounts.json) sem reiniciar o servidor.
  config = getConfig();
  rotator.accounts = config.accounts;
  rotator.rotationLimit = config.rotationLimit;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseJsonBody(rawBody) {
  const text = String(rawBody || '');
  const trimmed = text.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    // Alguns clientes acabam enviando body "vazio" com whitespace exotico que passa no trim,
    // mas ainda assim quebra o JSON.parse com "Unexpected end of JSON input".
    if (trimmed.replace(/\s/g, '') === '') return {};
    throw error;
  }
}

async function readJsonPayload(req, res) {
  const rawBody = await readBody(req);
  try {
    return parseJsonBody(rawBody);
  } catch (error) {
    sendJsonError(res, 400, 'JSON invalido.', { details: error.message });
    return null;
  }
}

function parseSmsInput(payload) {
  const selectedAccounts = Array.isArray(payload.selectedAccounts)
    ? payload.selectedAccounts.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const rotationLimit = normalizeRotationLimit(payload.rotationLimit);
  const message = sanitizeMessageRaw(payload.message);

  if (Array.isArray(payload.items)) {
    return payload.items.map((item) => ({
      phone: String(item.phone || '').trim(),
      message: sanitizeMessageRaw(item.message),
      selectedAccounts,
      rotationLimit
    }));
  }

  if (payload.phone && message) {
    return [{ phone: String(payload.phone).trim(), message, selectedAccounts, rotationLimit }];
  }

  if (payload.bulkText && message) {
    return String(payload.bulkText)
      .split(/\r?\n/)
      .map((phone) => ({ phone: phone.trim(), message, selectedAccounts, rotationLimit }))
      .filter((item) => item.phone);
  }

  return [];
}

function normalizeRotationLimit(value) {
  const limit = Number(value || config.rotationLimit);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : config.rotationLimit;
}

function sanitizeMessageRaw(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function sanitizeMessageFinal(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePhoneRaw(value) {
  return String(value || '')
    .replace(/[^\d+]/g, '')
    .trim();
}

function pad2(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.floor(number)).padStart(2, '0') : '00';
}

function formatHora(now) {
  const date = now instanceof Date ? now : new Date();
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function formatData(now) {
  const date = now instanceof Date ? now : new Date();
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function randomChars(length) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(Math.max(1, length));
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet[bytes[i] % alphabet.length];
  }
  return result;
}

function renderMessageTemplate(template, { now } = {}) {
  const coupon = `CUPOM${randomChars(5)}`;
  const date = now instanceof Date ? now : new Date();

  return String(template || '').replace(/\{\{\s*(HORA|DATA|CUPOM)\s*\}\}/gi, (_, token) => {
    const normalized = String(token || '').toUpperCase();
    if (normalized === 'HORA') return formatHora(date);
    if (normalized === 'DATA') return formatData(date);
    if (normalized === 'CUPOM') return coupon;
    return '';
  });
}

function validateItems(items) {
  const valid = [];
  const invalid = [];

  for (const item of items) {
    if (!item.phone || !item.message) {
      invalid.push({ ...item, reason: 'Telefone e mensagem sao obrigatorios.' });
      continue;
    }

    const maxLen = Number.isFinite(Number(item.maxMessageLength)) ? Math.floor(Number(item.maxMessageLength)) : 162;
    if (item.message.length > maxLen) {
      invalid.push({ ...item, reason: `Mensagem acima de ${maxLen} caracteres.` });
      continue;
    }

    valid.push(item);
  }

  return { valid, invalid };
}

function buildAdminRouteTestItems(payload, user) {
  const availableAccounts = new Set(config.accounts.map((item) => item.account));
  const selectedAccounts = Array.isArray(payload.accounts)
    ? payload.accounts.map((item) => String(item || '').trim()).filter((item) => availableAccounts.has(item))
    : [];
  const phones = Array.isArray(payload.phones)
    ? payload.phones.map((item) => sanitizePhoneRaw(item)).filter(Boolean)
    : [];
  const message = sanitizeMessageRaw(payload.message);

  if (selectedAccounts.length === 0) {
    throw new Error('Selecione pelo menos 1 conta para testar.');
  }

  if (phones.length === 0) {
    throw new Error('Informe pelo menos 1 numero para teste.');
  }

  if (phones.length > 5) {
    throw new Error('Use no maximo 5 numeros para teste.');
  }

  if (!message) {
    throw new Error('Informe a mensagem de teste.');
  }

  const now = new Date();
  const renderedMessage = sanitizeMessageFinal(renderMessageTemplate(message, { now }));
  const items = [];

  for (const account of selectedAccounts) {
    for (const phone of phones) {
      for (let index = 0; index < 1; index += 1) {
        items.push({
          phone,
          message: renderedMessage,
          selectedAccounts: [account],
          rotationLimit: 1,
          createdBy: { userId: user.id, username: user.username },
          billable: false,
          creditCharged: false,
          creditRefunded: false,
          maxMessageLength: 162
        });
      }
    }
  }

  return {
    items,
    selectedAccounts,
    phones
  };
}

function getAuthUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies.sid;
  const session = sessions.get(sid);
  if (!session) return null;
  const user = users.getById(session.userId);
  if (!user || user.disabled) return null;
  return user;
}

function requireAuth(req, res) {
  const user = getAuthUser(req);
  if (!user) {
    sendJson(res, 401, { error: 'Nao autenticado.' });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: `Acesso restrito ao admin. (role atual: ${user.role})` });
    return null;
  }
  return user;
}

function requireWebhook(req, res) {
  if (!config.webhook || !config.webhook.apiKey) {
    sendJsonError(res, 503, 'Webhook desativado. Configure WEBHOOK_API_KEY no .env.');
    return null;
  }

  const headerKey = String(req.headers['x-api-key'] || '').trim();
  const auth = String(req.headers.authorization || '').trim();
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  const key = headerKey || bearer;

  if (!key || key !== config.webhook.apiKey) {
    sendJsonError(res, 401, 'Chave do webhook invalida.');
    return null;
  }

  return { role: 'webhook' };
}

async function processQueue() {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const job = store.nextQueuedJob();
      if (!job) break;

      const selectedAccounts = Array.isArray(job.selectedAccounts) ? job.selectedAccounts : [];
      const account = rotator.getCurrentAccount(selectedAccounts, job.rotationLimit);
      store.updateJob(job.id, {
        status: 'sending',
        attempts: job.attempts + 1,
        account: account.account,
        lastError: null
      });

      try {
        const result = await provider.send({ account, phone: job.phone, message: job.message });
        rotator.markSuccess(account, selectedAccounts, job.rotationLimit);
        const sentJob = store.updateJob(job.id, {
          status: 'sent',
          providerResponse: result,
          lastError: null
        });
        store.appendLog({ type: 'sent', job: sentJob });
      } catch (error) {
        const patch = { status: 'failed', lastError: error.message };

        // Regra: se nao enviou, nao desconta credito (refund de falha).
        if (
          job &&
          job.billable &&
          job.creditCharged &&
          !job.creditRefunded &&
          job.createdBy &&
          job.createdBy.userId
        ) {
          try {
            const targetUser = users.getById(job.createdBy.userId);
            if (targetUser && targetUser.role !== 'admin') {
              users.update(job.createdBy.userId, { creditsDelta: 1 });
              patch.creditRefunded = true;
            }
          } catch {
            // Se falhar o refund, nao derruba o worker. O job segue como failed.
          }
        }

        const failedJob = store.updateJob(job.id, patch);
        store.appendLog({ type: 'failed', job: failedJob });
      }
    }
  } finally {
    processing = false;
  }
}

function serveStatic(req, res) {
  const publicDir = path.join(config.rootDir, 'public');
  const requestedPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);

  // Evita acesso direto aos arquivos protegidos por auth via rotas /admin, /app, etc.
  const protectedRedirects = {
    '/admin.html': '/admin',
    '/user.html': '/app',
    '/admin-monitor.html': '/admin/monitor',
    '/login.html': '/login',
    '/setup.html': '/setup'
  };
  if (protectedRedirects[requestedPath]) {
    redirect(res, protectedRedirects[requestedPath]);
    return;
  }
  const filePath = path.normalize(path.join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };

  res.writeHead(200, {
    'content-type': contentTypes[ext] || 'application/octet-stream',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    expires: '0'
  });
  fs.createReadStream(filePath).pipe(res);
}

function servePublicFile(res, relativePath) {
  const publicDir = path.join(config.rootDir, 'public');
  const filePath = path.join(publicDir, relativePath);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8'
  };

  res.writeHead(200, {
    'content-type': contentTypes[ext] || 'application/octet-stream',
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    expires: '0'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Pagina inicial: sempre vai para login / setup.
    if (pathname === '/' && req.method === 'GET') {
      redirect(res, users.count() === 0 ? '/setup' : '/login');
      return;
    }

    // Setup inicial: cria o primeiro admin (somente se nao existir nenhum usuario ainda).
    if (pathname === '/setup' && req.method === 'GET') {
      if (users.count() !== 0) {
        redirect(res, '/login');
        return;
      }
      servePublicFile(res, 'setup.html');
      return;
    }

    if (pathname === '/login' && req.method === 'GET') {
      servePublicFile(res, 'login.html');
      return;
    }

    if (pathname === '/app' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        redirect(res, '/login');
        return;
      }
      servePublicFile(res, 'user.html');
      return;
    }

    if (pathname === '/admin' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        redirect(res, '/login');
        return;
      }
      if (user.role !== 'admin') {
        redirect(res, '/app');
        return;
      }
      servePublicFile(res, 'admin.html');
      return;
    }

    if (pathname === '/admin/monitor' && req.method === 'GET') {
      const user = getAuthUser(req);
      if (!user) {
        redirect(res, '/login');
        return;
      }
      if (user.role !== 'admin') {
        redirect(res, '/app');
        return;
      }
      servePublicFile(res, 'admin-monitor.html');
      return;
    }

    if (pathname === '/api/setup/status' && req.method === 'GET') {
      sendJson(res, 200, { needsSetup: users.count() === 0 });
      return;
    }

    if (pathname === '/api/public/storefront' && req.method === 'GET') {
      sendJson(res, 200, storefront.getPublic());
      return;
    }

    if (pathname === '/api/setup' && req.method === 'POST') {
      if (users.count() !== 0) {
        sendJsonError(res, 403, 'Setup ja concluido.');
        return;
      }

      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const admin = users.create({
        username: payload.username,
        password: payload.password,
        role: 'admin',
        allowedAccounts: config.accounts.map((a) => a.account)
      });

      const session = sessions.create({ userId: admin.id });
      setCookie(res, 'sid', session.id, { httpOnly: true, sameSite: 'Lax' });
      sendJson(res, 201, { ok: true });
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const user = users.getByUsername(payload.username);

      if (!user || user.disabled || !verifyPassword(payload.password, user.password)) {
        sendJsonError(res, 401, 'Usuario ou senha invalidos.');
        return;
      }

      const session = sessions.create({ userId: user.id });
      setCookie(res, 'sid', session.id, { httpOnly: true, sameSite: 'Lax' });
      sendJson(res, 200, { ok: true, role: user.role });
      return;
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const cookies = parseCookies(req.headers.cookie);
      if (cookies.sid) sessions.delete(cookies.sid);
      clearCookie(res, 'sid');
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/me' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      sendJson(res, 200, {
        id: user.id,
        username: user.username,
        role: user.role,
        allowedAccounts: Array.isArray(user.allowedAccounts) ? user.allowedAccounts : [],
        paused: Boolean(user.paused),
        creditsRemaining: Number.isFinite(user.creditsRemaining) ? user.creditsRemaining : 0
      });
      return;
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      sendJson(res, 200, {
        providerMode: config.providerMode,
        queue: store.summary(),
        rotation: rotator.status(),
        accounts: config.accounts.map((item) => ({ account: item.account, hasSmppPassword: item.hasSmppPassword })),
        panelStatuses: provider.getPanelStatuses(config.accounts),
        processing
      });
      return;
    }

    if (pathname === '/api/accounts/check' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      if (config.providerMode !== 'panel') {
        sendJsonError(res, 400, 'A verificacao de login so esta disponivel com SMS_PROVIDER_MODE=panel.');
        return;
      }

      const statuses = await provider.checkPanelAccounts(config.accounts);
      sendJson(res, 200, { statuses });
      return;
    }

    if (pathname === '/api/webhook/send' && req.method === 'POST') {
      const webhook = requireWebhook(req, res);
      if (!webhook) return;

      const payload = await readJsonPayload(req, res);
      if (!payload) return;

      const baseItems = parseSmsInput(payload);
      const selectedAccountsFromPayload = Array.isArray(payload.selectedAccounts)
        ? payload.selectedAccounts.map((item) => String(item).trim()).filter(Boolean)
        : [];
      const selectedAccounts = selectedAccountsFromPayload.length > 0
        ? selectedAccountsFromPayload
        : (Array.isArray(config.webhook.defaultAccounts) ? config.webhook.defaultAccounts : []);

      const now = new Date();
      const items = baseItems.map((item) => ({
        ...item,
        message: sanitizeMessageFinal(renderMessageTemplate(item.message, { now })),
        createdBy: { userId: 'webhook', username: 'webhook' },
        billable: false,
        creditCharged: false,
        creditRefunded: false,
        maxMessageLength: 162,
        selectedAccounts
      }));
      const { valid, invalid } = validateItems(items);

      if (valid.length === 0) {
        const hint = invalid && invalid.length && invalid[0] && invalid[0].reason ? ` Motivo: ${invalid[0].reason}` : '';
        sendJson(res, 400, { error: `Nenhum SMS valido para enfileirar.${hint}`, invalid });
        return;
      }

      const jobs = store.addJobs(valid);
      processQueue().catch((error) => store.appendLog({ type: 'processor_error', error: error.message }));
      sendJson(res, 202, { queued: jobs.length, invalid, jobs });
      return;
    }

    if (pathname === '/api/send' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;

      if (user.role !== 'admin' && user.paused) {
        sendJsonError(res, 403, 'Seu envio esta pausado. Fale com o administrador para recarregar creditos.');
        return;
      }
      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const baseItems = parseSmsInput(payload);

      const allowedAccounts = Array.isArray(user.allowedAccounts) ? user.allowedAccounts : [];
      if (user.role !== 'admin' && allowedAccounts.length === 0) {
        sendJsonError(res, 403, 'Seu usuario nao possui contas liberadas. Fale com o administrador.');
        return;
      }

      // Usuario normal nunca escolhe conta no payload: sempre usa o vinculo configurado no admin.
      const now = new Date();
      const items = baseItems.map((item) => ({
        ...item,
        message: sanitizeMessageFinal(renderMessageTemplate(item.message, { now })),
        createdBy: { userId: user.id, username: user.username },
        billable: user.role !== 'admin',
        creditCharged: user.role !== 'admin',
        creditRefunded: false,
        maxMessageLength: 162,
        selectedAccounts: user.role === 'admin' ? item.selectedAccounts : allowedAccounts
      }));
      const { valid, invalid } = validateItems(items);

      if (valid.length === 0) {
        const hint = invalid && invalid.length && invalid[0] && invalid[0].reason ? ` Motivo: ${invalid[0].reason}` : '';
        sendJson(res, 400, { error: `Nenhum SMS valido para enfileirar.${hint}`, invalid });
        return;
      }

      if (user.role !== 'admin') {
        const current = users.getById(user.id);
        const credits = current && Number.isFinite(current.creditsRemaining) ? current.creditsRemaining : 0;
        if (credits <= 0) {
          users.update(user.id, { paused: true });
          sendJson(res, 403, { error: 'Seus creditos acabaram. Fale com o administrador para recarregar.' });
          return;
        }

        if (credits < valid.length) {
          sendJson(res, 403, {
            error: `Creditos insuficientes. Disponivel: ${credits}. Necessario: ${valid.length}.`
          });
          return;
        }

        const updated = users.update(user.id, { creditsDelta: -valid.length });
        if (updated && updated.creditsRemaining <= 0) {
          users.update(user.id, { paused: true });
        }
      }

      const jobs = store.addJobs(valid);
      processQueue().catch((error) => store.appendLog({ type: 'processor_error', error: error.message }));
      sendJson(res, 202, { queued: jobs.length, invalid, jobs });
      return;
    }

    if (pathname === '/api/my/jobs' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const jobs = store.listByUserId(user.id, { limit: 80 });
      sendJson(res, 200, { jobs });
      return;
    }

    if (pathname === '/api/my/stats' && req.method === 'GET') {
      const user = requireAuth(req, res);
      if (!user) return;
      const fresh = users.getById(user.id);
      const stats = store.statsByUserId(user.id);
      sendJson(res, 200, {
        stats,
        paused: Boolean(fresh && fresh.paused),
        creditsRemaining: Number.isFinite(fresh && fresh.creditsRemaining) ? fresh.creditsRemaining : 0
      });
      return;
    }

    if (pathname === '/api/my/clear-completed' && req.method === 'POST') {
      const user = requireAuth(req, res);
      if (!user) return;
      const result = store.clearCompletedByUserId(user.id);
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/process' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      processQueue().catch((error) => store.appendLog({ type: 'processor_error', error: error.message }));
      sendJson(res, 202, { processing: true });
      return;
    }

    if (pathname === '/api/clear-completed' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const result = store.clearCompleted();
      sendJson(res, 200, result);
      return;
    }

    if (pathname === '/api/admin/storefront' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      sendJson(res, 200, { storefront: storefront.read() });
      return;
    }

    if (pathname === '/api/admin/storefront' && req.method === 'PATCH') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const updated = storefront.update(payload);
      sendJson(res, 200, { ok: true, storefront: updated });
      return;
    }

    if (pathname === '/api/admin/sms-accounts' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      sendJson(res, 200, {
        providerMode: config.providerMode,
        accounts: config.accounts.map((a) => ({ account: a.account, source: a.source || 'env', hasSmppPassword: a.hasSmppPassword })),
        stored: smsAccounts.listSafe()
      });
      return;
    }

    if (pathname === '/api/admin/sms-accounts' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const payload = await readJsonPayload(req, res);
      if (!payload) return;

      const account = String(payload.account || '').trim();
      const panelPassword = String(payload.panelPassword || '').trim();
      const smppPassword = String(payload.smppPassword || '').trim();

      if (!account) {
        sendJsonError(res, 400, 'Conta invalida.');
        return;
      }

      // Evita duplicar entre env + admin.
      if (config.accounts.some((a) => a.account === account)) {
        sendJsonError(res, 400, 'Esta conta ja existe.');
        return;
      }

      if (config.providerMode === 'smpp' && !smppPassword) {
        sendJsonError(res, 400, 'No modo SMPP, informe a senha SMPP.');
        return;
      }

      if (config.providerMode !== 'smpp' && !panelPassword) {
        sendJsonError(res, 400, 'Informe a senha do painel.');
        return;
      }

      smsAccounts.create({ account, panelPassword, smppPassword });
      reloadAccounts();
      sendJson(res, 201, { ok: true });
      return;
    }

    const adminSmsAccountMatch = pathname.match(/^\/api\/admin\/sms-accounts\/([^/]+)$/);
    if (adminSmsAccountMatch && req.method === 'DELETE') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const removed = smsAccounts.delete(adminSmsAccountMatch[1]);
      if (!removed) {
        sendJson(res, 404, { error: 'Conta nao encontrada.' });
        return;
      }
      reloadAccounts();
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/accounts' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      sendJson(res, 200, { accounts: config.accounts.map((a) => a.account) });
      return;
    }

    if (pathname === '/api/admin/route-tests' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const payload = await readJsonPayload(req, res);
      if (!payload) return;

      let prepared;
      try {
        prepared = buildAdminRouteTestItems(payload, user);
      } catch (error) {
        sendJsonError(res, 400, error.message);
        return;
      }

      const { valid, invalid } = validateItems(prepared.items);
      if (valid.length === 0) {
        sendJsonError(res, 400, 'Nenhum SMS valido para teste.', { invalid });
        return;
      }

      const jobs = store.addJobs(valid);
      processQueue().catch((error) => store.appendLog({ type: 'processor_error', error: error.message }));
      sendJson(res, 202, {
        queued: jobs.length,
        invalid,
        accountCount: prepared.selectedAccounts.length,
        phoneCount: prepared.phones.length,
        smsPerAccountPerPhone: 1
      });
      return;
    }

    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;
      sendJson(res, 200, { users: users.listSafe() });
      return;
    }

    if (pathname === '/api/admin/users' && req.method === 'POST') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const created = users.create({
        username: payload.username,
        password: payload.password,
        role: payload.role || 'user',
        allowedAccounts: []
      });
      sendJson(res, 201, { user: { id: created.id, username: created.username, role: created.role } });
      return;
    }

    const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (adminUserMatch && req.method === 'PATCH') {
      const user = requireAdmin(req, res);
      if (!user) return;
      const payload = await readJsonPayload(req, res);
      if (!payload) return;
      const patch = { ...payload };
      if (patch.allowedAccounts !== undefined) {
        const known = new Set(config.accounts.map((a) => a.account));
        patch.allowedAccounts = Array.isArray(patch.allowedAccounts)
          ? patch.allowedAccounts.map((a) => String(a).trim()).filter((a) => known.has(a))
          : [];
      }

      const updated = users.update(adminUserMatch[1], patch);
      if (!updated) {
        sendJson(res, 404, { error: 'Usuario nao encontrado.' });
        return;
      }
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === '/api/admin/user-stats' && req.method === 'GET') {
      const user = requireAdmin(req, res);
      if (!user) return;

      const jobs = store.readJobs();
      const userList = users.listSafe();
      const byUserId = new Map(userList.map((u) => [u.id, { ...u, queued: 0, sending: 0, sent: 0, failed: 0, lastAt: null }]));

      for (const job of jobs) {
        if (!job || !job.createdBy || !job.createdBy.userId) continue;
        const item = byUserId.get(job.createdBy.userId);
        if (!item) continue;
        if (job.status === 'queued') item.queued += 1;
        if (job.status === 'sending') item.sending += 1;
        if (job.status === 'sent') item.sent += 1;
        if (job.status === 'failed') item.failed += 1;
        const at = Date.parse(job.updatedAt || job.createdAt || '');
        if (Number.isFinite(at)) {
          if (!item.lastAt || at > item.lastAt) item.lastAt = at;
        }
      }

      const list = Array.from(byUserId.values())
        .sort((a, b) => {
          const activeA = (a.queued + a.sending) > 0 ? 1 : 0;
          const activeB = (b.queued + b.sending) > 0 ? 1 : 0;
          if (activeA !== activeB) return activeB - activeA;
          const lastA = a.lastAt || 0;
          const lastB = b.lastAt || 0;
          return lastB - lastA;
        })
        .map((u) => ({ ...u, lastAt: u.lastAt ? new Date(u.lastAt).toISOString() : null }));

      sendJson(res, 200, { users: list });
      return;
    }

    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SMS Rotator rodando em http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(`Modo do provedor: ${config.providerMode}`);
  console.log(`Contas configuradas: ${config.accounts.length}`);
  if (config.providerMode === 'smpp' && config.accounts.length === 0) {
    console.log('Preencha SMS_SMPP_PASSWORD_1, SMS_SMPP_PASSWORD_2... no .env para ativar as contas SMPP.');
  }
});
