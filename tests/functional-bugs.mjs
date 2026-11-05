import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const waitForAsyncWork = () => new Promise(resolve => setTimeout(resolve, 5));

function loadAuthFeedback() {
  const context = vm.createContext({ window:{} });
  vm.runInContext(read('js/auth-feedback.js'), context);
  return context.window.AuthFeedback;
}

function createStoreHarness() {
  let popupResponse;
  let popupPayload;
  let popupOptions;
  let signupResponse = { data:{ user:{ identities:[{ id:'identity-1' }] }, session:null }, error:null };
  const popupBuilder = {
    upsert(payload, options) { popupPayload = payload; popupOptions = options; return this; },
    select() { return this; },
    async single() { return { data:popupResponse ?? popupPayload, error:null }; },
  };
  const DB = {
    from(table) {
      assert.equal(table, 'site_popup');
      return popupBuilder;
    },
    auth: { async signUp() { return signupResponse; } },
  };
  const context = vm.createContext({ window:{}, DB, crypto:{ randomUUID:() => 'test-id' } });
  vm.runInContext(`${read('js/store.js')}\nwindow.__Store = Store;`, context);
  return {
    Store:context.window.__Store,
    getPopupPayload:() => popupPayload,
    getPopupOptions:() => popupOptions,
    setPopupResponse:value => { popupResponse = value; },
    setSignupResponse:value => { signupResponse = value; },
  };
}

function createRealtimeHarness(initialPreference = 'true', resumeError = null) {
  const storage = new Map([['dogburger:manager:new-order-sound-enabled', initialPreference]]);
  const documentListeners = new Map();
  const windowListeners = new Map();
  const states = [];
  const audioContexts = [];

  class MockAudioContext {
    constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = {}; audioContexts.push(this); }
    async resume() { if (resumeError) throw new Error(resumeError); this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createOscillator() { return { frequency:{ setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    createGain() { return { gain:{ setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
  }

  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
  };
  const client = {
    channel() { return channel; },
    async removeChannel() {},
  };
  const document = {
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    removeEventListener(type, callback) { if (documentListeners.get(type) === callback) documentListeners.delete(type); },
  };
  const window = {
    AudioContext:MockAudioContext,
    document,
    localStorage:{
      getItem:key => storage.get(key) ?? null,
      setItem:(key, value) => storage.set(key, value),
    },
    addEventListener(type, callback) { windowListeners.set(type, callback); },
    removeEventListener(type, callback) { if (windowListeners.get(type) === callback) windowListeners.delete(type); },
  };
  const context = vm.createContext({ window, setTimeout, clearTimeout });
  vm.runInContext(read('js/manager-realtime.js'), context);
  const start = () => window.ManagerRealtime.start({
    client,
    initialOrderIds:[],
    fetchOrders:async () => [],
    applyOrders() {},
    onState:state => states.push({ ...state }),
  });
  return { window, storage, documentListeners, windowListeners, states, audioContexts, start };
}

const authFeedback = loadAuthFeedback();
assert.equal(authFeedback.loginMessage({ code:'email_not_confirmed' }), 'Confirme o e-mail enviado pelo Dog Burger antes de entrar. Verifique também a caixa de spam.');
assert.equal(authFeedback.loginMessage({ code:'invalid_credentials' }), 'E-mail ou senha inválidos.');
assert.match(authFeedback.loginMessage({ message:'Failed to fetch' }), /conectar ao servidor/);
assert.match(authFeedback.loginMessage({ code:'profile_not_found' }), /perfil do cliente não foi encontrado/);
assert.match(authFeedback.signupMessage({ code:'signup_unavailable' }), /já possui uma conta/);

const storeHarness = createStoreHarness();
const popupInput = { title:'Oferta', message:'Mensagem', imageUrl:'image.png', buttonText:'Ver', buttonUrl:'/', active:true, startsAt:null, endsAt:null };
const savedPopup = await storeHarness.Store.savePopup(popupInput);
assert.equal(savedPopup.active, true);
assert.equal(storeHarness.getPopupPayload().active, true);
assert.equal(storeHarness.getPopupOptions().onConflict, 'id');
storeHarness.setPopupResponse({ ...storeHarness.getPopupPayload(), active:false });
await assert.rejects(() => storeHarness.Store.savePopup(popupInput), /não confirmou o estado de publicação/);

const signupInput = { name:'Cliente', phone:'(88) 99999-9999', email:'cliente@example.com', password:'senha-segura', captchaToken:'captcha', address:{ street:'Rua A', number:'1', complement:'', neighborhood:'Centro' } };
storeHarness.setSignupResponse({ data:{ user:{ identities:[] }, session:null }, error:null });
await assert.rejects(() => storeHarness.Store.signUp(signupInput), error => error.code === 'signup_unavailable');
storeHarness.setSignupResponse({ data:{ user:{ identities:[{ id:'identity-1' }] }, session:null }, error:null });
assert.ok((await storeHarness.Store.signUp(signupInput)).user);

const realtime = createRealtimeHarness('true');
realtime.start();
assert.equal(realtime.states.at(-1).soundEnabled, true);
assert.equal(realtime.states.at(-1).soundReady, false);
assert.match(realtime.states.at(-1).soundDetail, /Preferência salva/);
realtime.documentListeners.get('pointerdown')();
await waitForAsyncWork();
assert.equal(realtime.states.at(-1).soundEnabled, true);
assert.equal(realtime.states.at(-1).soundReady, true);

assert.equal(await realtime.window.ManagerRealtime.toggleSound(), false);
assert.equal(realtime.storage.get('dogburger:manager:new-order-sound-enabled'), 'false');
assert.equal(await realtime.window.ManagerRealtime.toggleSound(), true);
assert.equal(realtime.storage.get('dogburger:manager:new-order-sound-enabled'), 'true');
realtime.window.ManagerRealtime.stop();
realtime.start();
assert.equal(realtime.states.at(-1).soundEnabled, true);
assert.equal(realtime.states.at(-1).soundReady, false);
realtime.window.ManagerRealtime.stop();

const blockedRealtime = createRealtimeHarness('false', 'bloqueado pelo navegador');
blockedRealtime.start();
assert.equal(await blockedRealtime.window.ManagerRealtime.toggleSound(), true);
assert.equal(blockedRealtime.storage.get('dogburger:manager:new-order-sound-enabled'), 'true');
assert.equal(blockedRealtime.states.at(-1).soundReady, false);
assert.match(blockedRealtime.states.at(-1).soundDetail, /Preferência salva/);
blockedRealtime.window.ManagerRealtime.stop();

const consumer = read('js/consumer.js');
assert.match(consumer, /let homePopupDismissed = false/);
assert.match(consumer, /if \(homePopupDismissed\) return/);
assert.doesNotMatch(consumer, /dogburger_popup_seen/);

console.log('functional-bugs: PASS');
