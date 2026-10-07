'use strict';

const form = document.getElementById('signup-form');
const phoneInput = document.getElementById('signup-phone');

function onlyDigits(value) {
  return value.replace(/\D/g, '');
}

function formatPhone(value) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 2) return digits.replace(/^(\d{0,2})/, '($1');
  if (digits.length <= 6) return digits.replace(/^(\d{2})(\d+)/, '($1) $2');
  if (digits.length <= 10) return digits.replace(/^(\d{2})(\d{4})(\d+)/, '($1) $2-$3');
  return digits.replace(/^(\d{2})(\d{5})(\d+)/, '($1) $2-$3');
}

function setError(field, message) {
  const input = document.getElementById(`signup-${field}`);
  const error = document.getElementById(`${field}-error`);
  if (input) input.classList.toggle('input-error', Boolean(message));
  if (error) error.textContent = message;
}

function clearErrors() {
  ['name', 'phone', 'email', 'password', 'confirm', 'consent'].forEach(field => setError(field, ''));
}

phoneInput.addEventListener('input', () => {
  phoneInput.value = formatPhone(phoneInput.value);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  clearErrors();

  const name = document.getElementById('signup-name').value.trim().replace(/\s+/g, ' ');
  const phone = onlyDigits(phoneInput.value);
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const confirmation = document.getElementById('signup-confirm').value;
  const consent = document.getElementById('signup-consent').checked;
  let valid = true;

  if (name.length < 3 || !name.includes(' ')) {
    setError('name', 'Informe seu nome e sobrenome.');
    valid = false;
  }
  if (phone.length < 10 || phone.length > 11) {
    setError('phone', 'Informe um celular válido com DDD.');
    valid = false;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setError('email', 'Informe um e-mail válido.');
    valid = false;
  }
  if (password.length < 6) {
    setError('password', 'A senha deve ter pelo menos 6 caracteres.');
    valid = false;
  }
  if (confirmation !== password) {
    setError('confirm', 'As senhas não coincidem.');
    valid = false;
  }
  if (!consent) {
    setError('consent', 'Você precisa concordar para continuar.');
    valid = false;
  }

  if (!valid) {
    document.querySelector('.input-error')?.focus();
    return;
  }

  const submitButton = document.getElementById('signup-submit');
  submitButton.disabled = true;
  submitButton.textContent = 'Criando conta...';

  try {
    const result = await Store.signUp({ name, phone, email, password });
    form.reset();
    document.getElementById('signup-form-wrap').classList.add('hidden');
    document.getElementById('signup-success').classList.remove('hidden');
    if (!result.session) {
      document.querySelector('#signup-success p').textContent = 'Sua conta foi criada. Confirme o e-mail recebido antes de entrar.';
    }
  } catch {
    setError('email', 'Não foi possível concluir. O e-mail ou celular pode já estar cadastrado.');
    submitButton.disabled = false;
    submitButton.textContent = 'Criar minha conta';
  }
});
