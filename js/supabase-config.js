'use strict';

const SUPABASE_URL = 'https://ewoakhqtnnpweutnyaxq.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_PWhSGwM2HPqzy9-I2N0m5g_9nGFJ1zG';
const TURNSTILE_SITE_KEY = '0x4AAAAAAFP3cN53ref7l7RU';

const DB = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
