const form = document.querySelector('#setup-form');
const username = document.querySelector('#username');
const password = document.querySelector('#password');
const result = document.querySelector('#form-result');

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
      throw new Error('Sessao expirada ou rota incorreta: o servidor respondeu HTML. Recarregue a pagina e tente novamente.');
    }
    throw new Error('Resposta invalida do servidor (nao e JSON).');
  }
  if (!response.ok) throw new Error(data.error || 'Erro inesperado.');
  return data;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  result.textContent = 'Criando admin...';

  try {
    await api('/api/setup', {
      method: 'POST',
      body: JSON.stringify({ username: username.value, password: password.value })
    });
    window.location.href = '/admin';
  } catch (error) {
    result.textContent = error.message;
  }
});
