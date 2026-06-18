const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

function loadDotEnv(filePath = ENV_PATH) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (!Object.prototype.hasOwnProperty.call(process.env, key)) {
      process.env[key] = value;
    }
  }
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readAccounts(providerMode) {
  const accounts = [];

  for (let index = 1; index <= 100; index += 1) {
    const account = process.env[`SMS_ACCOUNT_${index}`];
    const panelPassword = process.env[`SMS_PASSWORD_${index}`] || '';
    const smppPassword = process.env[`SMS_SMPP_PASSWORD_${index}`] || '';
    const password = providerMode === 'smpp' ? smppPassword : panelPassword;

    if (account && password) {
      accounts.push({
        id: String(index),
        account: String(account).trim(),
        password,
        hasSmppPassword: Boolean(smppPassword),
        source: 'env'
      });
    }
  }

  return accounts;
}

function readAccountsFromFile(providerMode, dataDir) {
  const filePath = path.join(dataDir, 'accounts.json');
  if (!fs.existsSync(filePath)) return [];

  let raw = [];
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    raw = [];
  }

  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      const account = String(item.account || '').trim();
      const panelPassword = String(item.panelPassword || '').trim();
      const smppPassword = String(item.smppPassword || '').trim();
      const password = providerMode === 'smpp' ? smppPassword : panelPassword;
      if (!account || !password) return null;
      return {
        id: String(item.id || account),
        account,
        password,
        hasSmppPassword: Boolean(smppPassword),
        source: 'admin'
      };
    })
    .filter(Boolean);
}

function getConfig() {
  loadDotEnv();
  const providerMode = process.env.SMS_PROVIDER_MODE || 'mock';
  const dataDir = path.join(ROOT_DIR, 'data');

  const envAccounts = readAccounts(providerMode);
  const fileAccounts = readAccountsFromFile(providerMode, dataDir);
  const mergedByAccount = new Map();
  for (const item of envAccounts) mergedByAccount.set(item.account, item);
  for (const item of fileAccounts) mergedByAccount.set(item.account, item);

  return {
    rootDir: ROOT_DIR,
    port: numberEnv('PORT', 3000),
    host: String(process.env.HOST || '127.0.0.1').trim() || '127.0.0.1',
    rotationLimit: numberEnv('SMS_ROTATION_LIMIT', 10),
    providerMode,
    dataDir,
    accounts: Array.from(mergedByAccount.values()),
    webhook: {
      apiKey: String(process.env.WEBHOOK_API_KEY || '').trim(),
      defaultAccounts: String(process.env.WEBHOOK_DEFAULT_ACCOUNTS || '')
        .split(',')
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    },
    api: {
      url: process.env.SMS_API_URL || '',
      method: process.env.SMS_API_METHOD || 'POST',
      authMode: process.env.SMS_API_AUTH_MODE || 'body',
      accountField: process.env.SMS_API_ACCOUNT_FIELD || 'account',
      passwordField: process.env.SMS_API_PASSWORD_FIELD || 'password',
      phoneField: process.env.SMS_API_PHONE_FIELD || 'phone',
      messageField: process.env.SMS_API_MESSAGE_FIELD || 'message',
      successPath: process.env.SMS_API_SUCCESS_PATH || ''
    },
    panel: {
      baseUrl: process.env.PANEL_BASE_URL || 'https://msg.topying.net',
      senderId: process.env.PANEL_SENDER_ID || '',
      timeoutMs: numberEnv('PANEL_TIMEOUT_MS', 20000)
    },
    smpp: {
      host: process.env.SMPP_HOST || '',
      port: numberEnv('SMPP_PORT', 2775),
      secure: process.env.SMPP_SECURE === 'true',
      bindMode: process.env.SMPP_BIND_MODE || 'transceiver',
      systemType: process.env.SMPP_SYSTEM_TYPE || '',
      interfaceVersion: Number(process.env.SMPP_INTERFACE_VERSION || '52'),
      sourceAddr: process.env.SMPP_SOURCE_ADDR || '',
      sourceAddrTon: Number(process.env.SMPP_SOURCE_ADDR_TON || '0'),
      sourceAddrNpi: Number(process.env.SMPP_SOURCE_ADDR_NPI || '0'),
      destAddrTon: Number(process.env.SMPP_DEST_ADDR_TON || '1'),
      destAddrNpi: Number(process.env.SMPP_DEST_ADDR_NPI || '1'),
      registeredDelivery: Number(process.env.SMPP_REGISTERED_DELIVERY || '1'),
      enquireLinkIntervalMs: numberEnv('SMPP_ENQUIRE_LINK_INTERVAL_MS', 30000),
      timeoutMs: numberEnv('SMPP_TIMEOUT_MS', 15000)
    }
  };
}

module.exports = { getConfig };
