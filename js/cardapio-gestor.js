'use strict';

let menuProducts = [];

function menuIcon(name, className = 'manager-icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#menu-icon-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
}

function validImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function showMenuToast(message) {
  const toast = document.getElementById('toast');
  toast.innerHTML = `<span aria-hidden="true">${menuIcon('check')}</span><strong>${escapeHtml(message)}</strong>`;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

function parseIngredients(value) {
  return [...new Set(String(value || '').split(',').map(ingredient => ingredient.trim()).filter(Boolean))].slice(0, 30);
}

function updateIngredientsField() {
  const category = document.getElementById('product-category').value;
  const isSnack = category === 'lanches';
  document.getElementById('product-ingredients-group').classList.toggle('hidden', !isSnack);
  document.getElementById('product-ready-stock-group').classList.toggle('hidden', !isSnack);
}

function updateDescriptionCount() {
  const description = document.getElementById('product-description').value;
  document.getElementById('product-description-count').textContent = `${description.length}/240`;
}

function clearProductValidation() {
  document.querySelectorAll('#product-form .input-error').forEach(element => element.classList.remove('input-error'));
  document.querySelectorAll('#product-form .form-error').forEach(element => { element.textContent = ''; });
}

function productFieldError(id, message) {
  document.getElementById(id)?.classList.add('input-error');
  const error = document.getElementById(`${id}-error`);
  if (error) error.textContent = message;
  return false;
}

function validateProductFields() {
  clearProductValidation();
  let valid = true;
  const name = document.getElementById('product-name').value.trim();
  const description = document.getElementById('product-description').value.trim();
  const category = document.getElementById('product-category').value;
  const priceValue = document.getElementById('product-price').value.trim();
  const price = Number(priceValue);
  if (!name) valid = productFieldError('product-name', 'Informe o nome do produto.');
  if (!description) valid = productFieldError('product-description', 'Informe a descrição do produto.');
  if (!['lanches','pasteis','combos','sucos','refrigerantes','sobremesas'].includes(category)) valid = productFieldError('product-category', 'Selecione uma categoria válida.');
  if (priceValue === '' || !Number.isFinite(price) || price < 0) valid = productFieldError('product-price', 'Informe um preço válido igual ou maior que zero.');
  if (category === 'lanches' && !parseIngredients(document.getElementById('product-ingredients').value).length) valid = productFieldError('product-ingredients', 'Informe pelo menos um ingrediente do lanche.');
  return valid;
}

async function verifyMenuManager() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) return false;
  const [profileResult, capabilityResult] = await Promise.all([
    DB.from('profiles').select('role').eq('id', user.id).maybeSingle(),
    DB.rpc('has_capability', { p_capability:'manage_menu' }),
  ]);
  const role = profileResult.data?.role;
  return !profileResult.error && !capabilityResult.error && capabilityResult.data === true
    && ['owner', 'manager'].includes(role) ? role : null;
}

function renderMenuProducts() {
  const grid = document.getElementById('menu-manager-grid');
  const search = document.getElementById('menu-search').value.trim().toLowerCase();
  const category = document.getElementById('menu-category-filter').value;
  const showArchived = document.getElementById('show-archived').checked;
  const filtered = menuProducts.filter(product => {
    const matchesSearch = product.name.toLowerCase().includes(search) || product.desc.toLowerCase().includes(search);
    const matchesCategory = category === 'todos' || product.category === category;
    return matchesSearch && matchesCategory && (product.active || showArchived);
  });
  const activeCount = menuProducts.filter(product => product.active).length;
  const snackCount = menuProducts.filter(product => product.category === 'lanches').length;
  document.getElementById('menu-editor-summary').innerHTML = `<span><strong>${menuProducts.length}</strong> produtos</span><span><strong>${activeCount}</strong> ativos</span><span><strong>${snackCount}</strong> lanches</span>`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="menu-empty"><span aria-hidden="true">${menuIcon('products')}</span><h2>Nenhum produto encontrado</h2><p>Use “Novo produto” para começar a montar seu cardápio.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(product => {
    const image = validImageUrl(product.img);
    const categoryMeta = CAT_MAP[product.category] || { label:product.category };
    return `<article class="menu-edit-card${product.active ? '' : ' archived'}">
      <div class="menu-edit-image">
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.style.display='none'" />` : `<span class="menu-placeholder-icon" aria-hidden="true">${menuIcon('image')}</span>`}
        <span class="product-cat-badge">${menuIcon('tag')}<span>${escapeHtml(categoryMeta.label)}</span></span>
        ${product.active ? '' : '<span class="menu-archived-badge">Desativado</span>'}
      </div>
      <div class="menu-edit-body">
        <div class="menu-edit-title"><h2>${escapeHtml(product.name)}</h2><strong>R$ ${fmt(product.price)}</strong></div>
        <p>${escapeHtml(product.desc)}</p>
        ${product.category === 'lanches' && product.ingredients.length ? `<p class="menu-edit-ingredients"><strong>Ingredientes:</strong> ${product.ingredients.map(escapeHtml).join(', ')}</p>` : ''}
        <div class="menu-edit-meta"><span class="menu-availability${product.active ? ' is-active' : ''}"><i aria-hidden="true"></i>${product.active ? 'Disponível' : 'Desativado'}</span>${product.category === 'lanches' ? `<span>Estoque: <b>${Number(product.stock) || 0}</b></span>` : '<span>Sem controle de estoque</span>'}</div>
        <div class="menu-edit-actions">
          <button class="btn-edit-product" data-action="edit" data-id="${product.id}" data-capability="manageMenu" data-capability-mode="disable">${menuIcon('edit')}<span>Editar</span></button>
          <button class="${product.active ? 'btn-delete-product' : 'btn-restore-product'}" data-action="toggle" data-id="${product.id}" data-capability="manageMenu" data-capability-mode="disable">${menuIcon(product.active ? 'archive' : 'restore')}<span>${product.active ? 'Desativar' : 'Restaurar'}</span></button>
        </div>
      </div>
    </article>`;
  }).join('');
}

async function loadMenuProducts() {
  const grid = document.getElementById('menu-manager-grid');
  grid.innerHTML = `<div class="menu-grid-loading" aria-live="polite" aria-busy="true"><span aria-hidden="true"></span><strong>Carregando produtos...</strong><small>Buscando as informações mais recentes do cardápio.</small></div>`;
  try {
    menuProducts = await Store.getAllProducts();
    renderMenuProducts();
  } catch (error) {
    grid.innerHTML = `<div class="menu-empty is-error" role="alert"><span aria-hidden="true">${menuIcon('alert')}</span><h2>Não foi possível carregar</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function openProductModal(product = null) {
  document.getElementById('product-modal-title').textContent = product ? 'Editar produto' : 'Novo produto';
  document.getElementById('product-id').value = product?.id || '';
  document.getElementById('product-name').value = product?.name || '';
  document.getElementById('product-description').value = product?.desc || '';
  document.getElementById('product-category').value = product?.category || 'lanches';
  document.getElementById('product-ingredients').value = (product?.ingredients || []).join(', ');
  updateIngredientsField();
  document.getElementById('product-image').value = '';
  document.getElementById('product-current-image').value = product?.img || '';
  document.getElementById('product-price').value = product?.price ?? '';
  document.getElementById('product-availability-status').textContent = product ? (product.active ? 'Ativo no cardápio' : 'Desativado no cardápio') : 'Novo produto · ativo ao salvar';
  document.getElementById('product-ready-stock').textContent = `${Number(product?.stock) || 0} unidades`;
  updateImagePreview(product?.img || '');
  clearProductValidation();
  updateDescriptionCount();
  document.getElementById('product-overlay').classList.remove('hidden');
  document.getElementById('product-modal').classList.remove('hidden');
  document.getElementById('product-name').focus();
}

function updateImagePreview(source) {
  const preview = document.getElementById('product-image-preview');
  const prompt = document.getElementById('product-upload-prompt');
  if (source) {
    preview.src = source;
    preview.classList.remove('hidden');
    prompt.classList.add('hidden');
  } else {
    preview.removeAttribute('src');
    preview.classList.add('hidden');
    prompt.classList.remove('hidden');
  }
}

function closeProductModal() {
  document.getElementById('product-overlay').classList.add('hidden');
  document.getElementById('product-modal').classList.add('hidden');
}

document.getElementById('product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = document.getElementById('product-id').value;
  const imageFile = document.getElementById('product-image').files[0];
  const currentImage = document.getElementById('product-current-image').value;
  const errorElement = document.getElementById('product-form-error');
  if (!validateProductFields()) return;
  if (!imageFile && !currentImage) {
    errorElement.textContent = 'Escolha uma foto para o produto.';
    return;
  }
  if (imageFile && (!imageFile.type.startsWith('image/') || imageFile.size > 5 * 1024 * 1024)) {
    errorElement.textContent = 'Escolha uma imagem JPG, PNG, WEBP ou GIF de até 5 MB.';
    return;
  }
  const existingProduct = menuProducts.find(item => item.id === Number(id));
  const category = document.getElementById('product-category').value;
  const ingredients = category === 'lanches' ? parseIngredients(document.getElementById('product-ingredients').value) : [];
  const product = {
    name:document.getElementById('product-name').value.trim(), desc:document.getElementById('product-description').value.trim(),
    category, ingredients, img:currentImage,
    price:Number(document.getElementById('product-price').value), cost:existingProduct?.cost ?? 0,
    stock:existingProduct?.stock ?? 0, minStock:existingProduct?.minStock ?? 0,
  };
  const button = document.getElementById('save-product');
  button.disabled = true;
  button.innerHTML = '<span>Salvando...</span>';
  try {
    if (imageFile) product.img = await Store.uploadProductImage(imageFile);
    if (id) await Store.updateProduct(Number(id), product);
    else await Store.addProduct(product);
    closeProductModal();
    await loadMenuProducts();
    showMenuToast(id ? 'Produto atualizado.' : 'Produto criado.');
  } catch (error) {
    errorElement.textContent = `Não foi possível salvar. ${error.message}`;
  } finally {
    button.disabled = false;
    button.innerHTML = `${menuIcon('check')}<span>Salvar produto</span>`;
  }
});

document.getElementById('menu-manager-grid').addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const product = menuProducts.find(item => item.id === Number(button.dataset.id));
  if (!product) return;
  if (button.dataset.action === 'edit') return openProductModal(product);
  if (product.active && !confirm(`Excluir “${product.name}” do cardápio? O histórico dos pedidos será preservado.`)) return;
  button.disabled = true;
  try {
    await Store.setProductActive(product.id, !product.active);
    await loadMenuProducts();
    showMenuToast(product.active ? 'Produto removido do cardápio.' : 'Produto restaurado.');
  } catch (error) {
    alert(`Não foi possível alterar o produto. ${error.message}`);
  }
});

document.getElementById('new-product-button').addEventListener('click', () => openProductModal());
document.getElementById('product-category').addEventListener('change', updateIngredientsField);
document.getElementById('product-description').addEventListener('input', updateDescriptionCount);
document.getElementById('choose-product-image').addEventListener('click', () => document.getElementById('product-image').click());
document.getElementById('product-upload-box').addEventListener('click', event => {
  if (!event.target.closest('button')) document.getElementById('product-image').click();
});
document.getElementById('product-image').addEventListener('change', event => {
  const file = event.target.files[0];
  if (file) updateImagePreview(URL.createObjectURL(file));
});
document.getElementById('close-product-modal').addEventListener('click', closeProductModal);
document.getElementById('cancel-product').addEventListener('click', closeProductModal);
document.getElementById('product-overlay').addEventListener('click', closeProductModal);
document.getElementById('menu-search').addEventListener('input', renderMenuProducts);
document.getElementById('menu-category-filter').addEventListener('change', renderMenuProducts);
document.getElementById('show-archived').addEventListener('change', renderMenuProducts);
async function signOutMenuManager() { await DB.auth.signOut(); window.location.replace('index.html'); }
document.getElementById('menu-manager-logout').addEventListener('click', signOutMenuManager);
document.getElementById('menu-mobile-logout').addEventListener('click', signOutMenuManager);

(async () => {
  const role = await verifyMenuManager();
  if (!role) {
    window.location.replace('entrar.html');
    return;
  }
  document.getElementById('menu-manager-loading').classList.add('hidden');
  document.getElementById('page-menu-manager').classList.remove('hidden');
  window.UICapabilities?.init(role);
  await loadMenuProducts();
})();
