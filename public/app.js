const form = document.querySelector('#sms-form');
const result = document.querySelector('#form-result');
const processButton = document.querySelector('#process-btn');
const clearCompletedButton = document.querySelector('#clear-completed-btn');
const accountList = document.querySelector('#account-list');
const selectAllButton = document.querySelector('#select-all');
const selectNoneButton = document.querySelector('#select-none');
const checkAccountsButton = document.querySelector('#check-accounts');
const messageInput = document.querySelector('#message');
const bulkInput = document.querySelector('#bulkText');
const phoneInput = document.querySelector('#phone');
const txtUpload = document.querySelector('#txtUpload');
const rotationLimitInput = document.querySelector('#rotationLimitInput');
const userStats = document.querySelector('#user-stats');

const fields = {
  queued: document.querySelector('#queued'),
  sent: document.querySelector('#sent'),
  failed: document.querySelector('#failed'),
  currentAccount: document.querySelector('#currentAccount'),
  sentInCurrentSlot: document.querySelector('#sentInCurrentSlot'),
  providerMode: document.querySelector('#providerMode'),
  recent: document.querySelector('#recent'),
  charCount: document.querySelector('#char-count'),
  recipientCount: document.querySelector('#recipient-count'),
  selectedCount: document.querySelector('#selected-count')
};

let knownAccounts = [];
let panelStatuses = [];

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
  if (!response.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

function selectedAccounts() {
  return Array.from(accountList.querySelectorAll('input[type="checkbox"]:checked')).map((input) => input.value);
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
  fields.selectedCount.textContent = selectedAccounts().length;
}

function renderAccounts(accounts) {
  const accountNames = accounts.map((item) => item.account);
  const currentSelection = new Set(selectedAccounts().length ? selectedAccounts() : accountNames);
  knownAccounts = accountNames;

  if (!accountNames.length) {
    accountList.innerHTML = '<p class="empty">Nenhuma conta configurada no .env.</p>';
    updateCounters();
    return;
  }

  accountList.innerHTML = accountNames.map((account, index) => {
    const checked = currentSelection.has(account) ? 'checked' : '';
    const status = panelStatuses.find((item) => item.account === account);
    const connected = status && status.connected;
    const statusClass = connected ? 'connected' : 'disconnected';
    const statusText = connected ? 'conectada' : 'desconectada';
    return `
      <label class="account-card">
        <input type="checkbox" value="${escapeHtml(account)}" ${checked} />
        <span class="account-mark">${index + 1}</span>
        <span>
          <strong>${escapeHtml(account)}</strong>
          <small>${index === 0 ? 'Conta principal' : 'Conta de rotacao'}</small>
          <em class="account-status ${statusClass}">${statusText}</em>
        </span>
      </label>
    `;
  }).join('');

  accountList.querySelectorAll('input').forEach((input) => input.addEventListener('change', updateCounters));
  updateCounters();
}

function renderRecent(jobs) {
  if (!jobs.length) {
    fields.recent.innerHTML = '<p class="empty">Nenhum SMS na fila ainda.</p>';
    return;
  }

  fields.recent.innerHTML = jobs.map((job) => `
    <article class="job">
      <div>
        <strong>${escapeHtml(job.phone)}</strong>
        <p>${escapeHtml(job.message)}</p>
        <small>Conta usada: ${escapeHtml(job.account || '-')}</small>
        <small>Contas do lote: ${escapeHtml((job.selectedAccounts || []).join(', ') || 'todas')}</small>
        <small>Troca: a cada ${escapeHtml(job.rotationLimit || '-')} SMS</small>
        ${job.lastError ? `<p class="error">${escapeHtml(job.lastError)}</p>` : ''}
      </div>
      <span class="badge ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
    </article>
  `).join('');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function refresh() {
  try {
    const data = await api('/api/status');
    fields.queued.textContent = data.queue.queued;
    fields.sent.textContent = data.queue.sent;
    fields.failed.textContent = data.queue.failed;
    fields.currentAccount.textContent = data.rotation.currentAccount || 'Sem conta';
    fields.sentInCurrentSlot.textContent = data.rotation.sentInCurrentSlot;
    fields.providerMode.textContent = data.providerMode;
    panelStatuses = data.panelStatuses || [];

    if (JSON.stringify(knownAccounts) !== JSON.stringify(data.accounts.map((item) => item.account))) {
      renderAccounts(data.accounts);
    } else {
      renderAccounts(data.accounts);
    }

    renderRecent(data.queue.recent);
    updateCounters();
  } catch (error) {
    fields.recent.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = 'Enfileirando...';

  const chosenAccounts = selectedAccounts();
  if (chosenAccounts.length === 0) {
    result.textContent = 'Selecione pelo menos uma conta para este envio.';
    return;
  }

  const payload = {
    phone: phoneInput.value,
    bulkText: bulkInput.value,
    message: messageInput.value,
    selectedAccounts: chosenAccounts
  };

  try {
    const data = await api('/api/send', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    result.textContent = `${data.queued} SMS adicionado(s) na fila usando ${chosenAccounts.length} conta(s).`;
    phoneInput.value = '';
    bulkInput.value = '';
    await refresh();
  } catch (error) {
    result.textContent = error.message;
  }
});

processButton.addEventListener('click', async () => {
  processButton.disabled = true;
  processButton.textContent = 'Processando...';

  try {
    await api('/api/process', { method: 'POST', body: '{}' });
    await refresh();
  } finally {
    processButton.disabled = false;
    processButton.textContent = 'Processar fila';
  }
});

clearCompletedButton.addEventListener('click', async () => {
  clearCompletedButton.disabled = true;
  clearCompletedButton.textContent = 'Limpando...';

  try {
    const data = await api('/api/clear-completed', { method: 'POST', body: '{}' });
    result.textContent = `${data.removed} mensagem(ns) enviada(s)/falha(s) removida(s) do historico.`;
    await refresh();
  } catch (error) {
    result.textContent = error.message;
  } finally {
    clearCompletedButton.disabled = false;
    clearCompletedButton.textContent = 'Limpar mensagens enviadas';
  }
});

selectAllButton.addEventListener('click', () => {
  accountList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = true;
  });
  updateCounters();
});

selectNoneButton.addEventListener('click', () => {
  accountList.querySelectorAll('input[type="checkbox"]').forEach((input) => {
    input.checked = false;
  });
  updateCounters();
});

checkAccountsButton.addEventListener('click', async () => {
  checkAccountsButton.disabled = true;
  checkAccountsButton.textContent = 'Verificando...';
  result.textContent = 'Fazendo login nas contas selecionadas/configuradas...';

  try {
    const data = await api('/api/accounts/check', { method: 'POST', body: '{}' });
    panelStatuses = data.statuses || [];
    const connected = panelStatuses.filter((item) => item.connected).length;
    result.textContent = `${connected}/${panelStatuses.length} conta(s) conectada(s).`;
    await refresh();
  } catch (error) {
    result.textContent = error.message;
  } finally {
    checkAccountsButton.disabled = false;
    checkAccountsButton.textContent = 'Verificar conexoes';
  }
});

[messageInput, bulkInput, phoneInput].forEach((input) => input.addEventListener('input', updateCounters));

messageInput.addEventListener('input', () => {
  const clean = sanitizeMessage(messageInput.value);
  if (messageInput.value !== clean) {
    messageInput.value = clean;
  }
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

refresh();
setInterval(refresh, 2000);

async function refreshUserStats() {
  if (!userStats) return;
  try {
    const data = await api('/api/admin/user-stats');
    const list = data.users || [];
    if (!list.length) {
      userStats.innerHTML = '<p class="empty">Nenhum usuario.</p>';
      return;
    }

    userStats.innerHTML = list.map((u) => {
      const active = (u.queued + u.sending) > 0;
      const badge = active ? 'queued' : 'sent';
      const paused = u.paused ? ' (pausado)' : '';
      return `
        <article class="job">
          <div>
            <strong>${escapeHtml(u.username)}${paused}</strong>
            <small>Creditos: ${escapeHtml(String(u.creditsRemaining ?? 0))}</small>
            <small>Fila: ${escapeHtml(String(u.queued))} | Enviando: ${escapeHtml(String(u.sending))} | OK: ${escapeHtml(String(u.sent))} | Falha: ${escapeHtml(String(u.failed))}</small>
          </div>
          <span class="badge ${badge}">${active ? 'ativo' : 'ok'}</span>
        </article>
      `;
    }).join('');
  } catch (error) {
    userStats.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

refreshUserStats();
setInterval(refreshUserStats, 2500);
