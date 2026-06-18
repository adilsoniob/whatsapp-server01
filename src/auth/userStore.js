const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./passwords');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

class UserStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.usersPath = path.join(dataDir, 'users.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  readUsers() {
    if (!fs.existsSync(this.usersPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.usersPath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  writeUsers(users) {
    fs.writeFileSync(this.usersPath, JSON.stringify(users, null, 2));
  }

  count() {
    return this.readUsers().length;
  }

  listSafe() {
    return this.readUsers().map((user) => ({
      id: user.id,
      username: user.username,
      role: user.role,
      allowedAccounts: Array.isArray(user.allowedAccounts) ? user.allowedAccounts : [],
      disabled: Boolean(user.disabled),
      paused: Boolean(user.paused),
      creditsRemaining: Number.isFinite(user.creditsRemaining) ? user.creditsRemaining : 0,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));
  }

  getById(id) {
    return this.readUsers().find((user) => user.id === id) || null;
  }

  getByUsername(username) {
    const normalized = normalizeUsername(username);
    return this.readUsers().find((user) => user.username === normalized) || null;
  }

  create({ username, password, role = 'user', allowedAccounts = [], creditsRemaining = 0 }) {
    const users = this.readUsers();
    const normalized = normalizeUsername(username);

    if (!normalized || normalized.length < 3) throw new Error('Username invalido (minimo 3 caracteres).');
    if (users.some((u) => u.username === normalized)) throw new Error('Ja existe um usuario com este username.');
    if (!password || String(password).length < 6) throw new Error('Senha invalida (minimo 6 caracteres).');
    if (!['admin', 'user'].includes(role)) throw new Error('Role invalida.');

    const now = new Date().toISOString();
    const passwordRecord = hashPassword(password);

    const user = {
      id: crypto.randomUUID(),
      username: normalized,
      role,
      allowedAccounts: Array.isArray(allowedAccounts) ? allowedAccounts : [],
      disabled: false,
      paused: role === 'admin' ? false : true,
      creditsRemaining: Number.isFinite(Number(creditsRemaining)) ? Math.max(0, Math.floor(Number(creditsRemaining))) : 0,
      password: passwordRecord,
      createdAt: now,
      updatedAt: now
    };

    this.writeUsers([...users, user]);
    return user;
  }

  update(id, patch) {
    const users = this.readUsers();
    const index = users.findIndex((user) => user.id === id);
    if (index === -1) return null;

    const current = users[index];
    const next = { ...current };

    if (patch.username !== undefined) {
      const normalized = normalizeUsername(patch.username);
      if (!normalized || normalized.length < 3) throw new Error('Username invalido (minimo 3 caracteres).');
      if (users.some((u) => u.username === normalized && u.id !== id)) {
        throw new Error('Ja existe um usuario com este username.');
      }
      next.username = normalized;
    }

    if (patch.role !== undefined) {
      if (!['admin', 'user'].includes(patch.role)) throw new Error('Role invalida.');
      next.role = patch.role;
    }

    if (patch.allowedAccounts !== undefined) {
      next.allowedAccounts = Array.isArray(patch.allowedAccounts)
        ? patch.allowedAccounts.map((a) => String(a).trim()).filter(Boolean)
        : [];
    }

    if (patch.disabled !== undefined) {
      next.disabled = Boolean(patch.disabled);
    }

    if (patch.paused !== undefined) {
      next.paused = Boolean(patch.paused);
    }

    if (patch.creditsDelta !== undefined) {
      const delta = Number(patch.creditsDelta);
      if (!Number.isFinite(delta)) throw new Error('creditsDelta invalido.');
      const current = Number.isFinite(next.creditsRemaining) ? next.creditsRemaining : 0;
      next.creditsRemaining = Math.max(0, Math.floor(current + delta));
      if (next.creditsRemaining > 0) next.paused = false;
    }

    if (patch.creditsRemaining !== undefined) {
      const value = Number(patch.creditsRemaining);
      if (!Number.isFinite(value) || value < 0) throw new Error('creditsRemaining invalido.');
      next.creditsRemaining = Math.max(0, Math.floor(value));
      if (next.creditsRemaining > 0) next.paused = false;
    }

    if (patch.password !== undefined) {
      if (!patch.password || String(patch.password).length < 6) throw new Error('Senha invalida (minimo 6 caracteres).');
      next.password = hashPassword(patch.password);
    }

    next.updatedAt = new Date().toISOString();
    users[index] = next;
    this.writeUsers(users);
    return next;
  }
}

module.exports = { UserStore };
