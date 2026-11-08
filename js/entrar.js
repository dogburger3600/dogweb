'use strict';

const loginForm = document.getElementById('login-form');
let loginCaptchaToken = '';
let loginCaptchaWidgetId = null;

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
  const { data: { user }, error:userError } = await DB.auth.getUser();
  if (userError) throw userError;
  if (!user) return false;
  const { data:profile, error:profileError } = await DB.from('profiles').select('role').eq('id', user.id).maybeSingle();
  if (profileError) {
    const loadError = new Error(profileError.message || 'Não foi possível carregar o perfil.');
    loadError.code = 'profile_load_failed';
    loadError.cause = profileError;
    throw loadError;
  }
  if (!profile) {
    await DB.auth.signOut();
    const missingProfileError = new Error('Perfil não encontrado.');
    missingProfileError.code = 'profile_not_found';
    throw missingProfileError;
  }
  const params = new URLSearchParams(window.location.search);
  const customerDestination = params.get('returnTo') === 'index.html'
    ? `index.html${params.get('checkout') === '1' ? '?checkout=1' : ''}`
    : 'index.html';
  let canViewDashboard = false;
  if (['owner', 'manager', 'attendant'].includes(profile?.role)) {
    const capabilityResult = await DB.rpc('has_capability', { p_capability:'view_dashboard' });
    canViewDashboard = !capabilityResult.error && capabilityResult.data === true;
  }
  window.location.replace(canViewDashboard ? 'gestor.html' : customerDestination);
  return true;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('login-submit');
  const errorElement = document.getElementById('login-error');
  button.disabled = true;
  button.textContent = 'Entrando...';
  errorElement.textContent = '';

  const email = document.getElementById('login-email').value.trim().toLowerCase();
  if (email.length > 254 || email.includes('..') || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
    errorElement.textContent = 'Informe um e-mail válido.';
    button.disabled = false;
    button.textContent = 'Entrar';
    return;
  }

  if (!loginCaptchaToken) {
    errorElement.textContent = 'Confirme que você não é um robô.';
    button.disabled = false;
    button.textContent = 'Entrar';
    return;
  }

  try {
    const { error } = await DB.auth.signInWithPassword({
      email,
      password: document.getElementById('login-password').value,
      options: { captchaToken:loginCaptchaToken },
    });
    if (error) throw error;
    const redirected = await redirectAuthenticatedUser();
    if (!redirected) {
      const sessionError = new Error('A sessão não foi disponibilizada após o login.');
      sessionError.code = 'session_missing';
      throw sessionError;
    }
  } catch (error) {
    errorElement.textContent = window.AuthFeedback.loginMessage(error);
    button.disabled = false;
    button.textContent = 'Entrar';
    loginCaptchaToken = '';
    if (loginCaptchaWidgetId !== null) turnstile.reset(loginCaptchaWidgetId);
  }
});

async function initializeLogin() {
  try {
    await redirectAuthenticatedUser();
  } catch (error) {
    document.getElementById('login-error').textContent = window.AuthFeedback.loginMessage(error);
  }
}

initializeLogin();
