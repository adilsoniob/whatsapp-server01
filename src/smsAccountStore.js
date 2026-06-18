const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizeAccount(value) {
  return String(value || '').trim();
}

class SmsAccountStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.path = path.join(dataDir, 'accounts.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read() {
    if (!fs.existsSync(this.path)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  write(items) {
    fs.writeFileSync(this.path, JSON.stringify(items, null, 2));
  }

  listSafe() {
    return this.read().map((item) => ({
      id: item.id,
      account: item.account,
      hasPanelPassword: Boolean(item.panelPassword),
      hasSmppPassword: Boolean(item.smppPassword),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    }));
  }

  create({ account, panelPassword, smppPassword }) {
    const items = this.read();
    const normalized = normalizeAccount(account);
    if (!normalized) throw new Error('Conta invalida.');

    if (items.some((i) => i.account === normalized)) {
      throw new Error('Esta conta ja existe (accounts.json).');
    }

    const now = new Date().toISOString();
    const next = {
      id: crypto.randomUUID(),
      account: normalized,
      panelPassword: String(panelPassword || '').trim(),
      smppPassword: String(smppPassword || '').trim(),
      createdAt: now,
      updatedAt: now
    };

    if (!next.panelPassword && !next.smppPassword) {
      throw new Error('Informe a senha do painel e/ou a senha SMPP.');
    }

    items.push(next);
    this.write(items);
    return next;
  }

  delete(id) {
    const items = this.read();
    const remaining = items.filter((i) => i.id !== id);
    if (remaining.length === items.length) return false;
    this.write(remaining);
    return true;
  }
}

module.exports = { SmsAccountStore };

