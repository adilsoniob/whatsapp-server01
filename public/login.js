const form = document.querySelector('#login-form');
const username = document.querySelector('#username');
const password = document.querySelector('#password');
const result = document.querySelector('#form-result');
const setupLink = document.querySelector('#setupLink');

const storefront = {
  whatsappLink: document.querySelector('#storefront-whatsapp'),
  whatsappEmpty: document.querySelector('#storefront-whatsapp-empty'),
  packages: document.querySelector('#storefront-packages')
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let data = {};
  try {
    data = text && text.trim() ? JSON.parse(text) : {};
  } catch {
    const trimmed = String(text || '').trim();
    if (trimmed.startsWith('<!doctype') || trimmed.startsWith('<html') || (response.headers.get('content-type') || '').includes('text/html')) {
      throw new Error('Resposta HTML recebida. Se voce foi redirecionado, recarregue a pagina.');
    }
    throw new Error('Resposta invalida do servidor (nao e JSON).');
  }

  if (!response.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

function formatSends(value) {
  const sends = Number(value);
  return Number.isFinite(sends) ? sends.toLocaleString('pt-BR') : String(value || '');
}

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return String(value || '');
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(amount);
}

function normalizeWhatsapp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const digits = raw.replace(/[^\d]/g, '');
  return digits ? digits : raw;
}

function makeWhatsAppLink(rawWhatsapp, text) {
  const whatsapp = normalizeWhatsapp(rawWhatsapp);
  if (!whatsapp) return '';

  const encoded = text ? encodeURIComponent(String(text)) : '';

  if (/^https?:\/\//i.test(whatsapp)) {
    if (!encoded) return whatsapp;
    return whatsapp.includes('?') ? `${whatsapp}&text=${encoded}` : `${whatsapp}?text=${encoded}`;
  }

  return encoded
    ? `https://wa.me/${whatsapp}?text=${encoded}`
    : `https://wa.me/${whatsapp}`;
}

function renderStorefront(data) {
  const whatsapp = data && data.whatsapp;
  const packages = Array.isArray(data && data.packages) ? data.packages : [];

  const directLink = makeWhatsAppLink(whatsapp, '');
  if (directLink) {
    storefront.whatsappLink.href = directLink;
    storefront.whatsappLink.style.display = 'inline-flex';
    storefront.whatsappEmpty.style.display = 'none';
  } else {
    storefront.whatsappLink.style.display = 'none';
    storefront.whatsappEmpty.style.display = 'block';
  }

  if (!packages.length) {
    storefront.packages.innerHTML = '<p class="empty">Nenhum pacote configurado ainda.</p>';
    return;
  }

  storefront.packages.innerHTML = packages.map((pkg) => {
    const sends = Number(pkg && pkg.sends);
    const pricePerSend = Number(pkg && pkg.pricePerSend);
    const title = `Pacote com ${formatSends(sends)} envios`;
    const subtitle = `Sai a ${formatMoney(pricePerSend)} por envio`;
    const buyText = `Quero comprar o pacote de ${formatSends(sends)} envios (${formatMoney(pricePerSend)} por envio).`;
    const buyLink = makeWhatsAppLink(whatsapp, buyText);

    return `
      <article class="job">
        <div>
          <strong>${title}</strong>
          <p>${subtitle}</p>
          ${buyLink ? `<a class="button-link buy" href="${buyLink}" target="_blank" rel="noopener">Comprar pacote</a>` : ''}
        </div>
        <span class="badge">pacote</span>
      </article>
    `;
  }).join('');
}

async function refreshSetup() {
  try {
    const data = await api('/api/setup/status');
    setupLink.style.display = data.needsSetup ? 'inline' : 'none';
  } catch {
    setupLink.style.display = 'none';
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = 'Entrando...';

  try {
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value })
    });

    window.location.href = data.role === 'admin' ? '/admin' : '/app';
  } catch (error) {
    result.textContent = error.message;
  }
});

refreshSetup();

api('/api/public/storefront')
  .then(renderStorefront)
  .catch(() => {
    // Se der erro, apenas nao exibe.
  });
