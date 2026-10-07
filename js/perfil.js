'use strict';

let currentProfile = null;

function formatPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
  return phone || 'Não informado';
}

function formatAddress(profile) {
  const firstLine = [profile.street, profile.address_number].filter(Boolean).join(', ');
  const complement = profile.address_complement ? ` · ${profile.address_complement}` : '';
  const neighborhood = profile.neighborhood ? ` — ${profile.neighborhood}` : '';
  return `${firstLine}${complement}${neighborhood}` || 'Não informado';
}

async function loadProfile() {
  const { data: { user }, error: userError } = await DB.auth.getUser();
  if (userError || !user) {
    window.location.replace('entrar.html');
    return;
  }

  let { data: profile, error } = await DB.from('profiles')
    .select('name, phone, email, points, created_at, street, address_number, address_complement, neighborhood')
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
  currentProfile = { ...profile, email:profile.email || user.email };
  const createdAt = new Date(profile.created_at).toLocaleDateString('pt-BR', { month:'long', year:'numeric' });
  document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-full-name').textContent = name;
  document.getElementById('profile-email').textContent = profile.email || user.email;
  document.getElementById('profile-phone').textContent = formatPhone(profile.phone);
  document.getElementById('profile-address').textContent = formatAddress(profile);
  document.getElementById('profile-points').textContent = profile.points ?? 0;
  document.getElementById('profile-member').textContent = `Cliente desde ${createdAt}`;
  document.getElementById('profile-content').classList.remove('hidden');
}

function showProfileToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

function openProfileEdit() {
  if (!currentProfile) return;
  document.getElementById('profile-edit-name').value = currentProfile.name || '';
  document.getElementById('profile-edit-email').value = currentProfile.email || '';
  document.getElementById('profile-edit-phone').value = formatPhone(currentProfile.phone);
  document.getElementById('profile-edit-street').value = currentProfile.street || '';
  document.getElementById('profile-edit-address-number').value = currentProfile.address_number || '';
  document.getElementById('profile-edit-address-complement').value = currentProfile.address_complement || '';
  document.getElementById('profile-edit-neighborhood').value = currentProfile.neighborhood || '';
  document.getElementById('profile-edit-password').value = '';
  document.getElementById('profile-edit-confirm').value = '';
  document.getElementById('profile-edit-error').textContent = '';
  document.getElementById('profile-info-view').classList.add('hidden');
  document.getElementById('profile-edit-form').classList.remove('hidden');
  document.getElementById('profile-edit-button').classList.add('hidden');
  document.getElementById('profile-edit-name').focus();
}

function closeProfileEdit() {
  document.getElementById('profile-info-view').classList.remove('hidden');
  document.getElementById('profile-edit-form').classList.add('hidden');
  document.getElementById('profile-edit-button').classList.remove('hidden');
}

document.getElementById('profile-edit-phone').addEventListener('input', event => {
  const digits = event.target.value.replace(/\D/g, '').slice(0, 11);
  event.target.value = formatPhone(digits);
});

document.getElementById('profile-edit-button').addEventListener('click', openProfileEdit);
document.getElementById('profile-edit-cancel').addEventListener('click', closeProfileEdit);
document.getElementById('profile-edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = document.getElementById('profile-edit-name').value.trim().replace(/\s+/g, ' ');
  const phone = document.getElementById('profile-edit-phone').value.replace(/\D/g, '');
  const password = document.getElementById('profile-edit-password').value;
  const confirmation = document.getElementById('profile-edit-confirm').value;
  const address = {
    street:document.getElementById('profile-edit-street').value.trim(),
    address_number:document.getElementById('profile-edit-address-number').value.trim(),
    address_complement:document.getElementById('profile-edit-address-complement').value.trim(),
    neighborhood:document.getElementById('profile-edit-neighborhood').value.trim(),
  };
  const errorElement = document.getElementById('profile-edit-error');
  const button = document.getElementById('profile-edit-save');
  errorElement.textContent = '';

  if (name.length < 3 || !name.includes(' ')) {
    errorElement.textContent = 'Informe seu nome e sobrenome.';
    return;
  }
  if (phone.length < 10 || phone.length > 11) {
    errorElement.textContent = 'Informe um celular válido com DDD.';
    return;
  }
  if (password && password.length < 6) {
    errorElement.textContent = 'A nova senha deve ter pelo menos 6 caracteres.';
    return;
  }
  if (password !== confirmation) {
    errorElement.textContent = 'A confirmação da nova senha não coincide.';
    return;
  }
  if (!address.street || !address.address_number || !address.neighborhood) {
    errorElement.textContent = 'Preencha todos os campos obrigatórios do endereço.';
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    const { data: { user } } = await DB.auth.getUser();
    const { error: profileError } = await DB.from('profiles').update({ name, phone, ...address }).eq('id', user.id);
    if (profileError) throw profileError;

    const authChanges = { data:{ name, phone } };
    if (password) authChanges.password = password;
    const { error: authError } = await DB.auth.updateUser(authChanges);
    if (authError) throw authError;

    currentProfile = { ...currentProfile, name, phone, ...address };
    document.getElementById('profile-name').textContent = name;
    document.getElementById('profile-full-name').textContent = name;
    document.getElementById('profile-phone').textContent = formatPhone(phone);
    document.getElementById('profile-address').textContent = formatAddress(currentProfile);
    document.getElementById('profile-avatar').textContent = name.charAt(0).toUpperCase();
    closeProfileEdit();
    showProfileToast('✅ Perfil atualizado com sucesso.');
  } catch (error) {
    errorElement.textContent = error.code === '23505' ? 'Este celular já está sendo usado por outra conta.' : `Não foi possível salvar. ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar alterações';
  }
});

document.getElementById('profile-logout').addEventListener('click', async () => {
  await DB.auth.signOut();
  window.location.replace('index.html');
});

loadProfile();
