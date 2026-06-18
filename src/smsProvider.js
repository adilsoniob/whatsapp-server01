const crypto = require('crypto');

function getPathValue(target, dottedPath) {
  if (!dottedPath) return undefined;
  return dottedPath.split('.').reduce((current, key) => {
    if (current && Object.prototype.hasOwnProperty.call(current, key)) return current[key];
    return undefined;
  }, target);
}

class SmsProvider {
  constructor({ mode, api, smpp, panel }) {
    this.mode = mode;
    this.api = api;
    this.smpp = smpp;
    this.panel = panel;
    this.panelSessions = new Map();
  }

  async send({ account, phone, message }) {
    if (this.mode === 'mock') {
      return this.mockSend({ account, phone, message });
    }

    if (this.mode === 'api') {
      return this.apiSend({ account, phone, message });
    }

    if (this.mode === 'smpp') {
      return this.smppSend({ account, phone, message });
    }

    if (this.mode === 'panel') {
      return this.panelSend({ account, phone, message });
    }

    throw new Error(`SMS_PROVIDER_MODE invalido: ${this.mode}`);
  }

  getPanelStatuses(accounts = []) {
    return accounts.map((account) => {
      const session = this.panelSessions.get(account.account);
      return {
        account: account.account,
        connected: Boolean(session && session.connected),
        lastLoginAt: session ? session.lastLoginAt : null,
        lastError: session ? session.lastError : null
      };
    });
  }

  async checkPanelAccounts(accounts = []) {
    const results = [];
    for (const account of accounts) {
      try {
        await this.ensurePanelSession(account);
        results.push({ account: account.account, connected: true, lastError: null });
      } catch (error) {
        results.push({ account: account.account, connected: false, lastError: error.message });
      }
    }
    return results;
  }

  async mockSend({ account, phone, message }) {
    await new Promise((resolve) => setTimeout(resolve, 150));

    return {
      ok: true,
      provider: 'mock',
      providerId: crypto.randomUUID(),
      account: account.account,
      phone,
      preview: message.slice(0, 60)
    };
  }

  async apiSend({ account, phone, message }) {
    if (!this.api.url) {
      throw new Error('SMS_API_URL nao foi configurado.');
    }

    const payload = {
      [this.api.accountField]: account.account,
      [this.api.passwordField]: account.password,
      [this.api.phoneField]: phone,
      [this.api.messageField]: message
    };

    const headers = { 'content-type': 'application/json' };

    if (this.api.authMode === 'basic') {
      const token = Buffer.from(`${account.account}:${account.password}`).toString('base64');
      headers.authorization = `Basic ${token}`;
      delete payload[this.api.accountField];
      delete payload[this.api.passwordField];
    }

    const response = await fetch(this.api.url, {
      method: this.api.method,
      headers,
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    const successValue = getPathValue(data, this.api.successPath);
    const providerAccepted = this.api.successPath ? Boolean(successValue) : response.ok;

    if (!response.ok || !providerAccepted) {
      throw new Error(`Falha no provedor SMS: HTTP ${response.status} - ${text.slice(0, 300)}`);
    }

    return {
      ok: true,
      provider: 'api',
      status: response.status,
      data
    };
  }

  async smppSend({ account, phone, message }) {
    if (!this.smpp.host) {
      throw new Error('SMPP_HOST nao foi configurado.');
    }

    let smpp;
    try {
      smpp = require('smpp');
    } catch {
      throw new Error('Dependencia SMPP ausente. Rode: npm install');
    }

    const url = `${this.smpp.secure ? 'ssmpp' : 'smpp'}://${this.smpp.host}:${this.smpp.port}`;

    return new Promise((resolve, reject) => {
      const session = smpp.connect({ url });
      let settled = false;
      let enquireTimer = null;

      const cleanup = () => {
        if (enquireTimer) clearInterval(enquireTimer);
        try {
          session.close();
        } catch {
          // Ignore close errors: the submit result is already known.
        }
      };

      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve(result);
      };

      const timeout = setTimeout(() => {
        finish(new Error(`Timeout SMPP apos ${this.smpp.timeoutMs}ms.`));
      }, this.smpp.timeoutMs);

      const finishOnce = (error, result) => {
        clearTimeout(timeout);
        finish(error, result);
      };

      session.on('error', (error) => {
        finishOnce(new Error(`Erro SMPP: ${error.message}`));
      });

      session.on('connect', () => {
        const bindParams = {
          system_id: account.account,
          password: account.password,
          system_type: this.smpp.systemType,
          interface_version: this.smpp.interfaceVersion
        };

        const bindCallback = (pdu) => {
          if (!pdu || pdu.command_status !== 0) {
            finishOnce(new Error(`Bind SMPP recusado. command_status=${pdu ? pdu.command_status : 'sem_pdu'}`));
            return;
          }

          enquireTimer = setInterval(() => {
            try {
              session.enquire_link();
            } catch {
              // The main send timeout/error handler will settle if the session breaks.
            }
          }, this.smpp.enquireLinkIntervalMs);

          session.submit_sm({
            source_addr: this.smpp.sourceAddr,
            source_addr_ton: this.smpp.sourceAddrTon,
            source_addr_npi: this.smpp.sourceAddrNpi,
            destination_addr: phone,
            dest_addr_ton: this.smpp.destAddrTon,
            dest_addr_npi: this.smpp.destAddrNpi,
            registered_delivery: this.smpp.registeredDelivery,
            short_message: message
          }, (submitPdu) => {
            if (!submitPdu || submitPdu.command_status !== 0) {
              finishOnce(new Error(`submit_sm recusado. command_status=${submitPdu ? submitPdu.command_status : 'sem_pdu'}`));
              return;
            }

            finishOnce(null, {
              ok: true,
              provider: 'smpp',
              messageId: submitPdu.message_id,
              account: account.account,
              phone
            });
          });
        };

        if (this.smpp.bindMode === 'transmitter') {
          session.bind_transmitter(bindParams, bindCallback);
          return;
        }

        if (this.smpp.bindMode === 'receiver') {
          finishOnce(new Error('SMPP_BIND_MODE=receiver nao envia SMS. Use transceiver ou transmitter.'));
          return;
        }

        session.bind_transceiver(bindParams, bindCallback);
      });
    });
  }

  async panelSend({ account, phone, message }) {
    const session = await this.ensurePanelSession(account);
    const token = await this.panelLoadToken(session);

    const payload = new URLSearchParams({
      token,
      smstype: '0',
      plansendtmStr: '',
      number: phone,
      senderId: this.panel.senderId || '',
      mmstitle: '',
      sms: message,
      replace_keyword: '',
      replace_arrayStr: ''
    });

    const response = await this.panelFetch(session, '/sendSms/sendSmsShortcut/save.ajax', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: payload
    });

    const data = this.parsePanelJson(response.text, 'Envio de SMS (save.ajax)', session);

    if (data.state !== 0) {
      if (this.looksLikeLoggedOut(response.text)) {
        this.panelSessions.delete(account.account);
      }
      throw new Error(`Painel recusou envio: ${data.message || JSON.stringify(data).slice(0, 250)}`);
    }

    return {
      ok: true,
      provider: 'panel',
      account: account.account,
      phone,
      data
    };
  }

  async ensurePanelSession(account) {
    const cached = this.panelSessions.get(account.account);
    if (cached && cached.connected) return cached;

    const session = {
      account: account.account,
      cookies: new Map(),
      connected: false,
      lastLoginAt: null,
      lastError: null
    };

    try {
      await this.panelFetch(session, '/login');
      const keyResponse = await this.panelFetch(session, '/loadPuk', { method: 'POST' });
      const keyData = this.parsePanelJson(keyResponse.text, 'Login do painel (loadPuk)', session);
      if (keyData.state !== 0 || !keyData.data) {
        throw new Error(`Nao foi possivel carregar chave publica do login: ${keyResponse.text.slice(0, 200)}`);
      }

      const encryptedPassword = this.encryptPanelPassword(keyData.data, account.password);
      const body = new URLSearchParams({
        username: account.account,
        pwd: encryptedPassword,
        'CSRF-TOKEN': ''
      });

      const loginResponse = await this.panelFetch(session, '/login', {
        method: 'POST',
        redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body
      });

      const location = loginResponse.response.headers.get('location');
      if (loginResponse.response.status !== 302 || !location) {
        throw new Error(`Login no painel falhou. HTTP ${loginResponse.response.status}: ${loginResponse.text.slice(0, 180)}`);
      }

      await this.panelFetch(session, location.startsWith('http') ? new URL(location).pathname : location);
      session.connected = true;
      session.lastLoginAt = new Date().toISOString();
      session.lastError = null;
      this.panelSessions.set(account.account, session);
      return session;
    } catch (error) {
      session.connected = false;
      session.lastError = error.message;
      this.panelSessions.set(account.account, session);
      throw error;
    }
  }

  async panelLoadToken(session) {
    const response = await this.panelFetch(session, '/loadSessionToken', {
      method: 'POST',
      headers: { 'x-requested-with': 'XMLHttpRequest' }
    });

    const data = this.parsePanelJson(response.text, 'Token de sessao (loadSessionToken)', session);
    if (!data.message) {
      throw new Error(`Token de sessao nao retornado pelo painel: ${response.text.slice(0, 200)}`);
    }

    return data.message;
  }

  parsePanelJson(rawText, context, session) {
    const text = String(rawText || '');
    const trimmed = text.trim();
    const accountKey = session && session.account ? String(session.account) : null;

    if (!trimmed) {
      if (accountKey) this.panelSessions.delete(accountKey);
      throw new Error(`${context}: resposta vazia do painel (possivel sessao expirada).`);
    }

    if (this.looksLikeLoggedOut(trimmed) || trimmed.startsWith('<!doctype') || trimmed.startsWith('<html')) {
      if (accountKey) this.panelSessions.delete(accountKey);
      throw new Error(`${context}: painel respondeu HTML (possivel sessao expirada/bloqueio).`);
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`${context}: resposta invalida (nao e JSON). Trecho: ${trimmed.slice(0, 220)}`);
    }
  }

  async panelFetch(session, path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.panel.timeoutMs);
    const url = path.startsWith('http') ? path : `${this.panel.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        redirect: options.redirect || 'manual',
        ...options,
        signal: controller.signal,
        headers: {
          'accept': 'text/html,application/json,*/*',
          'user-agent': 'Mozilla/5.0 SMS Rotator Panel Client',
          'cookie': this.cookieHeader(session.cookies),
          ...(options.headers || {})
        }
      });

      this.mergeCookies(session.cookies, response);
      const text = await response.text();
      return { response, text };
    } finally {
      clearTimeout(timeout);
    }
  }

  encryptPanelPassword(publicKeyBase64, password) {
    const publicKey = `-----BEGIN PUBLIC KEY-----\n${publicKeyBase64.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    return crypto.publicEncrypt({
      key: publicKey,
      padding: crypto.constants.RSA_PKCS1_PADDING
    }, Buffer.from(password, 'utf8')).toString('base64');
  }

  mergeCookies(cookieJar, response) {
    const setCookies = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const [pair] = cookie.split(';');
      const index = pair.indexOf('=');
      if (index > 0) {
        cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
      }
    }
  }

  cookieHeader(cookieJar) {
    return Array.from(cookieJar.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  looksLikeLoggedOut(text) {
    return /login_fields|System Login|\/login/i.test(text);
  }
}

module.exports = { SmsProvider };
