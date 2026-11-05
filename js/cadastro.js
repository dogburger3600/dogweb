'use strict';

const form = document.getElementById('signup-form');
const phoneInput = document.getElementById('signup-phone');
let signupCaptchaToken = '';
let signupCaptchaWidgetId = null;
let signupSubmitting = false;

window.onSignupTurnstileLoad = () => {
  if (TURNSTILE_SITE_KEY.startsWith('COLE_AQUI')) {
    document.getElementById('captcha-error').textContent = 'CAPTCHA aguardando configuração da chave pública.';
    return;
  }
  signupCaptchaWidgetId = turnstile.render('#signup-captcha', {
    sitekey: TURNSTILE_SITE_KEY,
    callback: token => { signupCaptchaToken = token; document.getElementById('captcha-error').textContent = ''; },
    'expired-callback': () => { signupCaptchaToken = ''; },
    'error-callback': () => { signupCaptchaToken = ''; document.getElementById('captcha-error').textContent = 'Não foi possível carregar a verificação.'; },
  });
};

function isValidEmail(email) {
  return email.length <= 254 && !email.includes('..') && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email);
}

document.querySelectorAll('.password-toggle').forEach(button => {
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.passwordTarget);
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.classList.toggle('is-visible', show);
    button.setAttribute('aria-pressed', String(show));
    button.setAttribute('aria-label', show ? 'Ocultar senha' : 'Mostrar senha');
  });
});

function setError(field, message) {
  if (field === 'form') {
    document.getElementById('signup-error').textContent = message;
    return;
  }
  const input = document.getElementById(`signup-${field}`);
  const error = document.getElementById(`${field}-error`);
  if (input) {
    input.classList.toggle('input-error', Boolean(message));
    input.setAttribute('aria-invalid', String(Boolean(message)));
  }
  if (error) error.textContent = message;
}

function clearErrors() {
  ['name', 'phone', 'email', 'password', 'confirm', 'consent'].forEach(field => setError(field, ''));
  setError('form', '');
  document.getElementById('address-error').textContent = '';
  document.getElementById('captcha-error').textContent = '';
}

phoneInput.addEventListener('input', () => {
  phoneInput.value = window.PhoneBR.formatMobileInput(phoneInput.value);
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (signupSubmitting) return;
  clearErrors();

  const name = document.getElementById('signup-name').value.trim().replace(/\s+/g, ' ');
  const phone = window.PhoneBR.normalizeMobile(phoneInput.value);
  const email = document.getElementById('signup-email').value.trim().toLowerCase();
  const password = document.getElementById('signup-password').value;
  const confirmation = document.getElementById('signup-confirm').value;
  const consent = document.getElementById('signup-consent').checked;
  const address = {
    street: document.getElementById('signup-street').value.trim(),
    number: document.getElementById('signup-address-number').value.trim(),
    complement: document.getElementById('signup-address-complement').value.trim(),
    neighborhood: document.getElementById('signup-neighborhood').value.trim(),
  };
  let valid = true;

  if (name.length < 3 || !name.includes(' ')) {
    setError('name', 'Informe seu nome e sobrenome.');
    valid = false;
  }
  if (!phone) {
    setError('phone', 'Informe um número de telefone válido com DDD.');
    valid = false;
  }
  if (!isValidEmail(email)) {
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
  if (!signupCaptchaToken) {
    document.getElementById('captcha-error').textContent = 'Confirme que você não é um robô.';
    valid = false;
  }
  if (!address.street || !address.number || !address.neighborhood) {
    document.getElementById('address-error').textContent = 'Preencha todos os campos obrigatórios do endereço.';
    valid = false;
  }

  if (!valid) {
    document.querySelector('.input-error')?.focus();
    return;
  }

  const submitButton = document.getElementById('signup-submit');
  signupSubmitting = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Criando conta...';

  try {
    const result = await Store.signUp({ name, phone, email, password, address, captchaToken:signupCaptchaToken });
    form.reset();
    document.getElementById('signup-form-wrap').classList.add('hidden');
    document.getElementById('signup-success').classList.remove('hidden');
    const successLink = document.querySelector('.signup-success-link');
    if (!result.session) {
      document.querySelector('#signup-success p').textContent = 'Sua conta foi criada. Confirme o e-mail recebido antes de entrar.';
      successLink.href = 'entrar.html';
      successLink.textContent = 'Ir para o login';
    } else {
      successLink.href = 'index.html';
      successLink.textContent = 'Ver cardápio';
    }
  } catch (error) {
    const errorField = window.AuthFeedback.signupField(error);
    setError(errorField, window.AuthFeedback.signupMessage(error));
    signupSubmitting = false;
    submitButton.disabled = false;
    submitButton.textContent = 'Criar minha conta';
    signupCaptchaToken = '';
    if (signupCaptchaWidgetId !== null) turnstile.reset(signupCaptchaWidgetId);
  }
});
