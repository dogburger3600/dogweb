'use strict';

let menuProducts = [];

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
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3500);
}

async function verifyMenuManager() {
  const { data: { user } } = await DB.auth.getUser();
  if (!user) return false;
  const { data } = await DB.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role === 'manager';
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

  if (!filtered.length) {
    grid.innerHTML = `<div class="menu-empty"><span>🍽️</span><h2>Nenhum produto encontrado</h2><p>Use “Novo produto” para começar a montar seu cardápio.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(product => {
    const image = validImageUrl(product.img);
    const categoryMeta = CAT_MAP[product.category] || { emoji:'🍽️', label:product.category };
    return `<article class="menu-edit-card${product.active ? '' : ' archived'}">
      <div class="menu-edit-image">
        ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(product.name)}" loading="lazy" onerror="this.style.display='none'" />` : '<span class="menu-placeholder-icon" aria-hidden="true">🍔</span>'}
        <span class="product-cat-badge">${categoryMeta.emoji} ${escapeHtml(categoryMeta.label)}</span>
        ${product.active ? '' : '<span class="menu-archived-badge">Desativado</span>'}
      </div>
      <div class="menu-edit-body">
        <div class="menu-edit-title"><h2>${escapeHtml(product.name)}</h2><strong>R$ ${fmt(product.price)}</strong></div>
        <p>${escapeHtml(product.desc)}</p>
        <div class="menu-edit-actions">
          <button class="btn-edit-product" data-action="edit" data-id="${product.id}">Editar</button>
          <button class="${product.active ? 'btn-delete-product' : 'btn-restore-product'}" data-action="toggle" data-id="${product.id}">${product.active ? 'Excluir' : 'Restaurar'}</button>
        </div>
      </div>
    </article>`;
  }).join('');
}

async function loadMenuProducts() {
  const grid = document.getElementById('menu-manager-grid');
  grid.innerHTML = '<p class="menu-grid-loading">Carregando produtos...</p>';
  try {
    menuProducts = await Store.getAllProducts();
    renderMenuProducts();
  } catch (error) {
    grid.innerHTML = `<div class="menu-empty"><h2>Não foi possível carregar</h2><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function openProductModal(product = null) {
  document.getElementById('product-modal-title').textContent = product ? 'Editar produto' : 'Novo produto';
  document.getElementById('product-id').value = product?.id || '';
  document.getElementById('product-name').value = product?.name || '';
  document.getElementById('product-description').value = product?.desc || '';
  document.getElementById('product-category').value = product?.category || 'lanches';
  document.getElementById('product-image').value = '';
  document.getElementById('product-current-image').value = product?.img || '';
  document.getElementById('product-price').value = product?.price ?? '';
  updateImagePreview(product?.img || '');
  document.getElementById('product-form-error').textContent = '';
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
  if (!imageFile && !currentImage) {
    errorElement.textContent = 'Escolha uma foto para o produto.';
    return;
  }
  if (imageFile && (!imageFile.type.startsWith('image/') || imageFile.size > 5 * 1024 * 1024)) {
    errorElement.textContent = 'Escolha uma imagem JPG, PNG, WEBP ou GIF de até 5 MB.';
    return;
  }
  const existingProduct = menuProducts.find(item => item.id === Number(id));
  const product = {
    name:document.getElementById('product-name').value.trim(), desc:document.getElementById('product-description').value.trim(),
    category:document.getElementById('product-category').value, img:currentImage,
    price:Number(document.getElementById('product-price').value), cost:existingProduct?.cost ?? 0,
    stock:existingProduct?.stock ?? 0, minStock:existingProduct?.minStock ?? 0,
  };
  const button = document.getElementById('save-product');
  button.disabled = true;
  button.textContent = 'Salvando...';
  try {
    if (imageFile) product.img = await Store.uploadProductImage(imageFile);
    if (id) await Store.updateProduct(Number(id), product);
    else await Store.addProduct(product);
    closeProductModal();
    await loadMenuProducts();
    showMenuToast(id ? '✅ Produto atualizado.' : '✅ Produto criado.');
  } catch (error) {
    errorElement.textContent = `Não foi possível salvar. ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Salvar produto';
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
document.getElementById('menu-manager-logout').addEventListener('click', async () => { await DB.auth.signOut(); window.location.replace('index.html'); });

(async () => {
  if (!(await verifyMenuManager())) {
    window.location.replace('entrar.html');
    return;
  }
  document.getElementById('menu-manager-loading').classList.add('hidden');
  document.getElementById('page-menu-manager').classList.remove('hidden');
  await loadMenuProducts();
})();
