const fs = require('fs');
const path = require('path');

function defaultPackages() {
  return [
    { id: '10k', sends: 10_000, pricePerSend: 0.1 },
    { id: '20k', sends: 20_000, pricePerSend: 0.08 },
    { id: '50k', sends: 50_000, pricePerSend: 0.06 }
  ];
}

function normalizeWhatsapp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.slice(0, 200);
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? digits.slice(0, 20) : raw.slice(0, 200);
}

function normalizePackages(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((item, index) => {
      const sends = Number(item && item.sends);
      const pricePerSend = Number(item && item.pricePerSend);
      if (!Number.isFinite(sends) || sends <= 0) return null;
      if (!Number.isFinite(pricePerSend) || pricePerSend <= 0) return null;
      return {
        id: String((item && item.id) || fallback[index]?.id || index + 1).slice(0, 20),
        sends: Math.floor(sends),
        pricePerSend: Math.round(pricePerSend * 10000) / 10000
      };
    })
    .filter(Boolean);

  return next.length ? next : fallback;
}

class StorefrontStore {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.path = path.join(dataDir, 'storefront.json');
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read() {
    const fallback = { whatsapp: '', packages: defaultPackages(), updatedAt: null };
    if (!fs.existsSync(this.path)) return fallback;
    try {
      const raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      const whatsapp = normalizeWhatsapp(raw && raw.whatsapp);
      const packages = normalizePackages(raw && raw.packages, fallback.packages);
      const updatedAt = String((raw && raw.updatedAt) || '').trim() || null;
      return { whatsapp, packages, updatedAt };
    } catch {
      return fallback;
    }
  }

  write(value) {
    fs.writeFileSync(this.path, JSON.stringify(value, null, 2));
  }

  getPublic() {
    const current = this.read();
    return { whatsapp: current.whatsapp, packages: current.packages };
  }

  update(patch) {
    const current = this.read();
    const next = {
      whatsapp: patch && Object.prototype.hasOwnProperty.call(patch, 'whatsapp')
        ? normalizeWhatsapp(patch.whatsapp)
        : current.whatsapp,
      packages: patch && Object.prototype.hasOwnProperty.call(patch, 'packages')
        ? normalizePackages(patch.packages, current.packages)
        : current.packages,
      updatedAt: new Date().toISOString()
    };

    this.write(next);
    return next;
  }
}

module.exports = { StorefrontStore };

