'use strict';

const SUPABASE_URL = 'https://zjgycljvodpaeewawbxz.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__nbiWIg7c0jJS3grjMV5ag_CaxcL7vA';
const TURNSTILE_SITE_KEY = '0x4AAAAAAFP3cN53ref7l7RU';

const DB = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
