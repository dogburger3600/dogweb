'use strict';

const ORDERING_MAINTENANCE = true;
const ORDERING_MAINTENANCE_MESSAGE = 'Pedidos temporariamente indisponíveis para atualização. Tente novamente em alguns minutos.';

if (ORDERING_MAINTENANCE) {
  window.placeOrder = function placeOrderDuringMaintenance() {
    if (typeof window.showToast === 'function') window.showToast(`⚠️ ${ORDERING_MAINTENANCE_MESSAGE}`);
    else window.alert(ORDERING_MAINTENANCE_MESSAGE);
  };

  const placeOrderButton = document.getElementById('btn-place-order');
  if (placeOrderButton) {
    placeOrderButton.textContent = 'Pedidos em manutenção';
    placeOrderButton.setAttribute('aria-label', ORDERING_MAINTENANCE_MESSAGE);
  }
}
