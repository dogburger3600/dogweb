import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const context = vm.createContext({ window:{} });
vm.runInContext(read('js/phone.js'), context);
const PhoneBR = context.window.PhoneBR;

const expectedDdds = [
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  '21', '22', '24', '27', '28',
  '31', '32', '33', '34', '35', '37', '38',
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  '51', '53', '54', '55',
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  '71', '73', '74', '75', '77', '79',
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
];
assert.deepEqual([...PhoneBR.VALID_DDDS], expectedDdds);

for (const ddd of expectedDdds) {
  const canonical = `${ddd}912345678`;
  assert.equal(PhoneBR.normalizeMobile(canonical), canonical, `DDD ${ddd}`);
  assert.equal(PhoneBR.normalizeMobile(`(${ddd}) 91234-5678`), canonical, `DDD formatado ${ddd}`);
  assert.equal(PhoneBR.normalizeMobile(`+55 (${ddd}) 91234-5678`), canonical, `DDD internacional ${ddd}`);
}

for (const value of [
  '88999999999',
  '(88) 99999-9999',
  '+55 (88) 99999-9999',
  '55 88 99999 9999',
]) {
  assert.equal(PhoneBR.normalizeMobile(value), '88999999999', value);
}

for (const value of [
  '',
  '8899999999',
  '88123456789',
  '00999999999',
  '10912345678',
  '23912345678',
  '90912345678',
  '11111111111',
  '+54 11 99999-9999',
  '+88 99999-9999',
  '558899999999',
  '55889999999999',
  'abc88999999999',
  '88.99999.9999',
  '88/99999-9999',
  '88+99999-9999',
  '88\t99999-9999',
]) {
  assert.equal(PhoneBR.normalizeMobile(value), null, value);
}

assert.equal(PhoneBR.formatMobileInput('88999999999'), '(88) 99999-9999');
assert.equal(PhoneBR.formatMobileInput('+5588999999999'), '+55 (88) 99999-9999');
assert.equal(PhoneBR.formatMobileDisplay('5588999999999'), '(88) 99999-9999');
assert.equal(PhoneBR.formatMobileDisplay('8833334444'), '(88) 3333-4444');
assert.equal(PhoneBR.normalizeMobile('8833334444'), null, 'telefone legado não pode ser usado em novo cadastro');
assert.equal(PhoneBR.normalizeMobile('88933334444'), '88933334444', 'legado pode ser atualizado para celular válido');

function uniquenessKeyModel(value) {
  const canonical = PhoneBR.normalizeMobile(value);
  const input = String(value ?? '').trim();
  return canonical ? `mobile:${canonical}` : `legacy:${input}`;
}
assert.equal(uniquenessKeyModel('8833334444'), 'legacy:8833334444');
assert.equal(uniquenessKeyModel('(88) 3333-4444'), 'legacy:(88) 3333-4444');
assert.equal(uniquenessKeyModel('88933334444'), 'mobile:88933334444');
assert.equal(uniquenessKeyModel('+55 (88) 93333-4444'), 'mobile:88933334444');

const reservedPhones = new Set();
async function reservePhone(value) {
  await Promise.resolve();
  const canonical = PhoneBR.normalizeMobile(value);
  if (!canonical) throw new Error('invalid_phone');
  if (reservedPhones.has(canonical)) throw new Error('duplicate_phone');
  reservedPhones.add(canonical);
  return canonical;
}
const concurrent = await Promise.allSettled([
  reservePhone('(88) 99999-9999'),
  reservePhone('+55 (88) 99999-9999'),
]);
assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(concurrent.filter(result => result.status === 'rejected').length, 1);

const equivalentMobileKeys = [uniquenessKeyModel('88933334444'), uniquenessKeyModel('+55 (88) 93333-4444')];
assert.equal(new Set(equivalentMobileKeys).size, 1, 'formatos equivalentes devem disputar a mesma chave única');
assert.notEqual(
  uniquenessKeyModel('8833334444'),
  uniquenessKeyModel('88933334444'),
  'telefone legado não deve ser associado automaticamente ao celular com nono dígito',
);

const authFeedbackContext = vm.createContext({ window:{} });
vm.runInContext(read('js/auth-feedback.js'), authFeedbackContext);
const AuthFeedback = authFeedbackContext.window.AuthFeedback;
const databaseConflict = { code:'unexpected_failure', message:'Database error saving new user' };
assert.equal(AuthFeedback.signupField(databaseConflict), 'form');
assert.match(AuthFeedback.signupMessage(databaseConflict), /Confira os dados/);
assert.doesNotMatch(AuthFeedback.signupMessage(databaseConflict), /telefone/i);
assert.doesNotMatch(AuthFeedback.signupMessage(databaseConflict), /SQL|23505|constraint|profiles_phone_key/i);
assert.equal(AuthFeedback.signupField({ code:'invalid_phone' }), 'phone');

const auditSql = read('supabase/audits/phone-uniqueness-read-only.sql');
const proposalSql = read('supabase/audits/phone-uniqueness-migration-proposal.sql');
const sqlDddList = proposalSql
  .match(/left\(value, 2\) = any\(array\[([\s\S]*?)\]::text\[\]\)/)?.[1]
  ?.match(/'\d{2}'/g)
  ?.map(value => value.slice(1, -1));
assert.deepEqual(sqlDddList, expectedDdds, 'JavaScript e SQL devem usar a mesma lista de DDDs');
const sqlSelfTestDddList = proposalSql
  .match(/foreach ddd in array array\[([\s\S]*?)\]::text\[\] loop/)?.[1]
  ?.match(/'\d{2}'/g)
  ?.map(value => value.slice(1, -1));
assert.deepEqual(sqlSelfTestDddList, expectedDdds, 'autoteste SQL deve cobrir a mesma lista de DDDs');
assert.doesNotMatch(auditSql, /\b(insert|update|delete|truncate|alter|create|drop)\b/i);
assert.match(proposalSql, /confirmation_text constant text := 'REVIEW_REQUIRED'/);
assert.match(proposalSql, /profiles_phone_key/);
assert.match(proposalSql, /profiles_phone_canonical_key/);
assert.match(proposalSql, /profile_phone_uniqueness_key/);
assert.match(proposalSql, /before insert or update of phone/);
assert.match(proposalSql, /lock_timeout = '5s'/);
assert.match(proposalSql, /lock table public\.profiles in share row exclusive mode/);
assert.match(proposalSql, /t\.tgname = 'on_auth_user_created'/);
assert.match(proposalSql, /p\.proname = 'handle_new_user'/);
assert.match(proposalSql, /t\.tgname = 's01_force_customer_role_on_insert'/);
assert.match(proposalSql, /p\.proname = 'force_new_profile_customer_role'/);
assert.equal((proposalSql.match(/t\.tgenabled in \('O', 'A'\)/g) || []).length, 2);
assert.match(proposalSql, /RLS de profiles desabilitada/);
assert.match(proposalSql, /índice canônico incompatível/);
assert.match(proposalSql, /i\.indrelid = 'public\.profiles'::regclass/);
assert.match(proposalSql, /i\.indisvalid/);
assert.match(proposalSql, /i\.indisready/);
assert.match(proposalSql, /i\.indpred is null/);
assert.match(proposalSql, /to_regclass\('public\.profiles_phone_canonical_key'\) is not null/);
assert.doesNotMatch(proposalSql, /\breindex\b/i);
assert.match(proposalSql, /raw_value !~ '\^\\\+\?\[0-9\(\) -\]\+\$'/);
assert.match(proposalSql, /do \$normalizer_self_test\$/);
assert.match(proposalSql, /profile_phone_uniqueness_key\('8833334444'\)/);
assert.match(proposalSql, /'legacy:' \|\| raw_value/);
assert.match(proposalSql, /'mobile:' \|\| canonical_phone/);
assert.doesNotMatch(proposalSql, /left\(digits, 2\) \|\| '9' \|\| substr\(digits, 3\)/);
assert.equal((proposalSql.match(/p\.pronargs = 0/g) || []).length, 2);
assert.equal((proposalSql.match(/p\.prorettype = 'trigger'::regtype/g) || []).length, 2);
assert.doesNotMatch(proposalSql, /update\s+public\.profiles|delete\s+from\s+public\.profiles|alter\s+table\s+public\.profiles\s+drop/i);
assert.doesNotMatch(proposalSql, /update\s+public\.profiles\s+set\s+phone/i);

console.log('phone-uniqueness: PASS');
