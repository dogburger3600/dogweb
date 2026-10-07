'use strict';

const loginForm = document.getElementById('login-form');

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

  const { error } = await DB.auth.signInWithPassword({
    email: document.getElementById('login-email').value.trim(),
    password: document.getElementById('login-password').value,
  });

  if (error) {
    errorElement.textContent = 'E-mail ou senha inválidos.';
    button.disabled = false;
    button.textContent = 'Entrar';
    return;
  }

  await redirectAuthenticatedUser();
});

redirectAuthenticatedUser();
