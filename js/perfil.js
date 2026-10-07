'use strict';

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return phone || 'Não informado';
}

async function loadProfile() {
  const { data: { user }, error: userError } = await DB.auth.getUser();
  if (userError || !user) {
    window.location.replace('entrar.html');
    return;
  }

  let { data: profile, error } = await DB.from('profiles')
    .select('name, phone, email, points, created_at')
    .eq('id', user.id)
    .single();

  if (error?.code === '42703') {
    const fallback = await DB.from('profiles')
      .select('name, phone, email, created_at')
      .eq('id', user.id)
      .single();
    profile = fallback.data ? { ...fallback.data, points: 0 } : null;
    error = fallback.error;
  }

  document.getElementById('profile-loading').classList.add('hidden');
  if (error || !profile) {
    document.getElementById('profile-error').classList.remove('hidden');
    return;
  }

  const name = profile.name || user.user_metadata?.name || 'Cliente';
  const createdAt = new Date(profile.created_at).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-full-name').textContent = name;
  document.getElementById('profile-email').textContent = profile.email || user.email;
  document.getElementById('profile-phone').textContent = formatPhone(profile.phone);
  document.getElementById('profile-points').textContent = profile.points ?? 0;
  document.getElementById('profile-member').textContent = `Cliente desde ${createdAt}`;
  document.getElementById('profile-content').classList.remove('hidden');
}

document.getElementById('profile-logout').addEventListener('click', async () => {
  await DB.auth.signOut();
  window.location.replace('index.html');
});

loadProfile();
