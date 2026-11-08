'use strict';

async function updateHeaderAuth() {
  const guestActions = document.getElementById('guest-actions');
  const userActions = document.getElementById('user-actions');
  const { data: { user } } = await DB.auth.getUser();

  if (!user) {
    guestActions.classList.remove('hidden');
    userActions.classList.add('hidden');
    return;
  }

  const [{ data: profile }, capabilityResult] = await Promise.all([
    DB.from('profiles').select('name, role').eq('id', user.id).maybeSingle(),
    DB.rpc('has_capability', { p_capability:'view_dashboard' }),
  ]);
  const name = profile?.name || user.user_metadata?.name || user.email.split('@')[0];
  document.getElementById('header-user-name').textContent = name;
  document.getElementById('header-user-avatar').textContent = name.charAt(0).toUpperCase();
  guestActions.classList.add('hidden');
  userActions.classList.remove('hidden');
  const canViewDashboard = !capabilityResult.error && capabilityResult.data === true
    && ['owner', 'manager', 'attendant'].includes(profile?.role);
  document.getElementById('manager-shortcut').classList.toggle('hidden', !canViewDashboard);
}

document.getElementById('header-logout').addEventListener('click', async () => {
  await DB.auth.signOut();
  await updateHeaderAuth();
});

updateHeaderAuth();
