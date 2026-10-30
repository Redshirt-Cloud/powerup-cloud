const state = { view: 'dashboard', catalogTab: 'products', orders: [], products: [], categories: [], ingredients: [], subscriptions: [], selectedDate: null, from: null, through: null, user: null };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const prettyDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const toast = (message, error = false) => { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.hidden = true, 4000); };

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: response.status });
  return data;
}

function showLogin() { $('#login').hidden = false; $('#workspace').hidden = true; }
function showWorkspace() { $('#login').hidden = true; $('#workspace').hidden = false; $('#staff-name').textContent = state.user?.displayName || state.user?.email || 'Staff'; $('#today-label').textContent = prettyDate(today()); }

async function refresh() {
  const from = state.from || today();
  const through = state.through || addDays(from, 34);
  const [orders, products, categories, ingredients, subscriptions] = await Promise.all([
    api(`/api/v1/staff/orders?from=${from}&through=${through}`), api('/api/v1/staff/products'),
    api('/api/v1/staff/categories'),
    api('/api/v1/staff/ingredients'), api('/api/v1/staff/subscriptions')
  ]);
  Object.assign(state, { orders: orders.orders, products: products.products, categories: categories.categories, ingredients: ingredients.ingredients, subscriptions: subscriptions.subscriptions });
  render();
}

async function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $('#page-title').textContent = ({ dashboard: 'Dashboard', orders: 'Orders', subscriptions: 'Subscriptions', catalog: 'Catalog' })[view];
  if (view === 'dashboard' && state.from) { state.from = null; state.through = null; state.selectedDate = today(); await refresh(); }
  else render();
}

function statusBadge(status) { return `<span class="badge ${esc(status)}">${esc(status)}</span>`; }
function orderRow(order) {
  return `<div class="order-row"><div><strong>${esc(order.customerName)}</strong> ${statusBadge(order.status)}<p>${esc(prettyDate(order.fulfillmentDate))} · ${esc(order.fulfillmentMethod)} · ${money(order.totalCents)}${order.subscriptionId ? ' · Subscription' : ''}</p></div><div class="actions"><button class="button small" data-order="${esc(order.id)}">View</button></div></div>`;
}

function renderDashboard() {
  const date = state.selectedDate || today();
  const dayOrders = state.orders.filter(order => order.fulfillmentDate === date && order.status !== 'cancelled');
  const todayOrders = state.orders.filter(order => order.fulfillmentDate === today() && order.status !== 'cancelled');
  const due = todayOrders.filter(order => order.status !== 'fulfilled');
  const delivery = todayOrders.filter(order => order.fulfillmentMethod === 'delivery');
  const unpaid = todayOrders.filter(order => order.paymentStatus === 'unpaid');
  const start = addDays(today(), -new Date(`${today()}T00:00:00Z`).getUTCDay());
  const counts = new Map();
  state.orders.filter(order => order.status !== 'cancelled').forEach(order => counts.set(order.fulfillmentDate, (counts.get(order.fulfillmentDate) || 0) + 1));
  const calendar = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day => `<div class="weekday">${day}</div>`).join('') + Array.from({ length: 35 }, (_, index) => {
    const current = addDays(start, index);
    return `<button class="calendar-day ${current === today() ? 'today' : ''} ${current === date ? 'selected' : ''} ${current < today() ? 'outside' : ''}" data-date="${current}"><span class="number">${Number(current.slice(8))}</span><span class="count">${counts.get(current) ? `${counts.get(current)} order${counts.get(current) === 1 ? '' : 's'}` : ''}</span></button>`;
  }).join('');
  $('#view').innerHTML = `<div class="metrics"><div class="panel metric"><span>Today's orders</span><strong>${todayOrders.length}</strong><em>Scheduled for ${esc(prettyDate(today()))}</em></div><div class="panel metric"><span>Still in progress</span><strong>${due.length}</strong><em>Excludes fulfilled orders</em></div><div class="panel metric"><span>Deliveries</span><strong>${delivery.length}</strong><em>Today's route</em></div><div class="panel metric"><span>Unpaid</span><strong>${unpaid.length}</strong><em>Needs follow-up</em></div></div><div class="two-col"><div><div class="section-head"><div><h2>${date === today() ? "Today's orders" : `Orders for ${esc(prettyDate(date))}`}</h2><p>Open an order to see its products or update progress.</p></div><button class="button small" data-create="order">+ Order</button></div><div class="panel">${dayOrders.length ? dayOrders.map(orderRow).join('') : '<div class="empty">No orders scheduled for this day.</div>'}</div></div><div><div class="section-head"><div><h2>Upcoming calendar</h2><p>Select a day to see its kitchen work.</p></div></div><div class="panel panel-pad"><div class="calendar-grid">${calendar}</div></div></div></div>`;
}

function renderOrders() {
  $('#view').innerHTML = `<div class="section-head"><div><h2>Kitchen orders</h2><p>Manual orders and generated subscription occurrences.</p></div><button class="button primary" data-create="order">+ New order</button></div><div class="filters"><label>From<input id="orders-from" type="date" value="${esc(state.from || today())}"></label><label>Through<input id="orders-through" type="date" value="${esc(state.through || addDays(today(), 34))}"></label><button id="apply-dates" class="button">Apply</button></div><div class="panel table-wrap"><table class="data-table"><thead><tr><th>Fulfillment</th><th>Customer</th><th>Items / source</th><th>Total</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>${state.orders.length ? state.orders.map(order => `<tr><td>${esc(prettyDate(order.fulfillmentDate))}<small>${esc(order.fulfillmentMethod)}</small></td><td><strong>${esc(order.customerName)}</strong><small>${esc(order.customerPhone || order.customerEmail || '')}</small></td><td>${order.subscriptionId ? 'Subscription' : esc(order.source)}</td><td>${money(order.totalCents)}</td><td><select class="status-select" data-order-status="${esc(order.id)}">${['new','confirmed','preparing','ready','fulfilled','cancelled'].map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></td><td>${statusBadge(order.paymentStatus)}</td><td><button class="button small" data-order="${esc(order.id)}">View</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">No orders in this date range.</td></tr>'}</tbody></table></div>`;
}

function renderSubscriptions() {
  $('#view').innerHTML = `<div class="section-head"><div><h2>Recurring orders</h2><p>Change a subscription to update future new orders.</p></div><button class="button primary" data-create="subscription">+ New subscription</button></div><div class="panel table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Schedule</th><th>Fulfillment</th><th>Status</th><th></th></tr></thead><tbody>${state.subscriptions.length ? state.subscriptions.map(sub => `<tr><td><strong>${esc(sub.customerName)}</strong><small>${esc(sub.customerPhone || sub.customerEmail || '')}</small></td><td>${esc(sub.cadence)} from ${esc(prettyDate(sub.startDate))}${sub.endDate ? `<small>Ends ${esc(prettyDate(sub.endDate))}</small>` : ''}</td><td>${esc(sub.fulfillmentMethod)}</td><td>${statusBadge(sub.status)}</td><td><button class="button small" data-subscription="${esc(sub.id)}">Edit</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">No subscriptions yet.</td></tr>'}</tbody></table></div>`;
}

function renderCatalog() {
  const ingredients = state.catalogTab === 'ingredients';
  const rows = ingredients
    ? `<thead><tr><th>Ingredient</th><th>Serving</th><th>Protein</th><th>Carbs</th><th>Fat</th><th></th></tr></thead><tbody>${state.ingredients.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.allergens || '')}</small></td><td>${esc(item.servingSize)} ${esc(item.servingUnit)}</td><td>${esc(item.proteinG ?? '—')} g</td><td>${esc(item.carbsG ?? '—')} g</td><td>${esc(item.fatG ?? '—')} g</td><td><button class="button small" data-ingredient="${esc(item.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No ingredients yet.</td></tr>'}</tbody>`
    : `<thead><tr><th>Product</th><th>Category</th><th>Kind</th><th>One-time</th><th>Weekly</th><th></th></tr></thead><tbody>${state.products.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.description || '')}</small></td><td>${esc(item.categoryName || 'Uncategorized')}</td><td>${statusBadge(item.kind)}</td><td>${money(item.priceCents)}</td><td>${item.weeklyPriceCents === null ? '—' : money(item.weeklyPriceCents)}</td><td><button class="button small" data-product="${esc(item.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No products yet.</td></tr>'}</tbody>`;
  $('#view').innerHTML = `<div class="section-head"><div><h2>Menu catalog</h2><p>Products can include ingredients; combos contain products.</p></div><button class="button primary" data-create="${ingredients ? 'ingredient' : 'product'}">+ New ${ingredients ? 'ingredient' : 'product'}</button></div><div class="catalog-tabs"><button class="button ${!ingredients ? 'active' : ''}" data-catalog="products">Products & combos</button><button class="button ${ingredients ? 'active' : ''}" data-catalog="ingredients">Ingredients</button></div><div class="panel table-wrap"><table class="data-table">${rows}</table></div>`;
}

function render() { ({ dashboard: renderDashboard, orders: renderOrders, subscriptions: renderSubscriptions, catalog: renderCatalog })[state.view](); }

function openEditor(title, html) { $('#editor-title').textContent = title; $('#editor-body').innerHTML = `<div class="dialog-content">${html}</div>`; if (!$('#editor').open) $('#editor').showModal(); }
function closeEditor() { $('#editor').close(); }
function productOptions(selected = '') { return `<option value="">Select product</option>` + state.products.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)} · ${money(item.priceCents)}</option>`).join(''); }
function ingredientOptions(selected = '') { return `<option value="">Select ingredient</option>` + state.ingredients.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join(''); }
function itemLine(item = {}) { return `<div class="item-line"><select class="item-product" required>${productOptions(item.productId)}</select><input class="item-quantity" type="number" min="1" max="1000" value="${esc(item.quantity || 1)}" required aria-label="Quantity"><button type="button" data-remove-row aria-label="Remove product">×</button></div>`; }

function openOrderForm(kind = 'order', record = null) {
  const sub = kind === 'subscription';
  const values = record || {};
  const rows = values.items?.length ? values.items : [{}];
  const html = `<form id="order-form" data-kind="${kind}" data-id="${esc(values.id || '')}"><div class="form-grid"><label>Customer name<input name="customerName" value="${esc(values.customerName || '')}" required maxlength="120"></label><label>Phone<input name="customerPhone" value="${esc(values.customerPhone || '')}" maxlength="40"></label><label>Email<input name="customerEmail" type="email" value="${esc(values.customerEmail || '')}" maxlength="254"></label><label>Fulfillment<select name="fulfillmentMethod"><option value="pickup" ${values.fulfillmentMethod === 'pickup' ? 'selected' : ''}>Pickup</option><option value="delivery" ${values.fulfillmentMethod === 'delivery' ? 'selected' : ''}>Delivery</option></select></label>${sub ? `<label>First date<input name="startDate" type="date" value="${esc(values.startDate || today())}" required></label><label>Cadence<select name="cadence"><option value="weekly" ${values.cadence === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${values.cadence === 'monthly' ? 'selected' : ''}>Monthly</option></select></label><label>End date (optional)<input name="endDate" type="date" value="${esc(values.endDate || '')}"></label><label>Status<select name="status"><option value="active" ${values.status === 'active' ? 'selected' : ''}>Active</option><option value="paused" ${values.status === 'paused' ? 'selected' : ''}>Paused</option><option value="cancelled" ${values.status === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></label>` : `<label>Fulfillment date<input name="fulfillmentDate" type="date" value="${esc(values.fulfillmentDate || state.selectedDate || today())}" required></label><label>Order source<select name="source">${['staff','phone','facebook','website','other'].map(source => `<option value="${source}" ${values.source === source ? 'selected' : ''}>${source}</option>`).join('')}</select></label>`}<label class="full">Kitchen notes<textarea name="notes" maxlength="2000">${esc(values.notes || '')}</textarea></label></div><div class="form-section"><h3>Products</h3><div id="order-lines">${rows.map(itemLine).join('')}</div><button type="button" class="button small" data-add-row="order">+ Add product</button></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">${record ? 'Save changes' : `Create ${kind}`}</button></div></form>`;
  openEditor(record ? `Edit ${kind}` : `New ${kind}`, html);
}

function openIngredientForm(item = null) {
  const value = item || {};
  const fields = [['calories','Calories'],['proteinG','Protein (g)'],['carbsG','Carbs (g)'],['fatG','Fat (g)'],['fiberG','Fiber (g)'],['sugarG','Sugar (g)'],['sodiumMg','Sodium (mg)']];
  const html = `<form id="ingredient-form" data-id="${esc(value.id || '')}"><div class="form-grid"><label class="full">Ingredient name<input name="name" value="${esc(value.name || '')}" required></label><label>Serving size<input name="servingSize" type="number" step="any" min="0.001" value="${esc(value.servingSize ?? 1)}" required></label><label>Serving unit<input name="servingUnit" value="${esc(value.servingUnit || 'serving')}" required></label>${fields.map(([key,label]) => `<label>${label}<input name="${key}" type="number" step="any" min="0" value="${esc(value[key] ?? '')}"></label>`).join('')}<label class="full">Allergens<input name="allergens" value="${esc(value.allergens || '')}" placeholder="e.g. milk, soy"></label><label class="full">Notes<textarea name="notes">${esc(value.notes || '')}</textarea></label></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit">Save ingredient</button></div></form>`;
  openEditor(item ? 'Edit ingredient' : 'New ingredient', html);
}

function relationLine(kind, value = {}) {
  if (kind === 'combo') return `<div class="item-line"><select class="relation-id" required><option value="">Select product</option>${state.products.filter(item => item.active && item.kind === 'individual').map(item => `<option value="${esc(item.id)}" ${item.id === value.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><input class="relation-quantity" type="number" min="1" max="1000" value="${esc(value.quantity || 1)}" aria-label="Quantity"><button type="button" data-remove-row>×</button></div>`;
  return `<div class="item-line"><select class="relation-id" required>${ingredientOptions(value.id)}</select><input class="relation-quantity" type="number" step="any" min="0.001" value="${esc(value.servings || 1)}" aria-label="Servings"><button type="button" data-remove-row>×</button></div>`;
}

function openProductForm(product = null) {
  const value = product || {};
  const kind = value.kind || 'individual';
  const relations = kind === 'combo' ? value.components || [{}] : value.ingredients || [];
  const categories = `<option value="">Uncategorized</option>` + state.categories.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${value.categoryId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const html = `<form id="product-form" data-id="${esc(value.id || '')}"><div class="form-grid"><label class="full">Product name<input name="name" value="${esc(value.name || '')}" required></label><label>One-time price ($)<input name="price" type="number" step="0.01" min="0" max="10000" value="${value.priceCents === undefined ? '' : esc((value.priceCents / 100).toFixed(2))}" required></label><label>Weekly price ($, optional)<input name="weeklyPrice" type="number" step="0.01" min="0" max="10000" value="${value.weeklyPriceCents === null || value.weeklyPriceCents === undefined ? '' : esc((value.weeklyPriceCents / 100).toFixed(2))}"></label><label>Category<select name="categoryId">${categories}</select></label><label>Kind<select name="kind"><option value="individual" ${kind === 'individual' ? 'selected' : ''}>Individual product</option><option value="combo" ${kind === 'combo' ? 'selected' : ''}>Combo</option></select></label><label class="full">Description<textarea name="description">${esc(value.description || '')}</textarea></label></div><div class="form-section"><h3 id="relation-title">${kind === 'combo' ? 'Products in combo' : 'Ingredients (optional)'}</h3><div id="relations">${relations.map(row => relationLine(kind, row)).join('')}</div><button type="button" class="button small" data-add-row="relation">+ Add ${kind === 'combo' ? 'product' : 'ingredient'}</button></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit">Save product</button></div></form>`;
  openEditor(product ? 'Edit product' : 'New product', html);
}

async function openOrder(id) {
  const { order } = await api(`/api/v1/staff/orders/${id}`);
  const items = order.items.map(item => `<div class="order-row"><div><strong>${esc(item.productName)}</strong><p>${item.quantity} × ${money(item.unitPriceCents)}${item.components?.length ? `<br>Includes: ${item.components.map(component => `${component.quantity} × ${esc(component.productName)}`).join(', ')}` : ''}</p></div><strong>${money(item.lineTotalCents)}</strong></div>`).join('');
  const html = `<div class="notice">${esc(prettyDate(order.fulfillmentDate))} · ${esc(order.fulfillmentMethod)}${order.subscriptionId ? ' · Recurring order' : ''}</div><div class="form-grid"><div><span class="eyebrow">CUSTOMER</span><p><strong>${esc(order.customerName)}</strong><br>${esc(order.customerPhone || '')}<br>${esc(order.customerEmail || '')}</p></div><div><span class="eyebrow">PROGRESS</span><p>${statusBadge(order.status)} ${statusBadge(order.paymentStatus)}<br>${money(order.totalCents)}</p></div></div><div class="form-section"><h3>Products</h3><div class="panel">${items}</div></div>${order.notes ? `<div class="form-section"><h3>Kitchen notes</h3><p>${esc(order.notes)}</p></div>` : ''}<div class="form-section form-grid"><label>Order status<select id="detail-status">${['new','confirmed','preparing','ready','fulfilled','cancelled'].map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Payment status<select id="detail-payment"><option value="unpaid" ${order.paymentStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option><option value="paid" ${order.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option><option value="refunded" ${order.paymentStatus === 'refunded' ? 'selected' : ''}>Refunded</option></select></label></div><div class="form-actions"><button class="button" data-edit-order="${esc(order.id)}">Edit products & details</button><button class="button primary" data-save-order="${esc(order.id)}">Save status</button></div>`;
  openEditor(`Order · ${order.customerName}`, html);
}

function formValue(form, key) { return new FormData(form).get(key)?.toString().trim() || null; }
function readOrderForm(form) {
  const items = Array.from(form.querySelectorAll('#order-lines .item-line')).map(row => ({ productId: row.querySelector('.item-product').value, quantity: Number(row.querySelector('.item-quantity').value) }));
  if (!items.length || items.some(item => !item.productId)) throw new Error('Add at least one product');
  const value = { customerName: formValue(form,'customerName'), customerPhone: formValue(form,'customerPhone'), customerEmail: formValue(form,'customerEmail'), fulfillmentMethod: formValue(form,'fulfillmentMethod'), notes: formValue(form,'notes'), items };
  return form.dataset.kind === 'subscription' ? { ...value, startDate: formValue(form,'startDate'), endDate: formValue(form,'endDate'), cadence: formValue(form,'cadence'), status: formValue(form,'status') } : { ...value, fulfillmentDate: formValue(form,'fulfillmentDate'), source: formValue(form,'source') };
}

async function submitEditor(event) {
  event.preventDefault();
  const form = event.target;
  const id = form.dataset.id;
  let path, data;
  if (form.id === 'order-form') {
    const subscription = form.dataset.kind === 'subscription';
    path = `/api/v1/staff/${subscription ? 'subscriptions' : 'orders'}${id ? `/${id}` : ''}`;
    data = readOrderForm(form);
  } else if (form.id === 'ingredient-form') {
    path = `/api/v1/staff/ingredients${id ? `/${id}` : ''}`;
    data = Object.fromEntries(new FormData(form));
    for (const key of ['servingSize','calories','proteinG','carbsG','fatG','fiberG','sugarG','sodiumMg']) data[key] = data[key] === '' ? null : Number(data[key]);
  } else if (form.id === 'product-form') {
    path = `/api/v1/staff/products${id ? `/${id}` : ''}`;
    const kind = formValue(form,'kind');
    const priceCents = Math.round(Number(formValue(form,'price')) * 100);
    const weeklyPrice = formValue(form,'weeklyPrice');
    const weeklyPriceCents = weeklyPrice === null ? null : Math.round(Number(weeklyPrice) * 100);
    const relations = Array.from(form.querySelectorAll('#relations .item-line')).map(row => ({ id: row.querySelector('.relation-id').value, value: Number(row.querySelector('.relation-quantity').value) }));
    if (relations.some(row => !row.id)) throw new Error('Select each ingredient or component');
    data = { name: formValue(form,'name'), priceCents, weeklyPriceCents, categoryId: formValue(form,'categoryId'), kind, description: formValue(form,'description'), ingredients: kind === 'individual' ? relations.map(row => ({ id: row.id, servings: row.value })) : [], components: kind === 'combo' ? relations.map(row => ({ id: row.id, quantity: row.value })) : [] };
  } else return;
  await api(path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
  closeEditor();
  toast('Saved successfully');
  await refresh();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  try {
    if (target.dataset.view) await setView(target.dataset.view);
    if (target.dataset.date) { state.selectedDate = target.dataset.date; renderDashboard(); }
    if (target.dataset.catalog) { state.catalogTab = target.dataset.catalog; renderCatalog(); }
    if (target.dataset.create) { const kind = target.dataset.create; if (kind === 'ingredient') openIngredientForm(); else if (kind === 'product') openProductForm(); else openOrderForm(kind); }
    if (target.dataset.removeRow !== undefined) target.closest('.item-line').remove();
    if (target.dataset.addRow === 'order') $('#order-lines').insertAdjacentHTML('beforeend', itemLine());
    if (target.dataset.addRow === 'relation') $('#relations').insertAdjacentHTML('beforeend', relationLine(formValue($('#product-form'),'kind') === 'combo' ? 'combo' : 'individual'));
    if (target.dataset.order) await openOrder(target.dataset.order);
    if (target.dataset.subscription) { const { subscription } = await api(`/api/v1/staff/subscriptions/${target.dataset.subscription}`); openOrderForm('subscription', subscription); }
    if (target.dataset.ingredient) openIngredientForm(state.ingredients.find(item => item.id === target.dataset.ingredient));
    if (target.dataset.product) { const { product } = await api(`/api/v1/staff/products/${target.dataset.product}`); openProductForm(product); }
    if (target.dataset.editOrder) {
      const { order } = await api(`/api/v1/staff/orders/${target.dataset.editOrder}`);
      closeEditor();
      openOrderForm('order', { ...order, items: order.items.map(item => ({ productId: item.productId, quantity: item.quantity })) });
    }
    if (target.dataset.saveOrder) {
      await api(`/api/v1/staff/orders/${target.dataset.saveOrder}`, { method: 'PATCH', body: JSON.stringify({ status: $('#detail-status').value, paymentStatus: $('#detail-payment').value }) });
      closeEditor(); toast('Order updated'); await refresh();
    }
    if (target.dataset.close !== undefined) closeEditor();
    if (target.id === 'close-editor') closeEditor();
    if (target.id === 'apply-dates') { state.from = $('#orders-from').value; state.through = $('#orders-through').value; await refresh(); }
    if (target.id === 'create-button') openEditor('Create new', `<div class="form-grid"><button class="button" data-create="order">New order</button><button class="button" data-create="subscription">New subscription</button></div>`);
    if (target.id === 'logout') { await api('/api/v1/auth/logout', { method: 'POST' }); state.user = null; showLogin(); }
  } catch (error) { toast(error.message, true); }
});

$('#editor').addEventListener('submit', event => { submitEditor(event).catch(error => toast(error.message, true)); });
$('#editor').addEventListener('change', event => {
  if (event.target.name === 'kind') {
    const kind = event.target.value;
    $('#relations').innerHTML = kind === 'combo' ? relationLine('combo') : '';
    $('#relation-title').textContent = kind === 'combo' ? 'Products in combo' : 'Ingredients (optional)';
    $('[data-add-row="relation"]').textContent = `+ Add ${kind === 'combo' ? 'product' : 'ingredient'}`;
  }
});
$('#view').addEventListener('change', async event => {
  const id = event.target.dataset.orderStatus;
  if (!id) return;
  try { await api(`/api/v1/staff/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: event.target.value }) }); toast('Order status updated'); await refresh(); }
  catch (error) { toast(error.message, true); }
});
$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = Object.fromEntries(new FormData(event.target));
    const result = await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(data) });
    state.user = result.user; showWorkspace(); await refresh(); event.target.reset();
  } catch (error) { $('#login-error').textContent = error.message; }
});

(async () => {
  try { const { user } = await api('/api/v1/auth/me'); state.user = user; showWorkspace(); await refresh(); }
  catch { showLogin(); }
})();
