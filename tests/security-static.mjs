import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const roles = read('supabase/migrations/20261022000200_s01_roles_and_capabilities.sql');
const rls = read('supabase/migrations/20261022000300_s02_rls_acl_hardening.sql');
const store = read('js/store.js');
const consumer = read('js/consumer.js');
const manager = read('js/manager.js');
const login = read('js/entrar.js');
const signup = read('js/cadastro.js');
const cleanupProposal = read('supabase/audits/test-data-cleanup-proposal.sql');

assert.match(roles, /Somente owner pode alterar perfis de acesso/);
assert.match(roles, /O ultimo owner nao pode ser removido ou rebaixado/);
assert.match(roles, /revoke update on table public\.profiles from public, anon, authenticated/);
assert.match(roles, /revoke update \(id, email, points, role, created_at\)/);
assert.doesNotMatch(roles, /create or replace function public\.handle_new_user/);
assert.match(roles, /new\.role := 'customer'::public\.user_role/);

assert.match(rls, /revoke select on table public\.products from public, anon, authenticated/);
assert.match(rls, /revoke select on table public\.order_items from public, anon, authenticated/);
assert.match(rls, /revoke select \(cost\) on public\.products/);
assert.match(rls, /revoke select \(unit_cost\) on public\.order_items/);
const productGrant = rls.match(/grant select \([^;]+\)\s+on public\.products to anon, authenticated;/)?.[0] || '';
const orderItemGrant = rls.match(/grant select \([^;]+\)\s+on public\.order_items to authenticated;/)?.[0] || '';
assert.ok(productGrant);
assert.ok(orderItemGrant);
assert.doesNotMatch(productGrant, /\bcost\b/);
assert.doesNotMatch(orderItemGrant, /unit_cost/);
assert.match(rls, /has_capability\('advance_orders'\)/);
assert.match(rls, /has_capability\('cancel_orders'\)/);
assert.match(rls, /bucket_id='product-images'.*has_capability\('manage_menu'\)/);

assert.doesNotMatch(store.match(/async getProducts\(\)[\s\S]*?\n  },/)?.[0] || '', /select\('\*'\)/);
assert.doesNotMatch(store.match(/async getProducts\(\)[\s\S]*?\n  },/)?.[0] || '', /cost:/);
assert.match(store, /rpc\('get_admin_products'\)/);
assert.match(store, /rpc\('get_admin_order_costs'\)/);
assert.match(store, /order_items\(product_id, product_name, quantity, unit_price, removed_ingredients\)/);
assert.match(store, /productName:i\.product_name/);
assert.doesNotMatch(store.match(/async getOrders\(\)[\s\S]*?\n  },/)?.[0] || '', /order_items\([^)]*unit_cost/);
assert.match(store, /rpc\('get_operational_cancellation_flags'\)/);
assert.match(store, /async setProductActive\(id, active\)[\s\S]*?update\(\{ active \}\)/);
assert.match(store, /update\(\{ active \}\)[\s\S]*?select\('id, active'\)\.single\(\)/);
assert.doesNotMatch(store, /from\('products'\)\.delete\(/);

assert.match(consumer, /safeProductImageUrl/);
assert.match(consumer, /escapeCartHtml\(p\.name\)/);
assert.match(consumer, /escapeCartHtml\(p\.desc\)/);
assert.match(consumer, /const imageUrl = safePopupUrl\(popup\.image_url\)/);
assert.match(manager, /\['owner', 'manager', 'attendant'\]\.includes/);
assert.match(manager, /p\?\.name \|\| i\.productName \|\| 'Produto indisponível'/);
assert.match(manager, /data-capability="manageStock"[^>]*>Abrir área preparada/);
assert.match(manager, /data-capability="manageMenu"[^>]*data-delete-product-id/);
assert.match(manager, /UICapabilities\?\.can\(currentManagerRole, 'manageMenu'\)/);
assert.match(manager, /Store\.setProductActive\(productId, false\)/);
assert.match(manager, /product\.category === 'lanches' && product\.active !== false/);
assert.doesNotMatch(manager, /signInWithPassword/);
assert.match(read('js/ui-capabilities.js'), /currentRole = ROLE_LABELS\[role\] \? role : 'customer'/);
assert.match(login, /captchaToken:loginCaptchaToken/);
assert.match(signup, /captchaToken:signupCaptchaToken/);

for (const source of [store, consumer, manager, login, signup]) {
  assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE/i);
}

assert.match(cleanupProposal, /confirmation_text constant text := 'REVIEW_REQUIRED'/);
assert.match(cleanupProposal, /auth_users_before/);
assert.match(cleanupProposal, /profiles_before/);
assert.doesNotMatch(cleanupProposal, /drop\s+(table|function)|delete\s+from\s+auth\.users|delete\s+from\s+public\.profiles|\bcascade\b/i);

console.log('security-static: PASS');
