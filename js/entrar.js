'use strict';

const loginForm = document.getElementById('login-form');
let loginCaptchaToken = '';
let loginCaptchaWidgetId = null;

window.onLoginTurnstileLoad = () => {
  if (TURNSTILE_SITE_KEY.startsWith('COLE_AQUI')) {
    document.getElementById('login-error').textContent = 'CAPTCHA aguardando configuração da chave pública.';
    return;
  }
  loginCaptchaWidgetId = turnstile.render('#login-captcha', {
    sitekey: TURNSTILE_SITE_KEY,
    callback: token => { loginCaptchaToken = token; document.getElementById('login-error').textContent = ''; },
    'expired-callback': () => { loginCaptchaToken = ''; },
    'error-callback': () => { loginCaptchaToken = ''; document.getElementById('login-error').textContent = 'Não foi possível carregar a verificação.'; },
  });
};

async function redirectAuthenticatedUser() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) return false;
  const { data: profile } = await DB.from('profiles').select('role').eq('id', user.id).maybeSingle();
  window.location.replace(profile?.role === 'manager' ? 'gestor.html' : 'index.html');
  return true;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('login-submit');
  const errorElement = document.getElementById('login-error');
  button.disabled = true;
  button.textContent = 'Entrando...';
  errorElement.textContent = '';

  if (!loginCaptchaToken) {
    errorElement.textContent = 'Confirme que você não é um robô.';
    button.disabled = false;
    button.textContent = 'Entrar';
    return;
  }

  const { error } = await DB.auth.signInWithPassword({
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
    options: { captchaToken:loginCaptchaToken },
  });

  if (error) {
    errorElement.textContent = 'E-mail ou senha inválidos.';
    button.disabled = false;
    button.textContent = 'Entrar';
    loginCaptchaToken = '';
    if (loginCaptchaWidgetId !== null) turnstile.reset(loginCaptchaWidgetId);
    return;
  }

  await redirectAuthenticatedUser();
});

redirectAuthenticatedUser();
