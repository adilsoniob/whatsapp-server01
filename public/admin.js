const usersEl = document.querySelector('#users');
const form = document.querySelector('#create-user');
const usernameInput = document.querySelector('#new-username');
const passwordInput = document.querySelector('#new-password');
const result = document.querySelector('#form-result');
const logoutButton = document.querySelector('#logout');
const tabButtons = Array.from(document.querySelectorAll('[data-tab]'));
const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

const accountsEl = document.querySelector('#accounts');
const accountForm = document.querySelector('#add-account');
const accountInput = document.querySelector('#acc-account');
const panelPasswordInput = document.querySelector('#acc-panel-password');
const smppPasswordInput = document.querySelector('#acc-smpp-password');
const accountResult = document.querySelector('#account-result');
const routeTestFields = {
  accounts: document.querySelector('#route-test-accounts'),
  numbers: document.querySelector('#route-test-numbers'),
  message: document.querySelector('#route-test-message'),
  result: document.querySelector('#route-test-result'),
  submit: document.querySelector('#route-test-submit'),
  selectAll: document.querySelector('#route-test-select-all'),
  clearAll: document.querySelector('#route-test-clear-all'),
  charCount: document.querySelector('#route-test-char-count'),
  numberCount: document.querySelector('#route-test-number-count')
};

const storefrontForm = document.querySelector('#storefront-form');
const storefrontResult = document.querySelector('#storefront-result');
const storefrontFields = {
  whatsapp: document.querySelector('#sf-whatsapp'),
  p1Sends: document.querySelector('#sf-p1-sends'),
  p1Price: document.querySelector('#sf-p1-price'),
  p2Sends: document.querySelector('#sf-p2-sends'),
  p2Price: document.querySelector('#sf-p2-price'),
  p3Sends: document.querySelector('#sf-p3-sends'),
  p3Price: document.querySelector('#sf-p3-price')
};

const fields = {
  meUser: document.querySelector('#me-user'),
  meRole: document.querySelector('#me-role')
};

let knownAccounts = [];
let cachedUsers = [];
let storedAccounts = [];
let smsAccountsCache = [];
let providerMode = 'mock';
const ROUTE_TEST_SMS_PER_ACCOUNT = 1;
const ROUTE_TEST_MAX_NUMBERS = 5;

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
    .slice(0, ROUTE_TEST_MAX_NUMBERS)
    .join('\n');
}

function getRouteTestNumbers() {
  return String(routeTestFields.numbers.value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, ROUTE_TEST_MAX_NUMBERS);
}

function getSelectedRouteTestAccounts() {
  return Array.from(routeTestFields.accounts.querySelectorAll('input[type="checkbox"]:checked'))
    .map((input) => input.value)
    .filter(Boolean);
}

function updateRouteTestCounters() {
  if (!routeTestFields.charCount || !routeTestFields.numberCount) return;
  routeTestFields.charCount.textContent = String(routeTestFields.message.value.length);
  routeTestFields.numberCount.textContent = `${getRouteTestNumbers().length} numero(s)`;
}

function renderRouteTestAccounts(accounts) {
  if (!routeTestFields.accounts) return;
  smsAccountsCache = accounts.slice();

  if (!accounts.length) {
    routeTestFields.accounts.innerHTML = '<p class="empty">Nenhuma conta conectada no sistema.</p>';
    return;
  }

  routeTestFields.accounts.innerHTML = accounts.map((acc, index) => `
    <label class="account-card">
      <input type="checkbox" value="${escapeHtml(acc.account)}" />
      <span class="account-mark">${String(index + 1).padStart(2, '0')}</span>
      <div>
        <strong>${escapeHtml(acc.account)}</strong>
        <small>${escapeHtml(acc.source === 'env' ? 'Conta do .env' : 'Conta adicionada no painel')}</small>
        <small>Modo: ${escapeHtml(providerMode)}</small>
      </div>
    </label>
  `).join('');
}

function renderSmsAccounts(allAccounts, storedList) {
  storedAccounts = storedList.slice();
  smsAccountsCache = allAccounts.slice();
  if (!allAccounts.length) {
    accountsEl.innerHTML = '<p class="empty">Nenhuma conta configurada ainda.</p>';
    renderRouteTestAccounts([]);
    return;
  }

  const storedIdsByAccount = new Map(storedList.map((a) => [a.account, a.id]));

  accountsEl.innerHTML = allAccounts.map((acc) => {
    const isStored = acc.source === 'admin' && storedIdsByAccount.has(acc.account);
    const deleteButton = isStored
      ? `<button class="ghost" data-action="delete-account" data-id="${escapeHtml(storedIdsByAccount.get(acc.account))}">Remover</button>`
      : '';

    const subtitle = acc.source === 'env' ? 'Conta do .env (somente leitura)' : 'Conta adicionada no painel';

    return `
      <article class="job">
        <div>
          <strong>${escapeHtml(acc.account)}</strong>
          <p>${escapeHtml(subtitle)}</p>
          <small>Modo atual: ${escapeHtml(providerMode)}</small>
          <small>SMPP cadastrado: ${acc.hasSmppPassword ? 'sim' : 'nao'}</small>
          ${deleteButton ? `<div style="margin-top: 10px;">${deleteButton}</div>` : ''}
        </div>
        <span class="badge">${escapeHtml(acc.source || '-')}</span>
      </article>
    `;
  }).join('');

  renderRouteTestAccounts(allAccounts);
}

function renderUsers(list) {
  cachedUsers = list.slice();
  if (!list.length) {
    usersEl.innerHTML = '<p class="empty">Nenhum usuario criado ainda.</p>';
    return;
  }

  usersEl.innerHTML = list.map((user) => `
    <article class="job">
      <div>
        <strong>${escapeHtml(user.username)}</strong>
        <p>
          Role: ${escapeHtml(user.role)}
          ${user.disabled ? '(login desativado)' : ''}
          ${user.paused ? '(envio pausado)' : ''}
        </p>
        <small>Creditos: ${escapeHtml(String(user.creditsRemaining ?? 0))}</small>
        <small>Contas: ${escapeHtml((user.allowedAccounts || []).join(', ') || '-')}</small>
        <div style="display:flex; gap: 10px; flex-wrap: wrap; margin-top: 10px;">
          <button class="ghost" data-action="accounts" data-id="${escapeHtml(user.id)}">Editar contas</button>
          <button class="ghost" data-action="credits" data-id="${escapeHtml(user.id)}">Recarregar creditos</button>
          <button class="ghost" data-action="pause" data-id="${escapeHtml(user.id)}">${user.paused ? 'Ativar envio' : 'Pausar envio'}</button>
          <button class="ghost" data-action="toggle" data-id="${escapeHtml(user.id)}">
            ${user.disabled ? 'Ativar' : 'Desativar'}
          </button>
          <button class="ghost" data-action="reset" data-id="${escapeHtml(user.id)}">Resetar senha</button>
        </div>
      </div>
      <span class="badge ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span>
    </article>
  `).join('');
}

function fillStorefront(data) {
  const packages = Array.isArray(data && data.packages) ? data.packages : [];

  storefrontFields.whatsapp.value = String((data && data.whatsapp) || '');

  const p1 = packages[0] || {};
  const p2 = packages[1] || {};
  const p3 = packages[2] || {};

  storefrontFields.p1Sends.value = String(p1.sends || '');
  storefrontFields.p1Price.value = String(p1.pricePerSend || '');
  storefrontFields.p2Sends.value = String(p2.sends || '');
  storefrontFields.p2Price.value = String(p2.pricePerSend || '');
  storefrontFields.p3Sends.value = String(p3.sends || '');
  storefrontFields.p3Price.value = String(p3.pricePerSend || '');
}

function activateTab(tabName) {
  const nextTab = String(tabName || '').trim();
  tabButtons.forEach((button) => {
    const active = nextTab && button.getAttribute('data-tab') === nextTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  tabPanels.forEach((panel) => {
    const active = nextTab && panel.getAttribute('data-tab-panel') === nextTab;
    panel.classList.toggle('is-active', active);
  });

  if (nextTab === 'routes') {
    renderRouteTestAccounts(smsAccountsCache);
    updateRouteTestCounters();
  }
}

async function refresh() {
  const [me, smsAcc, accounts, users, storefront] = await Promise.all([
    api('/api/me'),
    api('/api/admin/sms-accounts'),
    api('/api/admin/accounts'),
    api('/api/admin/users'),
    api('/api/admin/storefront')
  ]);

  fields.meUser.textContent = me.username;
  fields.meRole.textContent = me.role;

  providerMode = smsAcc.providerMode || 'mock';
  renderSmsAccounts(smsAcc.accounts || [], smsAcc.stored || []);

  knownAccounts = (accounts.accounts || []).slice();
  renderUsers(users.users || []);

  fillStorefront(storefront.storefront || {});
}

usersEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.getAttribute('data-action');
  const id = target.getAttribute('data-id');
  if (!action || !id) return;

  try {
    if (action === 'accounts') {
      const user = cachedUsers.find((u) => u.id === id);
      if (!user) throw new Error('Usuario nao encontrado.');
      const options = knownAccounts.join(', ');
      const current = (user.allowedAccounts || []).join(', ');
      const raw = window.prompt(`Contas separadas por virgula.\nDisponiveis: ${options}\nAtual: ${current}`, current);
      if (raw === null) return;
      const next = raw.split(',').map((item) => item.trim()).filter(Boolean);
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowedAccounts: next })
      });
      await refresh();
      return;
    }

    if (action === 'toggle') {
      target.setAttribute('disabled', 'true');
      const user = cachedUsers.find((u) => u.id === id);
      if (!user) throw new Error('Usuario nao encontrado.');
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled: !user.disabled })
      });
      await refresh();
      return;
    }

    if (action === 'pause') {
      target.setAttribute('disabled', 'true');
      const user = cachedUsers.find((u) => u.id === id);
      if (!user) throw new Error('Usuario nao encontrado.');
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ paused: !user.paused })
      });
      await refresh();
      return;
    }

    if (action === 'credits') {
      const value = window.prompt('Quantos creditos (SMS) adicionar? Ex: 100');
      if (!value) return;
      const amount = Number(value);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Valor invalido.');
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ creditsDelta: Math.floor(amount) })
      });
      window.alert('Creditos recarregados (envio ativado).');
      await refresh();
      return;
    }

    if (action === 'reset') {
      const newPassword = window.prompt('Nova senha (min 6):');
      if (!newPassword) return;
      await api(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password: newPassword })
      });
      window.alert('Senha atualizada.');
      return;
    }
  } catch (error) {
    window.alert(error.message);
  } finally {
    target.removeAttribute('disabled');
  }
});

if (routeTestFields.accounts) {
  routeTestFields.accounts.addEventListener('change', () => {
    routeTestFields.result.textContent = '';
  });
}

if (routeTestFields.message) {
  routeTestFields.message.addEventListener('input', () => {
    const clean = sanitizeMessage(routeTestFields.message.value);
    if (clean !== routeTestFields.message.value) routeTestFields.message.value = clean;
    updateRouteTestCounters();
  });
}

if (routeTestFields.numbers) {
  routeTestFields.numbers.addEventListener('blur', () => {
    routeTestFields.numbers.value = sanitizeNumbers(routeTestFields.numbers.value);
    updateRouteTestCounters();
  });
}

if (routeTestFields.selectAll) {
  routeTestFields.selectAll.addEventListener('click', () => {
    routeTestFields.accounts.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = true;
    });
    routeTestFields.result.textContent = '';
  });
}

if (routeTestFields.clearAll) {
  routeTestFields.clearAll.addEventListener('click', () => {
    routeTestFields.accounts.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.checked = false;
    });
    routeTestFields.result.textContent = '';
  });
}

if (routeTestFields.submit) {
  routeTestFields.submit.addEventListener('click', async () => {
    const selectedAccounts = getSelectedRouteTestAccounts();
    const numbers = getRouteTestNumbers();
    const message = sanitizeMessage(routeTestFields.message.value);

    if (!selectedAccounts.length) {
      routeTestFields.result.textContent = 'Selecione pelo menos 1 conta para testar.';
      return;
    }

    if (!numbers.length) {
      routeTestFields.result.textContent = 'Informe pelo menos 1 numero para teste.';
      return;
    }

    if (numbers.length > ROUTE_TEST_MAX_NUMBERS) {
      routeTestFields.result.textContent = `Use no maximo ${ROUTE_TEST_MAX_NUMBERS} numeros.`;
      return;
    }

    if (!message) {
      routeTestFields.result.textContent = 'Digite a mensagem de teste.';
      return;
    }

    routeTestFields.submit.setAttribute('disabled', 'true');
    routeTestFields.result.textContent = 'Enviando testes...';

    try {
      const data = await api('/api/admin/route-tests', {
        method: 'POST',
        body: JSON.stringify({
          accounts: selectedAccounts,
          phones: numbers,
          message
        })
      });

      routeTestFields.result.textContent = `${data.queued} SMS de teste colocados na fila (${data.accountCount} conta(s) x ${data.phoneCount} numero(s) x ${ROUTE_TEST_SMS_PER_ACCOUNT}).`;
    } catch (error) {
      routeTestFields.result.textContent = error.message;
    } finally {
      routeTestFields.submit.removeAttribute('disabled');
    }
  });
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const selectedTab = button.getAttribute('data-tab') || '';
    const isActive = button.classList.contains('is-active');
    activateTab(isActive ? '' : selectedTab);
  });
});

accountsEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.getAttribute('data-action');
  const id = target.getAttribute('data-id');
  if (action !== 'delete-account' || !id) return;

  if (!window.confirm('Remover esta conta adicionada no painel?')) return;

  try {
    target.setAttribute('disabled', 'true');
    await api(`/api/admin/sms-accounts/${id}`, { method: 'DELETE' });
    await refresh();
  } catch (error) {
    window.alert(error.message);
  } finally {
    target.removeAttribute('disabled');
  }
});

if (storefrontForm) {
  storefrontForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    storefrontResult.textContent = 'Salvando...';

    try {
      const packages = [
        { id: '10k', sends: Number(storefrontFields.p1Sends.value), pricePerSend: Number(storefrontFields.p1Price.value) },
        { id: '20k', sends: Number(storefrontFields.p2Sends.value), pricePerSend: Number(storefrontFields.p2Price.value) },
        { id: '50k', sends: Number(storefrontFields.p3Sends.value), pricePerSend: Number(storefrontFields.p3Price.value) }
      ];

      await api('/api/admin/storefront', {
        method: 'PATCH',
        body: JSON.stringify({
          whatsapp: storefrontFields.whatsapp.value,
          packages
        })
      });

      storefrontResult.textContent = 'Configuracao salva.';
      await refresh();
    } catch (error) {
      storefrontResult.textContent = error.message;
    }
  });
}

accountForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  accountResult.textContent = 'Adicionando...';

  try {
    await api('/api/admin/sms-accounts', {
      method: 'POST',
      body: JSON.stringify({
        account: accountInput.value,
        panelPassword: panelPasswordInput.value,
        smppPassword: smppPasswordInput.value
      })
    });
    accountResult.textContent = 'Conta adicionada.';
    accountInput.value = '';
    panelPasswordInput.value = '';
    smppPasswordInput.value = '';
    await refresh();
  } catch (error) {
    accountResult.textContent = error.message;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = 'Criando...';

  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: usernameInput.value,
        password: passwordInput.value,
        role: 'user'
      })
    });
    result.textContent = 'Usuario criado.';
    usernameInput.value = '';
    passwordInput.value = '';
    await refresh();
  } catch (error) {
    result.textContent = error.message;
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

refresh().catch(() => {
  window.location.href = '/login';
});

updateRouteTestCounters();
activateTab('');
