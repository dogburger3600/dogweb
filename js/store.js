'use strict';

async function loadProductsWithComposition(includeInactive = false) {
  let productsQuery = DB.from('products').select('*').order(includeInactive ? 'created_at' : 'name', { ascending:includeInactive ? false : true });
  if (!includeInactive) productsQuery = productsQuery.eq('active', true);
  const [productsResult, componentsResult, groupsResult, optionsResult] = await Promise.all([
    productsQuery,
    DB.from('product_components').select('parent_product_id, component_product_id, quantity'),
    DB.from('product_choice_groups').select('id, parent_product_id, name, required_quantity').order('id'),
    DB.from('product_choice_options').select('group_id, component_product_id, component_quantity'),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (componentsResult.error) throw componentsResult.error;
  if (groupsResult.error) throw groupsResult.error;
  if (optionsResult.error) throw optionsResult.error;

  const rawById = new Map(productsResult.data.map(product => [product.id, product]));
  const mapProduct = product => ({
    id:product.id, name:product.name, desc:product.description,
    ingredients:Array.isArray(product.ingredients) ? product.ingredients : [],
    price:Number(product.price), cost:Number(product.cost), category:product.category,
    img:product.image_url, stock:Number(product.stock) || 0, minStock:Number(product.min_stock) || 0,
    active:product.active, sellable:product.sellable !== false,
    inventoryTracked:Boolean(product.inventory_tracked), isComposite:Boolean(product.is_composite),
  });
  const mappedById = new Map(productsResult.data.map(product => [product.id, mapProduct(product)]));
  const groupsByParent = new Map();
  groupsResult.data.forEach(group => {
    const options = optionsResult.data.filter(option => option.group_id === group.id).map(option => ({
      productId:option.component_product_id,
      componentQuantity:option.component_quantity,
      product:mappedById.get(option.component_product_id) || (rawById.has(option.component_product_id) ? mapProduct(rawById.get(option.component_product_id)) : null),
    }));
    if (!groupsByParent.has(group.parent_product_id)) groupsByParent.set(group.parent_product_id, []);
    groupsByParent.get(group.parent_product_id).push({ id:group.id, name:group.name, requiredQuantity:group.required_quantity, options });
  });
  mappedById.forEach(product => {
    product.fixedComponents = componentsResult.data.filter(component => component.parent_product_id === product.id).map(component => ({
      productId:component.component_product_id,
      quantity:component.quantity,
      product:mappedById.get(component.component_product_id) || null,
    }));
    product.choiceGroups = groupsByParent.get(product.id) || [];
  });
  const mapped = [...mappedById.values()];
  return includeInactive ? mapped : mapped.filter(product => product.sellable);
}

const Store = {
  async getProducts() {
    return loadProductsWithComposition(false);
  },
  async getAllProducts() {
    return loadProductsWithComposition(true);
  },
  async addProduct(product) {
    const { error } = await DB.from('products').insert({ name:product.name, description:product.desc, ingredients:product.ingredients, price:product.price, cost:product.cost, category:product.category, image_url:product.img, stock:product.stock, min_stock:product.minStock, active:true });
    if (error) throw error;
  },
  async updateProduct(id, product) {
    const { error } = await DB.from('products').update({ name:product.name, description:product.desc, ingredients:product.ingredients, price:product.price, cost:product.cost, category:product.category, image_url:product.img, stock:product.stock, min_stock:product.minStock }).eq('id', id);
    if (error) throw error;
  },
  async setProductActive(id, active) {
    const { error } = await DB.from('products').update({ active }).eq('id', id);
    if (error) throw error;
  },
  async uploadProductImage(file) {
    const extension = file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error } = await DB.storage.from('product-images').upload(path, file, { cacheControl:'3600', upsert:false, contentType:file.type });
    if (error) throw error;
    const { data } = DB.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  },
  async getActivePopup() {
    const { data, error } = await DB.from('site_popup').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  async getPopupSettings() {
    const { data, error } = await DB.from('site_popup').select('*').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data;
  },
  async savePopup(popup) {
    const { error } = await DB.from('site_popup').upsert({ id:1, title:popup.title, message:popup.message, image_url:popup.imageUrl, button_text:popup.buttonText, button_url:popup.buttonUrl, active:popup.active, starts_at:popup.startsAt, ends_at:popup.endsAt, updated_at:new Date().toISOString() });
    if (error) throw error;
  },
  async getOrders() {
    const { data, error } = await DB.from('orders').select('id, customer_id, customer_name, note, status, created_at, delivery_address, payment_method, change_for, order_items(product_id, quantity, unit_price, unit_cost, removed_ingredients, component_selections)').order('created_at', { ascending:false });
    if (error) throw error;
    const [{ data:cancellations, error:cancellationsError }, { data:history, error:historyError }] = await Promise.all([
      DB.from('order_cancellations').select('order_id, reason, created_at'),
      DB.from('order_status_history').select('order_id, from_status, to_status, changed_by, note, created_at').order('created_at', { ascending:true }),
    ]);
    if (cancellationsError) throw cancellationsError;
    if (historyError) throw historyError;
    const cancellationsByOrder = new Map(cancellations.map(item => [item.order_id, item]));
    const historyByOrder = new Map();
    history.forEach(item => {
      if (!historyByOrder.has(item.order_id)) historyByOrder.set(item.order_id, []);
      historyByOrder.get(item.order_id).push(item);
    });
    const customerIds = [...new Set(data.map(order => order.customer_id).filter(Boolean))];
    const customersById = new Map();
    if (customerIds.length) {
      const { data: customers, error: customersError } = await DB.from('profiles').select('id, name, phone, email').in('id', customerIds);
      if (!customersError) customers.forEach(customer => customersById.set(customer.id, customer));
    }
    return data.map(o => ({ id:`PED-${String(o.id).padStart(3,'0')}`, databaseId:o.id, customerId:o.customer_id, customerName:o.customer_name, customer:customersById.get(o.customer_id) || null, note:o.note, status:o.status, createdAt:new Date(o.created_at).getTime(), address:o.delivery_address, paymentMethod:o.payment_method, changeFor:o.change_for === null ? null : Number(o.change_for), cancellation:cancellationsByOrder.get(o.id) || null, history:historyByOrder.get(o.id) || [], items:o.order_items.map(i => ({ pid:i.product_id, qty:i.quantity, unitPrice:Number(i.unit_price), unitCost:Number(i.unit_cost), removedIngredients:i.removed_ingredients || '', componentSelections:Array.isArray(i.component_selections) ? i.component_selections : [] })) }));
  },
  async getExpenses() {
    const { data, error } = await DB.from('expenses').select('*').order('created_at', { ascending:false });
    if (error) throw error;
    return data.map(e => ({ id:e.id, description:e.description, amount:Number(e.amount), category:e.category, date:new Date(e.created_at).getTime() }));
  },
  async placeOrder(customerName, note, items, paymentMethod, changeFor) {
    const { data, error } = await DB.rpc('place_order', { p_customer_name:customerName, p_note:note, p_items:items.map(i => ({ product_id:i.product.id, quantity:i.qty, removed_ingredients:i.product.category === 'lanches' ? (i.removedIngredients || '') : '', component_selections:i.componentSelections || [] })), p_payment_method:paymentMethod, p_change_for:changeFor });
    if (error) throw error;
    return `PED-${String(data).padStart(3,'0')}`;
  },
  async getStockMovements(limit = 20) {
    const { data, error } = await DB.from('product_stock_movements').select('id, product_id, quantity_delta, resulting_stock, reason, order_id, note, created_at').order('created_at', { ascending:false }).limit(limit);
    if (error) throw error;
    return data;
  },
  async restockProduct(id, quantity, operationId, note = null) {
    const { data, error } = await DB.rpc('restock_product', { p_product_id:id, p_quantity:quantity, p_operation_id:operationId, p_note:note });
    if (error) throw error;
    return data;
  },
  async setProductMinStock(id, minStock) {
    const { data, error } = await DB.rpc('set_product_min_stock', { p_product_id:id, p_min_stock:minStock });
    if (error) throw error;
    return data;
  },
  async setProductInventorySettings(id, inventoryTracked, sellable) {
    const { data, error } = await DB.rpc('set_product_inventory_settings', { p_product_id:id, p_inventory_tracked:inventoryTracked, p_sellable:sellable });
    if (error) throw error;
    return data;
  },
  async saveProductComposition(id, fixedComponents, choiceGroups) {
    const { data, error } = await DB.rpc('save_product_composition', { p_parent_product_id:id, p_fixed_components:fixedComponents, p_choice_groups:choiceGroups });
    if (error) throw error;
    return data;
  },
  async updateOrderStatus(id, status) {
    const { data, error } = await DB.rpc('transition_order_status', { p_order_id:id, p_to_status:status });
    if (error) throw error;
    return data;
  },
  async cancelOrder(id, reason) {
    const { data, error } = await DB.rpc('cancel_order', { p_order_id:id, p_reason:reason });
    if (error) throw error;
    return data;
  },
  async addExpense(expense) {
    const { error } = await DB.from('expenses').insert({ description:expense.description, amount:expense.amount, category:expense.category });
    if (error) throw error;
  },
  async signUp({ name, phone, email, password, address, captchaToken }) {
    const { data, error } = await DB.auth.signUp({ email, password, options:{ captchaToken, data:{ name, phone, consent:true, street:address.street, address_number:address.number, address_complement:address.complement, neighborhood:address.neighborhood } } });
    if (error) throw error;
    return data;
  },
};

const CATEGORIES = [
  { key:'todos', label:'Todos', emoji:'✨' }, { key:'lanches', label:'Lanches', emoji:'🍔' },
  { key:'combos', label:'Combos', emoji:'🍟' }, { key:'sucos', label:'Sucos', emoji:'🍊' },
  { key:'refrigerantes', label:'Refrigerantes', emoji:'🥤' }, { key:'sobremesas', label:'Sobremesas', emoji:'🍨' },
];
const CAT_MAP = { lanches:{label:'Lanches',emoji:'🍔'}, combos:{label:'Combos',emoji:'🍟'}, sucos:{label:'Sucos',emoji:'🍊'}, refrigerantes:{label:'Refrigerantes',emoji:'🥤'}, sobremesas:{label:'Sobremesas',emoji:'🍨'} };
const STATUS_META = { pendente:{label:'Pendente',color:'#D97706',bg:'#FEF3C7'}, preparando:{label:'Preparando',color:'#2563EB',bg:'#DBEAFE'}, pronto:{label:'Pronto',color:'#16A34A',bg:'#DCFCE7'}, entregue:{label:'Entregue',color:'#78716C',bg:'#F5F5F4'} };
const NEXT_STATUS = { pendente:'preparando', preparando:'pronto', pronto:'entregue' };
const PAYMENT_LABELS = { pix:'Pix', credito:'Crédito', debito:'Débito', dinheiro:'Dinheiro' };
const EXPENSE_LABELS = { insumos:'Insumos', funcionarios:'Funcionários', aluguel:'Aluguel', outros:'Outros' };

function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function timeSince(ts) { const mins=Math.floor((Date.now()-ts)/60000); if(mins<1)return'agora'; if(mins<60)return`${mins}min atrás`; const hrs=Math.floor(mins/60); if(hrs<24)return`${hrs}h atrás`; return`${Math.floor(hrs/24)}d atrás`; }
