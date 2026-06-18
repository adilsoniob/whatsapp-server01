function parseCookies(headerValue) {
  const cookies = {};
  const raw = String(headerValue || '');
  if (!raw) return cookies;

  raw.split(';').forEach((part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join('=') || '');
  });

  return cookies;
}

function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure) parts.push('Secure');

  const current = res.getHeader('Set-Cookie');
  const next = Array.isArray(current) ? [...current, parts.join('; ')] : current ? [current, parts.join('; ')] : [parts.join('; ')];
  res.setHeader('Set-Cookie', next);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

module.exports = { parseCookies, setCookie, clearCookie };

