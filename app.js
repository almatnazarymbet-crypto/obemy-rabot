/* ==========================================================================
   Учёт объёмов работ — клиентская логика для GitHub Pages.

   Сайт сам по себе (HTML/CSS/JS) — просто статичные файлы, бесплатный
   GitHub Pages их только показывает. Данные (пользователи, прайс, отчёты),
   отправку почты и генерацию Excel по-прежнему делает бесплатный
   Google Apps Script (это единственный способ иметь настоящий "бэкенд"
   без платного хостинга) — сайт обращается к нему как к обычному API.

   1) Разверните Apps Script (см. README) и скопируйте ссылку вида
      https://script.google.com/macros/s/XXXXXXXX/exec
   2) Вставьте её вместо строки ниже.
   ========================================================================== */
https://script.google.com/macros/library/d/1D5ple7Xrh6KN6zg1p2S5L5cdBZj4pFEHumAMxB89chCMHaQBY3WivYdr/2

let INIT = null;
const CURRENT = { loginId: null, fio: null, role: null };
let customItems = [];

function isConfigured() {
  return API_URL && API_URL.indexOf("http") === 0;
}

// JSONP вместо fetch(): грузим ответ сервера через <script src="...">.
// На такую загрузку CORS не распространяется (это не XHR/fetch-запрос),
// поэтому она надёжно работает даже там, где обычный fetch() к Apps Script
// падает с "Failed to fetch" из-за внутреннего редиректа Google.
function jsonp(action, params) {
  return new Promise(function (resolve, reject) {
    const cbName = 'cb_' + Math.random().toString(36).slice(2);
    const timeoutId = setTimeout(function () {
      cleanup();
      reject(new Error('Сервер не ответил за 15 секунд. Проверьте API_URL и интернет.'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeoutId);
      delete window[cbName];
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      resolve(data);
    };

    const qs = Object.keys(params || {}).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');

    const script = document.createElement('script');
    script.src = API_URL + '?action=' + encodeURIComponent(action) +
      '&callback=' + cbName + (qs ? '&' + qs : '');
    script.onerror = function () {
      cleanup();
      reject(new Error('Не удалось загрузить ответ сервера — проверьте API_URL.'));
    };
    document.body.appendChild(script);
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  if (!isConfigured()) {
    document.getElementById('setupWarning').style.display = 'block';
    return;
  }
  try {
    INIT = await jsonp('getInitData');
    const sel = document.getElementById('loginSelect');
    INIT.users.forEach(function (u) {
      const opt = document.createElement('option');
      opt.value = u.login;
      opt.textContent = u.fio;
      sel.appendChild(opt);
    });
    buildAreaOptions();
  } catch (e) {
    document.getElementById('loginError').textContent = 'Не удалось связаться с сервером: ' + e.message;
  }
  document.getElementById('workDate').valueAsDate = new Date();
});

function goStep(id) {
  document.querySelectorAll('.step').forEach(function (s) { s.classList.remove('active'); });
  document.getElementById(id).classList.add('active');
}

/* ---------- ЛОГИН ---------- */

async function doLogin() {
  const loginId = document.getElementById('loginSelect').value;
  const password = document.getElementById('loginPassword').value;
  const errBox = document.getElementById('loginError');
  errBox.textContent = '';
  try {
    const res = await jsonp('login', { loginId: loginId, password: password });
    if (!res.ok) { errBox.textContent = res.error; return; }
    CURRENT.loginId = loginId; CURRENT.fio = res.fio; CURRENT.role = res.role;
    if (res.mustChangePassword) { goStep('step-newpass'); } else { afterLogin(); }
  } catch (e) {
    errBox.textContent = 'Ошибка соединения: ' + e.message;
  }
}

async function doSetNewPassword() {
  const p1 = document.getElementById('newPassword1').value;
  const p2 = document.getElementById('newPassword2').value;
  const err = document.getElementById('newPassError');
  err.textContent = '';
  if (p1 !== p2) { err.textContent = 'Пароли не совпадают.'; return; }
  const oldPassword = document.getElementById('loginPassword').value;
  try {
    const res = await jsonp('setNewPassword', { loginId: CURRENT.loginId, oldPassword: oldPassword, newPassword: p1 });
    if (!res.ok) { err.textContent = res.error; return; }
    afterLogin();
  } catch (e) {
    err.textContent = 'Ошибка соединения: ' + e.message;
  }
}

function afterLogin() {
  buildTeammates();
  buildItemsList();
  goStep('step-team');
}

/* ---------- БРИГАДА ---------- */

function buildTeammates() {
  const box = document.getElementById('teammates');
  box.innerHTML = '';
  INIT.users.filter(function (u) { return u.login !== CURRENT.loginId; }).forEach(function (u) {
    const lbl = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = u.fio;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(u.fio));
    box.appendChild(lbl);
  });
}

function getTeammates() {
  return Array.from(document.querySelectorAll('#teammates input:checked')).map(function (c) { return c.value; });
}

/* ---------- ЛОКАЦИЯ (каскад) ---------- */

function uniq(arr) { return arr.filter(function (v, i) { return arr.indexOf(v) === i; }); }

function fillSelect(id, values) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  values.forEach(function (v) {
    const opt = document.createElement('option'); opt.value = v; opt.textContent = v; sel.appendChild(opt);
  });
}

function buildAreaOptions() {
  fillSelect('selArea', uniq(INIT.locations.map(function (l) { return l.area; })));
  onAreaChange();
}
function onAreaChange() {
  const area = document.getElementById('selArea').value;
  fillSelect('selDistrict', uniq(INIT.locations.filter(function (l) { return l.area === area; }).map(function (l) { return l.district; })));
  onDistrictChange();
}
function onDistrictChange() {
  const area = document.getElementById('selArea').value, district = document.getElementById('selDistrict').value;
  fillSelect('selOkrug', uniq(INIT.locations.filter(function (l) { return l.area === area && l.district === district; }).map(function (l) { return l.okrug; })));
  onOkrugChange();
}
function onOkrugChange() {
  const area = document.getElementById('selArea').value, district = document.getElementById('selDistrict').value, okrug = document.getElementById('selOkrug').value;
  fillSelect('selVillage', uniq(INIT.locations.filter(function (l) { return l.area === area && l.district === district && l.okrug === okrug; }).map(function (l) { return l.village; })));
}

/* ---------- РАБОТЫ И МАТЕРИАЛЫ ---------- */

function buildItemsList() {
  const box = document.getElementById('itemsList');
  box.innerHTML = '';
  INIT.price.forEach(function (p) {
    const row = document.createElement('div'); row.className = 'item-row';
    const span = document.createElement('span'); span.textContent = p.name + ' (' + p.unit + ')';
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.step = p.unit === 'м' ? '0.1' : '1';
    input.dataset.name = p.name; input.value = '';
    row.appendChild(span); row.appendChild(input);
    box.appendChild(row);
  });
}

function addCustomItem() {
  const name = document.getElementById('customName').value.trim();
  const qty = parseFloat(document.getElementById('customQty').value);
  if (!name || !qty) return;
  customItems.push({ name: name, qty: qty });
  document.getElementById('customName').value = '';
  document.getElementById('customQty').value = '';
  renderCustomItems();
}
function renderCustomItems() {
  const ul = document.getElementById('customItemsList'); ul.innerHTML = '';
  customItems.forEach(function (it) {
    const li = document.createElement('li'); li.textContent = it.name + ' — ' + it.qty;
    ul.appendChild(li);
  });
}

function collectItems() {
  return Array.from(document.querySelectorAll('#itemsList input'))
    .map(function (i) { return { name: i.dataset.name, qty: parseFloat(i.value) || 0 }; })
    .filter(function (i) { return i.qty > 0; });
}

/* ---------- ОТПРАВКА ---------- */

async function doSubmit() {
  const err = document.getElementById('submitError'); err.textContent = '';
  const payload = {
    loginId: CURRENT.loginId,
    fio: CURRENT.fio,
    date: document.getElementById('workDate').value,
    teammates: getTeammates(),
    area: document.getElementById('selArea').value,
    district: document.getElementById('selDistrict').value,
    okrug: document.getElementById('selOkrug').value,
    village: document.getElementById('selVillage').value,
    street: document.getElementById('street').value,
    items: collectItems(),
    customItems: customItems
  };
  if (!payload.items.length && !payload.customItems.length) {
    err.textContent = 'Укажите хотя бы одну позицию с количеством.'; return;
  }
  try {
    const res = await jsonp('submitReport', { payload: JSON.stringify(payload) });
    if (!res.ok) { err.textContent = res.error || 'Не удалось отправить отчёт.'; return; }
    document.getElementById('doneSummary').textContent =
      'Материалы: ' + res.totalM.toLocaleString('ru-RU') +
      ' · Работы: ' + res.totalR.toLocaleString('ru-RU') +
      ' · Итого: ' + res.total.toLocaleString('ru-RU');
    document.getElementById('whatsappLink').href = res.whatsappUrl;
    document.getElementById('fileLink').href = res.fileUrl;
    goStep('step-done');
  } catch (e) {
    err.textContent = 'Ошибка отправки: ' + e.message;
  }
}
