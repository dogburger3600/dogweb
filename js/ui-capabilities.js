'use strict';

// Preparação exclusivamente visual. Autorização real deve continuar no backend, Auth e RLS.
(function exposeUiCapabilities(global) {
  const ROLE_LABELS = Object.freeze({ owner:'Owner', manager:'Manager', attendant:'Atendente', customer:'Cliente' });
  const CAPABILITY_MATRIX = Object.freeze({
    viewDashboard:        Object.freeze(['owner','manager','attendant']),
    viewOrders:           Object.freeze(['owner','manager','attendant']),
    advanceOrders:        Object.freeze(['owner','manager','attendant']),
    viewReports:          Object.freeze(['owner','manager']),
    manageStock:          Object.freeze(['owner','manager']),
    manageMenu:           Object.freeze(['owner','manager']),
    managePopup:          Object.freeze(['owner','manager']),
    manageSettings:       Object.freeze(['owner','manager']),
    manageSensitiveRules:Object.freeze(['owner']),
    viewCustomerCatalog:  Object.freeze(['owner','manager','attendant','customer']),
  });
  const ROUTE_CAPABILITIES = Object.freeze({
    dashboard:'viewDashboard', pedidos:'viewOrders', relatorios:'viewReports',
    'estoque-lanches':'manageStock', popup:'managePopup', configuracoes:'manageSettings',
  });
  const DEV_HOSTS = new Set(['localhost','127.0.0.1','::1']);
  const MOCK_KEY = 'dogburger_visual_role_mock';
  let currentRole = 'manager';
  let observer = null;

  function isVisualMockEnvironment() {
    return DEV_HOSTS.has(global.location?.hostname || '');
  }

  function can(role, capability) {
    return Boolean(CAPABILITY_MATRIX[capability]?.includes(role));
  }

  function applyElement(element, role) {
    const capability = element.dataset.capability;
    if (!capability) return;
    const allowed = can(role, capability);
    if (element.dataset.capabilityMode === 'disable') {
      element.disabled = !allowed;
      element.setAttribute('aria-disabled', String(!allowed));
      element.title = allowed ? (element.dataset.allowedTitle || element.title) : 'Ação indisponível para este perfil visual';
    } else {
      element.classList.toggle('capability-hidden', !allowed);
      element.setAttribute('aria-hidden', String(!allowed));
    }
  }

  function apply(root = document, role = currentRole) {
    currentRole = ROLE_LABELS[role] ? role : 'manager';
    if (root.matches?.('[data-capability]')) applyElement(root, currentRole);
    root.querySelectorAll?.('[data-capability]').forEach(element => applyElement(element, currentRole));
    document.documentElement.dataset.visualRole = currentRole;
  }

  function visualRole(actualRole) {
    if (!isVisualMockEnvironment()) return actualRole;
    const mock = global.sessionStorage?.getItem(MOCK_KEY);
    return ROLE_LABELS[mock] ? mock : actualRole;
  }

  function mountDevelopmentSwitcher(actualRole) {
    if (!isVisualMockEnvironment() || document.getElementById('visual-role-switcher')) return;
    const panel = document.createElement('aside');
    panel.id = 'visual-role-switcher';
    panel.className = 'visual-role-switcher';
    panel.innerHTML = `<strong>Perfil visual</strong><select aria-label="Simular perfil visual">${Object.entries(ROLE_LABELS).map(([role,label]) => `<option value="${role}"${role === currentRole ? ' selected' : ''}>${label}</option>`).join('')}</select><small>Somente localhost · não concede acesso nem altera o perfil ${ROLE_LABELS[actualRole] || actualRole} autenticado.</small><details><summary>Mapa de capacidades</summary><ul>${Object.entries(CAPABILITY_MATRIX).map(([capability,roles]) => `<li><b>${capability}</b>: ${roles.map(role => ROLE_LABELS[role]).join(', ')}</li>`).join('')}</ul></details>`;
    panel.querySelector('select').addEventListener('change', event => {
      global.sessionStorage.setItem(MOCK_KEY, event.target.value);
      apply(document, event.target.value);
    });
    document.body.appendChild(panel);
  }

  function init(actualRole = 'manager') {
    currentRole = visualRole(actualRole);
    apply(document, currentRole);
    mountDevelopmentSwitcher(actualRole);
    observer?.disconnect();
    observer = new MutationObserver(mutations => mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
      if (node.nodeType === 1) apply(node, currentRole);
    })));
    observer.observe(document.body, { childList:true, subtree:true });
    return currentRole;
  }

  global.UICapabilities = Object.freeze({ CAPABILITY_MATRIX, ROLE_LABELS, ROUTE_CAPABILITIES, can, apply, init, isVisualMockEnvironment });
})(window);
