const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

class SessionStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.sessionsPath = path.join(dataDir, 'sessions.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  readSessions() {
    if (!fs.existsSync(this.sessionsPath)) return {};
    try {
      const data = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8'));
      return data && typeof data === 'object' ? data : {};
    } catch {
      return {};
    }
  }

  writeSessions(sessions) {
    fs.writeFileSync(this.sessionsPath, JSON.stringify(sessions, null, 2));
  }

  create({ userId, ttlMs = DEFAULT_SESSION_TTL_MS }) {
    const sessions = this.readSessions();
    const now = Date.now();
    const id = crypto.randomUUID();
    sessions[id] = {
      id,
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString()
    };
    this.writeSessions(sessions);
    return sessions[id];
  }

  get(id) {
    if (!id) return null;
    const sessions = this.readSessions();
    const session = sessions[id];
    if (!session) return null;

    const expiresAt = Date.parse(session.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      delete sessions[id];
      this.writeSessions(sessions);
      return null;
    }

    return session;
  }

  delete(id) {
    if (!id) return;
    const sessions = this.readSessions();
    if (!sessions[id]) return;
    delete sessions[id];
    this.writeSessions(sessions);
  }
}

module.exports = { SessionStore };

