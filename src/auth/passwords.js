const crypto = require('crypto');

const PBKDF2_ITERATIONS = 120_000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = 'sha256';

function hashPassword(password, saltBase64) {
  const salt = saltBase64 ? Buffer.from(saltBase64, 'base64') : crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return {
    salt: salt.toString('base64'),
    hash: derived.toString('base64'),
    algorithm: `pbkdf2-${PBKDF2_DIGEST}`,
    iterations: PBKDF2_ITERATIONS
  };
}

function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const derived = crypto.pbkdf2Sync(
    String(password),
    Buffer.from(record.salt, 'base64'),
    Number(record.iterations || PBKDF2_ITERATIONS),
    Buffer.from(record.hash, 'base64').length,
    PBKDF2_DIGEST
  );
  const expected = Buffer.from(record.hash, 'base64');
  return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
}

module.exports = { hashPassword, verifyPassword };

