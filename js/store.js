'use strict';

const Store = {
  async getProducts() {
    const { data, error } = await DB.from('products').select('*').eq('active', true).order('name');
    if (error) throw error;
    return data.map(p => ({ id:p.id, name:p.name, desc:p.description, price:Number(p.price), cost:Number(p.cost), category:p.category, img:p.image_url, stock:p.stock, minStock:p.min_stock }));
  },
  async getAllProducts() {
    const { data, error } = await DB.from('products').select('*').order('created_at', { ascending:false });
    if (error) throw error;
    return data.map(p => ({ id:p.id, name:p.name, desc:p.description, price:Number(p.price), cost:Number(p.cost), category:p.category, img:p.image_url, stock:p.stock, minStock:p.min_stock, active:p.active }));
  },
  async addProduct(product) {
    const { error } = await DB.from('products').insert({ name:product.name, description:product.desc, price:product.price, cost:product.cost, category:product.category, image_url:product.img, stock:product.stock, min_stock:product.minStock, active:true });
    if (error) throw error;
  },
  async updateProduct(id, product) {
    const { error } = await DB.from('products').update({ name:product.name, description:product.desc, price:product.price, cost:product.cost, category:product.category, image_url:product.img, stock:product.stock, min_stock:product.minStock }).eq('id', id);
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
    const { data, error } = await DB.from('orders').select('id, customer_id, customer_name, note, status, created_at, delivery_address, order_items(product_id, quantity, unit_price, unit_cost)').order('created_at', { ascending:false });
    if (error) throw error;
    const customerIds = [...new Set(data.map(order => order.customer_id).filter(Boolean))];
    const customersById = new Map();
    if (customerIds.length) {
      const { data: customers, error: customersError } = await DB.from('profiles').select('id, name, phone, email').in('id', customerIds);
      if (!customersError) customers.forEach(customer => customersById.set(customer.id, customer));
    }
    return data.map(o => ({ id:`PED-${String(o.id).padStart(3,'0')}`, databaseId:o.id, customerId:o.customer_id, customerName:o.customer_name, customer:customersById.get(o.customer_id) || null, note:o.note, status:o.status, createdAt:new Date(o.created_at).getTime(), address:o.delivery_address, items:o.order_items.map(i => ({ pid:i.product_id, qty:i.quantity, unitPrice:Number(i.unit_price), unitCost:Number(i.unit_cost) })) }));
  },
  async getExpenses() {
    const { data, error } = await DB.from('expenses').select('*').order('created_at', { ascending:false });
    if (error) throw error;
    return data.map(e => ({ id:e.id, description:e.description, amount:Number(e.amount), category:e.category, date:new Date(e.created_at).getTime() }));
  },
  async placeOrder(customerName, note, items) {
    const { data, error } = await DB.rpc('place_order', { p_customer_name:customerName, p_note:note, p_items:items.map(i => ({ product_id:i.product.id, quantity:i.qty })) });
    if (error) throw error;
    return `PED-${String(data).padStart(3,'0')}`;
  },
  async updateProductStock(id, stock) {
    const { error } = await DB.from('products').update({ stock }).eq('id', id);
    if (error) throw error;
  },
  async updateOrderStatus(id, status) {
    const { error } = await DB.from('orders').update({ status }).eq('id', id);
    if (error) throw error;
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
  { key:'todos', label:'Todos', emoji:'✨' }, { key:'lanches', label:'Lanches', emoji:'<img src="dogburger.png" alt="" class="category-logo-img" />' },
  { key:'combos', label:'Combos', emoji:'🍟' }, { key:'sucos', label:'Sucos', emoji:'🍊' },
  { key:'refrigerantes', label:'Refrigerantes', emoji:'🥤' }, { key:'sobremesas', label:'Sobremesas', emoji:'🍨' },
];
const CAT_MAP = { lanches:{label:'Lanches',emoji:'<img src="dogburger.png" alt="" class="category-logo-img" />'}, combos:{label:'Combos',emoji:'🍟'}, sucos:{label:'Sucos',emoji:'🍊'}, refrigerantes:{label:'Refrigerantes',emoji:'🥤'}, sobremesas:{label:'Sobremesas',emoji:'🍨'} };
const STATUS_META = { pendente:{label:'Pendente',color:'#D97706',bg:'#FEF3C7'}, preparando:{label:'Preparando',color:'#2563EB',bg:'#DBEAFE'}, pronto:{label:'Pronto',color:'#16A34A',bg:'#DCFCE7'}, entregue:{label:'Entregue',color:'#78716C',bg:'#F5F5F4'} };
const NEXT_STATUS = { pendente:'preparando', preparando:'pronto', pronto:'entregue' };
const EXPENSE_LABELS = { insumos:'Insumos', funcionarios:'Funcionários', aluguel:'Aluguel', outros:'Outros' };

function fmt(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function timeSince(ts) { const mins=Math.floor((Date.now()-ts)/60000); if(mins<1)return'agora'; if(mins<60)return`${mins}min atrás`; const hrs=Math.floor(mins/60); if(hrs<24)return`${hrs}h atrás`; return`${Math.floor(hrs/24)}d atrás`; }
