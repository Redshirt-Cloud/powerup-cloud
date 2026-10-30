const state = { view: 'dashboard', catalogTab: 'products', orders: [], products: [], categories: [], variationGroups: [], productDetails: new Map(), ingredients: [], subscriptions: [], selectedDate: null, from: null, through: null, user: null };
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents ?? 0) / 100);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date, days) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const prettyDate = date => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const toast = (message, error = false) => { const node = $('#toast'); node.textContent = message; node.classList.toggle('error', error); node.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.hidden = true, 4000); };
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('powerup-cloud-theme', theme);
  document.querySelectorAll('[data-theme-toggle]').forEach(button => { button.textContent = theme === 'dark' ? 'Light mode' : 'Dark mode'; button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false'); });
}
setTheme(localStorage.getItem('powerup-cloud-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

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
  const [orders, products, categories, variationGroups, ingredients, subscriptions] = await Promise.all([
    api(`/api/v1/staff/orders?from=${from}&through=${through}`), api('/api/v1/staff/products'),
    api('/api/v1/staff/categories'),
    api('/api/v1/staff/variation-groups'),
    api('/api/v1/staff/ingredients'), api('/api/v1/staff/subscriptions')
  ]);
  Object.assign(state, { orders: orders.orders, products: products.products, categories: categories.categories, variationGroups: variationGroups.groups, ingredients: ingredients.ingredients, subscriptions: subscriptions.subscriptions });
  state.productDetails.clear();
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
  const tab = state.catalogTab;
  const tabs = [['products','Products'],['ingredients','Ingredients'],['options','Option groups']].map(([key,label]) => `<button class="button ${tab === key ? 'active' : ''}" data-catalog="${key}">${label}</button>`).join('');
  const action = tab === 'ingredients' ? ['ingredient','ingredient'] : tab === 'options' ? ['variation-group','option group'] : ['product','product'];
  let rows;
  if (tab === 'ingredients') {
    rows = `<thead><tr><th>Ingredient</th><th>Serving</th><th>Protein</th><th>Carbs</th><th>Fat</th><th></th></tr></thead><tbody>${state.ingredients.map(item => `<tr><td><strong>${esc(item.name)}</strong><small>${esc(item.allergens || '')}</small></td><td>${esc(item.servingSize)} ${esc(item.servingUnit)}</td><td>${esc(item.proteinG ?? '—')} g</td><td>${esc(item.carbsG ?? '—')} g</td><td>${esc(item.fatG ?? '—')} g</td><td><button class="button small" data-ingredient="${esc(item.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">No ingredients yet.</td></tr>'}</tbody>`;
  } else if (tab === 'options') {
    rows = `<thead><tr><th>Option group</th><th>Type</th><th>Choices</th><th></th></tr></thead><tbody>${state.variationGroups.map(group => `<tr><td><strong>${esc(group.name)}</strong></td><td>${esc(group.selectionType)}</td><td>${group.options.filter(option => option.active).length}</td><td><button class="button small" data-group="${esc(group.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No option groups yet.</td></tr>'}</tbody>`;
  } else {
    rows = `<thead><tr><th>Product</th><th>Category</th><th>One-time</th><th>Weekly</th><th></th></tr></thead><tbody>${state.products.map(item => `<tr><td><div class="catalog-product">${item.imageUrl ? `<img src="${esc(item.imageUrl)}" alt="" loading="lazy">` : '<span class="catalog-placeholder">P+</span>'}<span><strong>${esc(item.name)}</strong><small>${esc(item.sku || item.description || '')}</small></span></div></td><td>${esc(item.categoryName || 'Uncategorized')}</td><td>${money(item.priceCents)}</td><td>${item.weeklyPriceCents === null ? '—' : money(item.weeklyPriceCents)}</td><td><button class="button small" data-product="${esc(item.id)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No products yet.</td></tr>'}</tbody>`;
  }
  $('#view').innerHTML = `<div class="section-head"><div><h2>Menu catalog</h2><p>Products, ingredients, and reusable option groups.</p></div><button class="button primary" data-create="${action[0]}">+ New ${action[1]}</button></div><div class="catalog-tabs">${tabs}</div><div class="panel table-wrap"><table class="data-table">${rows}</table></div>`;
}

function render() { ({ dashboard: renderDashboard, orders: renderOrders, subscriptions: renderSubscriptions, catalog: renderCatalog })[state.view](); }

function openEditor(title, html, wide = false) { $('#editor-title').textContent = title; $('#editor-body').innerHTML = `<div class="dialog-content">${html}</div>`; $('#editor').classList.toggle('wide-editor', wide); if (!$('#editor').open) $('#editor').showModal(); }
function closeEditor() { $('#editor').close(); $('#editor').classList.remove('wide-editor'); }
function productOptions(selected = '') { return `<option value="">Select product</option>` + state.products.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)} · ${money(item.priceCents)}</option>`).join(''); }
function ingredientOptions(selected = '') { return `<option value="">Select ingredient</option>` + state.ingredients.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)}</option>`).join(''); }
function itemLine(item = {}) { return `<div class="item-line order-item-line"><select class="item-product" required>${productOptions(item.productId)}</select><input class="item-quantity" type="number" min="1" max="1000" value="${esc(item.quantity || 1)}" required aria-label="Quantity"><button type="button" data-remove-row aria-label="Remove product">×</button><div class="item-variations"></div><small class="item-price-preview"></small></div>`; }

async function productDetail(id) {
  if (!state.productDetails.has(id)) state.productDetails.set(id, api(`/api/v1/staff/products/${id}`).then(result => result.product));
  return state.productDetails.get(id);
}

function updateOrderPreview() {
  const form = $('#order-form');
  if (!form) return;
  let total = 0;
  for (const row of form.querySelectorAll('.order-item-line')) {
    const product = state.products.find(item => item.id === row.querySelector('.item-product').value);
    if (!product) continue;
    let price = product.priceCents;
    for (const choice of row.querySelectorAll('.order-choice')) {
      if (choice.tagName === 'SELECT') price += Number(choice.selectedOptions[0]?.dataset.price || 0);
      else for (const option of choice.querySelectorAll('input:checked')) price += Number(option.dataset.price || 0);
    }
    row.querySelector('.item-price-preview').textContent = `${money(price)} each`;
    total += price * Number(row.querySelector('.item-quantity').value || 0);
  }
  $('#order-total-preview').textContent = `Estimated total: ${money(total)}`;
}

async function hydrateOrderLine(row, selections = {}) {
  const productId = row.querySelector('.item-product').value;
  const container = row.querySelector('.item-variations');
  container.innerHTML = '';
  if (!productId) { updateOrderPreview(); return; }
  const product = await productDetail(productId);
  if (row.querySelector('.item-product').value !== productId) return;
  container.innerHTML = product.variations.map(group => {
    const chosen = selections[group.groupId] || group.options.filter(option => option.isDefault).map(option => option.id);
    if (group.selectionType === 'multiple') return `<fieldset class="order-choice" data-group-id="${esc(group.groupId)}"><legend>${esc(group.name)}</legend>${group.options.map(option => `<label><input type="checkbox" value="${esc(option.id)}" data-price="${option.priceCents}" ${chosen.includes(option.id) ? 'checked' : ''}>${esc(option.label)}${option.priceCents ? ` +${money(option.priceCents)}` : ''}</label>`).join('')}</fieldset>`;
    return `<label>${esc(group.name)}<select class="order-choice" data-group-id="${esc(group.groupId)}" ${group.minRequired ? 'required' : ''}><option value="" data-price="0">${group.minRequired ? 'Choose an option' : 'None'}</option>${group.options.map(option => `<option value="${esc(option.id)}" data-price="${option.priceCents}" ${chosen.includes(option.id) ? 'selected' : ''}>${esc(option.label)}${option.priceCents ? ` +${money(option.priceCents)}` : ''}</option>`).join('')}</select></label>`;
  }).join('');
  updateOrderPreview();
}

function openOrderForm(kind = 'order', record = null) {
  const sub = kind === 'subscription';
  const values = record || {};
  const rows = values.items?.length ? values.items : [{}];
  const html = `<form id="order-form" data-kind="${kind}" data-id="${esc(values.id || '')}"><div class="form-grid"><label>Customer name<input name="customerName" value="${esc(values.customerName || '')}" required maxlength="120"></label><label>Phone<input name="customerPhone" value="${esc(values.customerPhone || '')}" maxlength="40"></label><label>Email<input name="customerEmail" type="email" value="${esc(values.customerEmail || '')}" maxlength="254"></label><label>Fulfillment<select name="fulfillmentMethod"><option value="pickup" ${values.fulfillmentMethod === 'pickup' ? 'selected' : ''}>Pickup</option><option value="delivery" ${values.fulfillmentMethod === 'delivery' ? 'selected' : ''}>Delivery</option></select></label>${sub ? `<label>First date<input name="startDate" type="date" value="${esc(values.startDate || today())}" required></label><label>Cadence<select name="cadence"><option value="weekly" ${values.cadence === 'weekly' ? 'selected' : ''}>Weekly</option><option value="monthly" ${values.cadence === 'monthly' ? 'selected' : ''}>Monthly</option></select></label><label>End date (optional)<input name="endDate" type="date" value="${esc(values.endDate || '')}"></label><label>Status<select name="status"><option value="active" ${values.status === 'active' ? 'selected' : ''}>Active</option><option value="paused" ${values.status === 'paused' ? 'selected' : ''}>Paused</option><option value="cancelled" ${values.status === 'cancelled' ? 'selected' : ''}>Cancelled</option></select></label>` : `<label>Fulfillment date<input name="fulfillmentDate" type="date" value="${esc(values.fulfillmentDate || state.selectedDate || today())}" required></label><label>Order source<select name="source">${['staff','phone','facebook','website','other'].map(source => `<option value="${source}" ${values.source === source ? 'selected' : ''}>${source}</option>`).join('')}</select></label>`}<label class="full">Kitchen notes<textarea name="notes" maxlength="2000">${esc(values.notes || '')}</textarea></label></div><div class="form-section"><h3>Products</h3><div id="order-lines">${rows.map(itemLine).join('')}</div><button type="button" class="button small" data-add-row="order">+ Add product</button><p id="order-total-preview" class="order-total-preview"></p></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button type="submit" class="button primary">${record ? 'Save changes' : `Create ${kind}`}</button></div></form>`;
  openEditor(record ? `Edit ${kind}` : `New ${kind}`, html);
  Array.from($('#order-lines').children).forEach((row, index) => hydrateOrderLine(row, rows[index].selections || {}).catch(error => toast(error.message, true)));
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

function nutritionFields(nutrition) {
  if (!nutrition) return {};
  if (!nutrition.nutritionLabel) return nutrition;
  const keys = { 'Serving Size':'servingSize', 'Calories':'calories', 'Total Fat (g)':'totalFatG', 'Sat Fat (g)':'saturatedFatG', 'Trans Fat (g)':'transFatG', 'Cholesterol (mg)':'cholesterolMg', 'Sodium (mg)':'sodiumMg', 'Total Carbs (g)':'carbsG', 'Dietary Fiber (g)':'fiberG', 'Total Sugars (g)':'sugarG', 'Added Sugars (g)':'addedSugarG', 'Protein (g)':'proteinG', 'Vitamin D (mcg)':'vitaminDmcg', 'Calcium (mg)':'calciumMg', 'Iron (mg)':'ironMg', 'Potassium (mg)':'potassiumMg' };
  return Object.fromEntries((nutrition.nutritionLabel.data || []).map(row => [keys[row[0]?.value], row[1]?.value]).filter(([key,value]) => key && value));
}

const nutritionLabels = [['servingSize','Serving size'],['calories','Calories'],['totalFatG','Total fat (g)'],['saturatedFatG','Saturated fat (g)'],['transFatG','Trans fat (g)'],['cholesterolMg','Cholesterol (mg)'],['sodiumMg','Sodium (mg)'],['carbsG','Carbs (g)'],['fiberG','Fiber (g)'],['sugarG','Total sugars (g)'],['addedSugarG','Added sugars (g)'],['proteinG','Protein (g)'],['vitaminDmcg','Vitamin D (mcg)'],['calciumMg','Calcium (mg)'],['ironMg','Iron (mg)'],['potassiumMg','Potassium (mg)'],['ingredients','Ingredients'],['contains','Contains']];

function variationCard(value) {
  const group = state.variationGroups.find(item => item.id === value.groupId);
  if (!group) return '';
  const selected = new Map((value.options || []).map(option => [option.id,option]));
  const options = group.options.filter(option => option.active || selected.has(option.id)).map(option => {
    const current = selected.get(option.id);
    const price = current?.priceCents ?? option.basePriceCents;
    return `<div class="variation-option" data-option-id="${esc(option.id)}"><label><input class="variation-enabled" type="checkbox" ${current ? 'checked' : ''}> ${esc(option.label)}</label><label>Price add ($)<input class="variation-price" type="number" min="0" step="0.01" value="${esc((price / 100).toFixed(2))}"></label><label>Default<input class="variation-default" type="${group.selectionType === 'multiple' ? 'checkbox' : 'radio'}" name="default-${esc(group.id)}" ${current?.isDefault ? 'checked' : ''}></label></div>`;
  }).join('');
  const noDefault = group.selectionType === 'single' ? `<label class="no-default"><input type="radio" name="default-${esc(group.id)}" ${!(value.options || []).some(option => option.isDefault) ? 'checked' : ''}> No default choice</label>` : '';
  return `<section class="variation-card" data-group-id="${esc(group.id)}"><div class="variation-card-head"><div><strong>${esc(group.name)}</strong><small>${group.selectionType === 'single' ? 'Choose one' : 'Choose multiple'}</small></div><button type="button" class="button small danger" data-remove-group="${esc(group.id)}">Remove group</button></div><div class="variation-limits"><label>Minimum<input class="variation-min" type="number" min="0" max="100" value="${esc(value.minRequired ?? 0)}"></label><label>Maximum<input class="variation-max" type="number" min="1" max="100" value="${esc(value.maxAllowed ?? 1)}"></label></div>${noDefault}<div class="variation-options">${options}</div></section>`;
}

function openProductForm(product = null) {
  const value = product || {};
  const details = value.details || {};
  const nutrition = nutritionFields(details.nutrition);
  const kind = value.kind || 'individual';
  const relations = kind === 'combo' ? value.components || [{}] : value.ingredients || [];
  const categories = `<option value="">Uncategorized</option>` + state.categories.filter(item => item.active).map(item => `<option value="${esc(item.id)}" ${value.categoryId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('');
  const flags = [['taxable','Taxable'],['shippingExempt','Shipping exempt'],['excludeDiscounts','Exclude from discounts'],['visibleOnline','Visible online'],['visibleFoh','Visible in front of house'],['ghostVisible','Visible when ghosting'],['featured','Featured product'],['publishOnSave','Publish on save'],['preorderEnabled','Pre-order availability']];
  const flagHtml = flags.map(([key,label]) => `<label class="toggle-row"><span>${label}</span><input name="${key}" type="checkbox" ${details[key] || (key === 'publishOnSave' && details[key] === undefined) ? 'checked' : ''}></label>`).join('');
  const nutritionHtml = nutritionLabels.map(([key,label]) => `<label>${label}<input name="nutrition-${key}" value="${esc(nutrition[key] ?? '')}" ${['servingSize','ingredients','contains'].includes(key) ? '' : 'inputmode="decimal"'}></label>`).join('');
  const images = (value.images || []).map(image => `<div class="product-image"><img src="${esc(image.url)}" alt="${esc(value.name || 'Product photo')}"><button type="button" class="button small danger" data-delete-image="${esc(image.id)}">Remove</button></div>`).join('');
  const groupChoices = state.variationGroups.filter(group => group.active && !(value.variations || []).some(item => item.groupId === group.id)).map(group => `<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('');
  const html = `<form id="product-form" data-id="${esc(value.id || '')}"><div class="product-layout"><div class="product-main"><section class="editor-section"><h3>Product details</h3><div class="form-grid"><label class="full">Name<input name="name" value="${esc(value.name || '')}" required maxlength="160"></label><label>SKU<input name="sku" value="${esc(details.sku || '')}" maxlength="80"></label><label>Category<select name="categoryId">${categories}</select></label><label>One-time price ($)<input name="price" type="number" step="0.01" min="0" max="10000" value="${value.priceCents === undefined ? '' : esc((value.priceCents / 100).toFixed(2))}" required></label><label>Weekly price ($, optional)<input name="weeklyPrice" type="number" step="0.01" min="0" max="10000" value="${value.weeklyPriceCents == null ? '' : esc((value.weeklyPriceCents / 100).toFixed(2))}"></label><label>Kind<select name="kind"><option value="individual" ${kind === 'individual' ? 'selected' : ''}>Individual product</option><option value="combo" ${kind === 'combo' ? 'selected' : ''}>Fixed combo</option></select></label><label class="full">Description<textarea name="description" maxlength="1000">${esc(value.description || '')}</textarea></label><label class="full">Optional specifications<textarea name="specifications" maxlength="4000">${esc(details.specifications || '')}</textarea></label></div></section><section class="editor-section"><h3>Images</h3><div class="product-images">${images || '<p class="muted">No images uploaded.</p>'}</div><label class="file-label">Add photos (JPEG, PNG, WebP; 5 MB each)<input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label></section><section class="editor-section"><h3>Variation picker</h3><p class="muted">Shared option groups can have different enabled choices and prices on each product.</p><div id="product-variations">${(value.variations || []).map(variationCard).join('')}</div><div class="inline-actions"><select id="add-variation-group"><option value="">Select option group</option>${groupChoices}</select><button type="button" class="button small" data-add-group>Add group</button></div></section><section class="editor-section"><h3 id="relation-title">${kind === 'combo' ? 'Fixed combo products' : 'Ingredients (optional)'}</h3><div id="relations">${relations.map(row => relationLine(kind, row)).join('')}</div><button type="button" class="button small" data-add-row="relation">+ Add ${kind === 'combo' ? 'product' : 'ingredient'}</button></section><section class="editor-section"><h3>Nutrition label</h3><p class="muted">Values from the legacy label are a starting point; review before publishing nutrition claims.</p><div class="form-grid nutrition-grid">${nutritionHtml}</div></section></div><aside class="product-aside"><section class="editor-section"><h3>Publication & sales</h3>${flagHtml}<label>End date<input name="activeUntil" type="date" value="${esc(details.activeUntil || '')}"></label></section><section class="editor-section"><h3>Organization</h3><label>Tags (comma separated)<input name="tags" value="${esc((details.tags || []).join(', '))}"></label><label>Backup product<select name="backupProductId"><option value="">None</option>${state.products.filter(item => item.id !== value.id).map(item => `<option value="${esc(item.id)}" ${details.backupProductId === item.id ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label></section></aside></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit">Save product</button></div></form>`;
  openEditor(product ? `Edit ${value.name}` : 'New product', html, true);
}

function optionTemplateLine(option = {}) {
  return `<div class="template-option" data-option-id="${esc(option.id || '')}"><input class="template-label" placeholder="Choice name" value="${esc(option.label || '')}" required><input class="template-sku" placeholder="SKU" value="${esc(option.sku || '')}"><input class="template-price" type="number" min="0" step="0.01" value="${esc(((option.basePriceCents ?? 0) / 100).toFixed(2))}" aria-label="Default price add"><button type="button" data-remove-template-option class="button small danger">Remove</button></div>`;
}

function openVariationGroupForm(group = null) {
  const value = group || {};
  const html = `<form id="variation-group-form" data-id="${esc(value.id || '')}"><div class="form-grid"><label>Group name<input name="name" value="${esc(value.name || '')}" required maxlength="120"></label><label>Selection type<select name="selectionType"><option value="single" ${value.selectionType !== 'multiple' ? 'selected' : ''}>Choose one</option><option value="multiple" ${value.selectionType === 'multiple' ? 'selected' : ''}>Choose multiple</option></select></label></div><div class="form-section"><h3>Shared choices</h3><p class="muted">Changing a default price updates products without a custom price for that choice.</p><div id="template-options">${(value.options?.length ? value.options : [{}]).map(optionTemplateLine).join('')}</div><button type="button" class="button small" data-add-template-option>+ Add choice</button></div><div class="form-actions"><button type="button" class="button" data-close>Cancel</button><button class="button primary" type="submit">Save option group</button></div></form>`;
  openEditor(group ? `Edit ${group.name}` : 'New option group', html, true);
}

async function openOrder(id) {
  const { order } = await api(`/api/v1/staff/orders/${id}`);
  const items = order.items.map(item => `<div class="order-row"><div><strong>${esc(item.productName)}</strong><p>${item.quantity} × ${money(item.unitPriceCents)}${item.variations?.length ? `<br>${item.variations.map(choice => `${esc(choice.groupName)}: ${esc(choice.optionName)}`).join(' · ')}` : ''}${item.components?.length ? `<br>Includes: ${item.components.map(component => `${component.quantity} × ${esc(component.productName)}`).join(', ')}` : ''}</p></div><strong>${money(item.lineTotalCents)}</strong></div>`).join('');
  const html = `<div class="notice">${esc(prettyDate(order.fulfillmentDate))} · ${esc(order.fulfillmentMethod)}${order.subscriptionId ? ' · Recurring order' : ''}</div><div class="form-grid"><div><span class="eyebrow">CUSTOMER</span><p><strong>${esc(order.customerName)}</strong><br>${esc(order.customerPhone || '')}<br>${esc(order.customerEmail || '')}</p></div><div><span class="eyebrow">PROGRESS</span><p>${statusBadge(order.status)} ${statusBadge(order.paymentStatus)}<br>${money(order.totalCents)}</p></div></div><div class="form-section"><h3>Products</h3><div class="panel">${items}</div></div>${order.notes ? `<div class="form-section"><h3>Kitchen notes</h3><p>${esc(order.notes)}</p></div>` : ''}<div class="form-section form-grid"><label>Order status<select id="detail-status">${['new','confirmed','preparing','ready','fulfilled','cancelled'].map(status => `<option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><label>Payment status<select id="detail-payment"><option value="unpaid" ${order.paymentStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option><option value="paid" ${order.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option><option value="refunded" ${order.paymentStatus === 'refunded' ? 'selected' : ''}>Refunded</option></select></label></div><div class="form-actions"><button class="button" data-edit-order="${esc(order.id)}">Edit products & details</button><button class="button primary" data-save-order="${esc(order.id)}">Save status</button></div>`;
  openEditor(`Order · ${order.customerName}`, html);
}

function formValue(form, key) { return new FormData(form).get(key)?.toString().trim() || null; }
function readOrderForm(form) {
  const items = Array.from(form.querySelectorAll('#order-lines .order-item-line')).map(row => {
    const selections = Object.fromEntries(Array.from(row.querySelectorAll('.order-choice')).map(choice => [choice.dataset.groupId, choice.tagName === 'SELECT' ? (choice.value ? [choice.value] : []) : Array.from(choice.querySelectorAll('input:checked')).map(input => input.value)]));
    return { productId: row.querySelector('.item-product').value, quantity: Number(row.querySelector('.item-quantity').value), selections };
  });
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
    const flags = ['taxable','shippingExempt','excludeDiscounts','visibleOnline','visibleFoh','ghostVisible','featured','publishOnSave','preorderEnabled'];
    const details = Object.fromEntries(flags.map(key => [key,form.elements.namedItem(key).checked]));
    const nutrition = Object.fromEntries(nutritionLabels.map(([key]) => [key,formValue(form,`nutrition-${key}`)]).filter(([,value]) => value !== null));
    Object.assign(details, { sku: formValue(form,'sku'), specifications: formValue(form,'specifications'), activeUntil: formValue(form,'activeUntil'), backupProductId: formValue(form,'backupProductId'), tags: (formValue(form,'tags') || '').split(',').map(tag => tag.trim()).filter(Boolean), nutrition: Object.keys(nutrition).length ? nutrition : null });
    const variations = Array.from(form.querySelectorAll('.variation-card')).map(card => ({ groupId: card.dataset.groupId, minRequired: Number(card.querySelector('.variation-min').value), maxAllowed: Number(card.querySelector('.variation-max').value), options: Array.from(card.querySelectorAll('.variation-option')).filter(row => row.querySelector('.variation-enabled').checked).map(row => ({ id: row.dataset.optionId, priceCents: Math.round(Number(row.querySelector('.variation-price').value) * 100), isDefault: row.querySelector('.variation-default').checked })) }));
    data = { name: formValue(form,'name'), priceCents, weeklyPriceCents, categoryId: formValue(form,'categoryId'), kind, description: formValue(form,'description'), details, variations, ingredients: kind === 'individual' ? relations.map(row => ({ id: row.id, servings: row.value })) : [], components: kind === 'combo' ? relations.map(row => ({ id: row.id, quantity: row.value })) : [] };
  } else if (form.id === 'variation-group-form') {
    path = `/api/v1/staff/variation-groups${id ? `/${id}` : ''}`;
    data = { name: formValue(form,'name'), selectionType: formValue(form,'selectionType'), options: Array.from(form.querySelectorAll('.template-option')).map(row => ({ id: row.dataset.optionId || undefined, label: row.querySelector('.template-label').value.trim(), sku: row.querySelector('.template-sku').value.trim() || null, basePriceCents: Math.round(Number(row.querySelector('.template-price').value) * 100) })) };
  } else return;
  const saved = await api(path, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) });
  if (form.id === 'product-form') {
    form.dataset.id = saved.id;
    for (const file of form.elements.namedItem('photos').files) await api(`/api/v1/staff/products/${saved.id}/images`, { method: 'POST', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
  }
  closeEditor();
  toast('Saved successfully');
  await refresh();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  try {
    if (target.dataset.themeToggle !== undefined) { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); return; }
    if (target.dataset.view) await setView(target.dataset.view);
    if (target.dataset.date) { state.selectedDate = target.dataset.date; renderDashboard(); }
    if (target.dataset.catalog) { state.catalogTab = target.dataset.catalog; renderCatalog(); }
    if (target.dataset.create) { const kind = target.dataset.create; if (kind === 'ingredient') openIngredientForm(); else if (kind === 'product') openProductForm(); else if (kind === 'variation-group') openVariationGroupForm(); else openOrderForm(kind); }
    if (target.dataset.removeRow !== undefined) { target.closest('.item-line').remove(); updateOrderPreview(); }
    if (target.dataset.addRow === 'order') { $('#order-lines').insertAdjacentHTML('beforeend', itemLine()); updateOrderPreview(); }
    if (target.dataset.addRow === 'relation') $('#relations').insertAdjacentHTML('beforeend', relationLine(formValue($('#product-form'),'kind') === 'combo' ? 'combo' : 'individual'));
    if (target.dataset.addTemplateOption !== undefined) $('#template-options').insertAdjacentHTML('beforeend', optionTemplateLine());
    if (target.dataset.removeTemplateOption !== undefined) target.closest('.template-option').remove();
    if (target.dataset.addGroup !== undefined) {
      const select = $('#add-variation-group');
      const group = state.variationGroups.find(item => item.id === select.value);
      if (group) {
        const options = group.options.filter(option => option.active).map(option => ({ id: option.id, priceCents: option.basePriceCents, isDefault: option.label.toLowerCase().startsWith('no thanks') }));
        $('#product-variations').insertAdjacentHTML('beforeend', variationCard({ groupId: group.id, minRequired: group.name.toLowerCase().startsWith('add ') || options.some(option => option.isDefault) ? 0 : 1, maxAllowed: 1, options }));
        select.querySelector(`option[value="${group.id}"]`).remove();
        select.value = '';
      }
    }
    if (target.dataset.removeGroup) {
      const group = state.variationGroups.find(item => item.id === target.dataset.removeGroup);
      target.closest('.variation-card').remove();
      if (group) $('#add-variation-group').insertAdjacentHTML('beforeend', `<option value="${esc(group.id)}">${esc(group.name)}</option>`);
    }
    if (target.dataset.order) await openOrder(target.dataset.order);
    if (target.dataset.subscription) { const { subscription } = await api(`/api/v1/staff/subscriptions/${target.dataset.subscription}`); openOrderForm('subscription', subscription); }
    if (target.dataset.ingredient) openIngredientForm(state.ingredients.find(item => item.id === target.dataset.ingredient));
    if (target.dataset.product) { const { product } = await api(`/api/v1/staff/products/${target.dataset.product}`); openProductForm(product); }
    if (target.dataset.group) openVariationGroupForm(state.variationGroups.find(group => group.id === target.dataset.group));
    if (target.dataset.deleteImage) {
      const form = $('#product-form');
      if (form && form.dataset.id && window.confirm('Remove this photo from the product?')) {
        await api(`/api/v1/staff/products/${form.dataset.id}/images/${target.dataset.deleteImage}`, { method: 'DELETE' });
        target.closest('.product-image').remove();
        toast('Photo removed');
      }
    }
    if (target.dataset.editOrder) {
      const { order } = await api(`/api/v1/staff/orders/${target.dataset.editOrder}`);
      closeEditor();
      openOrderForm('order', { ...order, items: order.items.map(item => ({ productId: item.productId, quantity: item.quantity, selections: item.selections })) });
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
  if (event.target.classList.contains('item-product')) hydrateOrderLine(event.target.closest('.order-item-line')).catch(error => toast(error.message, true));
  if (event.target.closest('.order-choice') || event.target.classList.contains('item-quantity')) updateOrderPreview();
  if (event.target.name === 'kind') {
    const kind = event.target.value;
    $('#relations').innerHTML = kind === 'combo' ? relationLine('combo') : '';
    $('#relation-title').textContent = kind === 'combo' ? 'Products in combo' : 'Ingredients (optional)';
    $('[data-add-row="relation"]').textContent = `+ Add ${kind === 'combo' ? 'product' : 'ingredient'}`;
  }
});
$('#editor').addEventListener('input', event => { if (event.target.classList.contains('item-quantity')) updateOrderPreview(); });
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
