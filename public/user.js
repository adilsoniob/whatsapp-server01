const form = document.querySelector('#sms-form');
const result = document.querySelector('#form-result');
const messageInput = document.querySelector('#message');
const bulkInput = document.querySelector('#bulkText');
const phoneInput = document.querySelector('#phone');
const txtUpload = document.querySelector('#txtUpload');
const messageVariables = document.querySelector('#message-variables');
const logoutButton = document.querySelector('#logout');
const clearHistoryButton = document.querySelector('#clear-history');
const refreshButton = document.querySelector('#refresh-btn');
const submitButton = form.querySelector('button[type="submit"]');
const messageLimitWarning = document.querySelector('#message-limit-warning');
const creditWarning = document.querySelector('#credit-warning');

const MESSAGE_LIMIT_USER = 162;
const MESSAGE_LIMIT_ADMIN = 162;
const LOW_CREDIT_THRESHOLD = 10;

const fields = {
  charCount: document.querySelector('#char-count'),
  recipientCount: document.querySelector('#recipient-count'),
  meUser: document.querySelector('#me-user'),
  meRole: document.querySelector('#me-role'),
  meCredits: document.querySelector('#me-credits'),
  meSent: document.querySelector('#me-sent'),
  creditsRemaining: document.querySelector('#creditsRemaining'),
  sentCount: document.querySelector('#sentCount'),
  recent: document.querySelector('#recent')
};

const storefront = {
  whatsappLink: document.querySelector('#support-whatsapp'),
  whatsappEmpty: document.querySelector('#support-whatsapp-empty'),
  packages: document.querySelector('#support-packages')
};

let me = null;
let latestCreditsRemaining = null;
let latestPaused = null;
let emptyCreditPopupShown = false;

function setAlert(el, text) {
  if (!el) return;
  const message = String(text || '').trim();
  if (!message) {
    el.textContent = '';
    el.style.display = 'none';
    return;
  }
  el.textContent = message;
  el.style.display = 'block';
}

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
      throw new Error('Sessao expirada ou rota incorreta: o servidor respondeu HTML. Recarregue a pagina e faca login novamente.');
    }
    throw new Error('Resposta invalida do servidor (nao e JSON).');
  }

  if (!response.ok) {
    const error = new Error(data.error || 'Erro inesperado.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sanitizeMessage(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
    .slice(0, 162);
}

function sanitizeNumbers(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/[^\d+]/g, '').trim())
    .filter(Boolean)
    .join('\n');
}

function updateCounters() {
  const bulkCount = bulkInput.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length;
  const quickCount = phoneInput.value.trim() ? 1 : 0;
  fields.recipientCount.textContent = `${bulkCount + quickCount} destinatario(s)`;
  fields.charCount.textContent = messageInput.value.length;
  updateSendState();
}

function updateSendState() {
  const messageLimit = me && me.role === 'admin' ? MESSAGE_LIMIT_ADMIN : MESSAGE_LIMIT_USER;
  const length = messageInput.value.length;
  const overLimit = length > messageLimit;
  if (overLimit) {
    setAlert(messageLimitWarning, `Voce ultrapassou o limite de ${messageLimit} caracteres (atual: ${length}). Ajuste a mensagem para enviar.`);
  } else {
    setAlert(messageLimitWarning, '');
  }

  const credits = Number(latestCreditsRemaining);
  const paused = Boolean(latestPaused);
  const creditBlocked = Boolean(me && me.role !== 'admin' && (paused || (Number.isFinite(credits) && credits <= 0)));

  if (overLimit || creditBlocked) {
    submitButton.setAttribute('disabled', 'true');
    return;
  }

  submitButton.removeAttribute('disabled');
}

function appendTokenToMessage(token) {
  const cleanedToken = String(token || '').trim();
  if (!cleanedToken) return;

  const current = String(messageInput.value || '');
  const separator = current.trim() ? ' ' : '';
  const next = sanitizeMessage(`${current}${separator}${cleanedToken}`);
  messageInput.value = next;
  messageInput.focus();
  messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
  updateCounters();
}

function renderStorefront(data) {
  if (!storefront.whatsappLink || !storefront.packages) return;

  const whatsapp = data && data.whatsapp;
  const packages = Array.isArray(data && data.packages) ? data.packages : [];

  const directLink = makeWhatsAppLink(whatsapp, '');
  if (directLink) {
    storefront.whatsappLink.href = directLink;
    storefront.whatsappLink.style.display = 'inline-flex';
    if (storefront.whatsappEmpty) storefront.whatsappEmpty.style.display = 'none';
  } else {
    storefront.whatsappLink.style.display = 'none';
    if (storefront.whatsappEmpty) storefront.whatsappEmpty.style.display = 'block';
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
          <strong>${escapeHtml(title)}</strong>
          <p>${escapeHtml(subtitle)}</p>
          ${buyLink ? `<a class="button-link buy" href="${buyLink}" target="_blank" rel="noopener">Comprar pacote</a>` : ''}
        </div>
        <span class="badge">pacote</span>
      </article>
    `;
  }).join('');
}

async function loadMe() {
  try {
    me = await api('/api/me');
    fields.meUser.textContent = me.username;
    fields.meRole.textContent = me.role;
  } catch {
    window.location.href = '/login';
  }
}

async function refreshStats() {
  try {
    const data = await api('/api/my/stats');
    const credits = Number(data.creditsRemaining ?? 0);
    const sent = Number((data.stats && data.stats.sent) ?? 0);

    fields.meCredits.textContent = String(credits);
    fields.creditsRemaining.textContent = String(credits);

    fields.meSent.textContent = String(sent);
    fields.sentCount.textContent = String(sent);

    const paused = Boolean(data.paused);

    latestCreditsRemaining = credits;
    latestPaused = paused;

    if (me && me.role !== 'admin') {
      if (credits > 0) emptyCreditPopupShown = false;

      if (credits <= 0) {
        setAlert(creditWarning, 'Sem credito para envio. Fale com o administrador para recarregar.');
        if (!emptyCreditPopupShown) {
          emptyCreditPopupShown = true;
          window.alert('Voce esta sem credito para envio de SMS. O envio foi bloqueado ate recarga.');
        }
      } else if (credits < LOW_CREDIT_THRESHOLD) {
        setAlert(creditWarning, `Seus creditos estao acabando. Restam ${credits}.`);
      } else {
        setAlert(creditWarning, '');
      }

      if (paused || credits <= 0) {
        if (!result.textContent) {
          result.textContent = 'Envio pausado/sem creditos. Aguarde recarga do admin.';
        }
      }
    }

    updateSendState();
  } catch (error) {
    result.textContent = error.message;
  }
}

async function refreshAll() {
  await loadMe();
  await Promise.all([refreshStats(), refreshHistory()]);
}

function renderRecent(jobs) {
  if (!jobs.length) {
    fields.recent.innerHTML = '<p class="empty">Nenhum envio ainda.</p>';
    return;
  }

  fields.recent.innerHTML = jobs.map((job) => `
    <article class="job">
      <div>
        <strong>${escapeHtml(job.phone)}</strong>
        <p>${escapeHtml(job.message)}</p>
        <small>Status: ${escapeHtml(job.status)}</small>
        <small>Conta/rota: ${escapeHtml(job.account || '-')}</small>
        ${job.lastError ? `<p class="error">${escapeHtml(job.lastError)}</p>` : ''}
      </div>
      <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
    </article>
  `).join('');
}

async function refreshHistory() {
  try {
    if (!me) return;
    const data = await api('/api/my/jobs');
    renderRecent(data.jobs || []);
  } catch (error) {
    fields.recent.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const hasQuick = Boolean(phoneInput.value.trim());
  const bulkCount = bulkInput.value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).length;
  if (!hasQuick && bulkCount === 0) {
    result.textContent = 'Informe pelo menos 1 numero (campo rapido ou lista).';
    return;
  }

  const messageLimit = me && me.role === 'admin' ? MESSAGE_LIMIT_ADMIN : MESSAGE_LIMIT_USER;
  const length = messageInput.value.length;
  if (length > messageLimit) {
    setAlert(messageLimitWarning, `Voce ultrapassou o limite de ${messageLimit} caracteres (atual: ${length}). Ajuste a mensagem para enviar.`);
    result.textContent = `Envio bloqueado: mensagem acima de ${messageLimit} caracteres.`;
    updateSendState();
    return;
  }

  const credits = Number(latestCreditsRemaining);
  const paused = Boolean(latestPaused);
  if (me && me.role !== 'admin' && (paused || (Number.isFinite(credits) && credits <= 0))) {
    setAlert(creditWarning, 'Sem credito para envio. Fale com o administrador para recarregar.');
    if (!emptyCreditPopupShown && Number.isFinite(credits) && credits <= 0) {
      emptyCreditPopupShown = true;
      window.alert('Voce esta sem credito para envio de SMS. O envio foi bloqueado ate recarga.');
    }
    result.textContent = 'Envio bloqueado: sem credito/pausado.';
    updateSendState();
    return;
  }

  result.textContent = 'Enviando...';

  const payload = {
    phone: phoneInput.value,
    bulkText: bulkInput.value,
    message: messageInput.value
  };

  try {
    const data = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    result.textContent = `${data.queued} SMS enviado(s) para fila.`;
    phoneInput.value = '';
    bulkInput.value = '';
    messageInput.value = '';
    updateCounters();
    await refreshAll();
  } catch (error) {
    const details = error && error.data && Array.isArray(error.data.invalid) ? error.data.invalid : [];
    if (details.length && details[0] && details[0].reason) {
      result.textContent = `${error.message} (${details[0].reason})`;
    } else {
      result.textContent = error.message;
    }
    await refreshAll();
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await api('/api/auth/logout', { method: 'POST', body: '{}' });
  } finally {
    window.location.href = '/login';
  }
});

clearHistoryButton.addEventListener('click', async () => {
  clearHistoryButton.disabled = true;
  clearHistoryButton.textContent = 'Limpando...';
  try {
    const data = await api('/api/my/clear-completed', { method: 'POST', body: '{}' });
    result.textContent = `${data.removed} registro(s) removido(s) do historico.`;
    await refreshHistory();
  } catch (error) {
    result.textContent = error.message;
  } finally {
    clearHistoryButton.disabled = false;
    clearHistoryButton.textContent = 'Limpar historico';
  }
});

refreshButton.addEventListener('click', async () => {
  refreshButton.disabled = true;
  refreshButton.textContent = 'Atualizando...';
  try {
    await refreshAll();
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Atualizar';
  }
});

if (messageVariables) {
  messageVariables.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('button[data-token]');
    if (!button) return;
    appendTokenToMessage(button.getAttribute('data-token'));
  });
}

messageInput.addEventListener('input', () => {
  const clean = sanitizeMessage(messageInput.value);
  if (messageInput.value !== clean) messageInput.value = clean;
  updateCounters();
});

bulkInput.addEventListener('blur', () => {
  bulkInput.value = sanitizeNumbers(bulkInput.value);
  updateCounters();
});

phoneInput.addEventListener('blur', () => {
  phoneInput.value = sanitizeNumbers(phoneInput.value);
  updateCounters();
});

txtUpload.addEventListener('change', async () => {
  const file = txtUpload.files && txtUpload.files[0];
  if (!file) return;
  const text = await file.text();
  const cleaned = sanitizeNumbers(text);
  bulkInput.value = bulkInput.value.trim()
    ? `${bulkInput.value.trim()}\n${cleaned}`.trim()
    : cleaned;
  txtUpload.value = '';
  updateCounters();
});

updateCounters();
refreshAll();
api('/api/public/storefront').then(renderStorefront).catch(() => {});
setInterval(() => {
  refreshStats();
  refreshHistory();
}, 2500);
