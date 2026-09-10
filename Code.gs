/**
 * УЧЁТ ОБЪЁМОВ РАБОТ — серверная часть (Google Apps Script), версия для GitHub Pages
 * --------------------------------------------------------------------------------
 * Сайт (HTML/CSS/JS) теперь живёт бесплатно на GitHub Pages и обращается сюда
 * как к обычному API: GET для чтения справочников, POST — для входа и отправки отчёта.
 *
 * Скрипт "привязан" к таблице "Учет_объемов_работ.xlsx" (после импорта в Google Таблицы).
 * Использует листы: Прайс, Пользователи, Настройки, Локации, Отчёты, Шаблон_экспорта
 *
 * Установка — см. README.md
 */

var SS = SpreadsheetApp.getActiveSpreadsheet();

/* ============================ ВХОДНЫЕ ТОЧКИ (API) ============================ */

// Всё — через GET с параметром callback (JSONP). Это осознанный выбор:
// прямой fetch() с чужого домена (GitHub Pages) к Apps Script может
// упираться в CORS, даже когда доступ выставлен на "Все" — ответ
// уходит через внутренний редирект Google, и браузер иногда блокирует
// его чтение. Загрузка через <script src="..."> этому правилу не подчиняется,
// поэтому работает надёжно в 100% случаев.
function doGet(e) {
  var result;
  try {
    var action = e.parameter.action;
    switch (action) {
      case 'getInitData':
        result = getInitData();
        break;
      case 'login':
        result = login(e.parameter.loginId, e.parameter.password);
        break;
      case 'setNewPassword':
        result = setNewPassword(e.parameter.loginId, e.parameter.oldPassword, e.parameter.newPassword);
        break;
      case 'submitReport':
        result = submitReport(JSON.parse(e.parameter.payload || '{}'));
        break;
      default:
        result = { ok: false, error: 'Неизвестное действие: ' + action };
    }
  } catch (err) {
    result = { ok: false, error: String(err) };
  }
  return callbackOut_(e, result);
}

// Оставлен для совместимости / прямого тестирования (Postman и т.п.) —
// сайт им больше не пользуется, только doGet.
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var result;
    switch (data.action) {
      case 'login':
        result = login(data.loginId, data.password);
        break;
      case 'setNewPassword':
        result = setNewPassword(data.loginId, data.oldPassword, data.newPassword);
        break;
      case 'submitReport':
        result = submitReport(data.payload);
        break;
      default:
        result = { ok: false, error: 'Неизвестное действие: ' + data.action };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) })).setMimeType(ContentService.MimeType.JSON);
  }
}

function callbackOut_(e, obj) {
  var json = JSON.stringify(obj);
  if (e.parameter.callback) {
    return ContentService
      .createTextOutput(e.parameter.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

/* ============================ УТИЛИТЫ ============================ */

function sheet_(name) {
  var sh = SS.getSheetByName(name);
  if (!sh) throw new Error('Лист "' + name + '" не найден. Проверьте, что таблица создана из шаблона.');
  return sh;
}

function readTable_(sheetName) {
  var sh = sheet_(sheetName);
  var values = sh.getDataRange().getValues();
  var headers = values.shift();
  return values
    .filter(function (row) { return row.join('') !== ''; })
    .map(function (row) {
      var obj = {};
      headers.forEach(function (h, i) { obj[h] = row[i]; });
      return obj;
    });
}

function hashPassword_(plain) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plain, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}

function getSetting_(name) {
  var rows = readTable_('Настройки');
  var row = rows.filter(function (r) { return r['Параметр'] === name; })[0];
  return row ? row['Значение'] : null;
}

/* ============================ ДАННЫЕ ДЛЯ ФОРМЫ ============================ */

// Отдаёт клиенту всё, что нужно для формы, БЕЗ паролей.
function getInitData() {
  var users = readTable_('Пользователи').map(function (u) {
    return { fio: u['ФИО'], login: u['Логин'], role: u['Роль'] };
  });

  var price = readTable_('Прайс')
    .filter(function (p) { return String(p['Активна']).toLowerCase() === 'да'; })
    .map(function (p) {
      return {
        name: p['Наименование'],
        priceM: Number(p['Цена материал']) || 0,
        priceR: Number(p['Цена работ']) || 0,
        unit: p['Ед. изм.']
      };
    });

  var locations = readTable_('Локации').map(function (l) {
    return { area: l['Область'], district: l['Район'], okrug: l['Сельский округ'], village: l['Село'] };
  });

  return { users: users, price: price, locations: locations };
}

/* ============================ ЛОГИН ============================ */

// Возвращает: {ok:true, mustChangePassword, fio, role} или {ok:false, error}
function login(loginId, password) {
  var sh = sheet_('Пользователи');
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var colLogin = headers.indexOf('Логин');
  var colPass = headers.indexOf('Временный пароль');
  var colMustChange = headers.indexOf('Сменить при входе');
  var colFio = headers.indexOf('ФИО');
  var colRole = headers.indexOf('Роль');

  for (var r = 1; r < values.length; r++) {
    if (values[r][colLogin] === loginId) {
      var mustChange = String(values[r][colMustChange]).toUpperCase() === 'ИСТИНА' ||
                        String(values[r][colMustChange]).toUpperCase() === 'TRUE';
      var stored = values[r][colPass];
      var okPassword = mustChange ? (password === stored) : (hashPassword_(password) === stored);
      if (!okPassword) return { ok: false, error: 'Неверный пароль.' };
      return {
        ok: true,
        mustChangePassword: mustChange,
        fio: values[r][colFio],
        role: values[r][colRole]
      };
    }
  }
  return { ok: false, error: 'Такой логин не найден.' };
}

// Первый вход — обязательная смена временного пароля на постоянный.
function setNewPassword(loginId, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: 'Пароль должен быть не короче 6 символов.' };
  }
  var sh = sheet_('Пользователи');
  var values = sh.getDataRange().getValues();
  var headers = values[0];
  var colLogin = headers.indexOf('Логин');
  var colPass = headers.indexOf('Временный пароль');
  var colMustChange = headers.indexOf('Сменить при входе');

  for (var r = 1; r < values.length; r++) {
    if (values[r][colLogin] === loginId) {
      if (values[r][colPass] !== oldPassword) return { ok: false, error: 'Старый пароль не совпадает.' };
      sh.getRange(r + 1, colPass + 1).setValue(hashPassword_(newPassword));
      sh.getRange(r + 1, colMustChange + 1).setValue('ЛОЖЬ');
      return { ok: true };
    }
  }
  return { ok: false, error: 'Логин не найден.' };
}

/* ============================ ОТПРАВКА ОТЧЁТА ============================ */

/**
 * payload = {
 *   loginId, fio, date, teammates: [fio,...],
 *   area, district, okrug, village, street,
 *   items: [{name, qty}],           // qty может быть дробным (метры)
 *   customItems: [{name, qty}]      // позиции, которых нет в прайсе
 * }
 */
function submitReport(payload) {
  var price = readTable_('Прайс');
  var priceMap = {};
  price.forEach(function (p) { priceMap[p['Наименование']] = p; });

  var rows = [];     // для экспортного файла: [name, qty, priceM, priceR]
  var totalM = 0, totalR = 0;
  var needsPricing = [];

  (payload.items || []).forEach(function (it) {
    if (!it.qty) return; // пропускаем нулевые количества
    var p = priceMap[it.name];
    if (!p) return;
    var pm = Number(p['Цена материал']) || 0;
    var pr = Number(p['Цена работ']) || 0;
    rows.push([it.name, it.qty, pm, pr]);
    totalM += it.qty * pm;
    totalR += it.qty * pr;
  });

  (payload.customItems || []).forEach(function (it) {
    if (!it.name || !it.qty) return;
    rows.push([it.name + ' (не из прайса)', it.qty, 0, 0]);
    needsPricing.push(it.name);
  });

  var fileInfo = buildExportFile_(payload, rows, totalM, totalR);
  logReport_(payload, totalM, totalR, fileInfo.url);
  sendEmail_(payload, fileInfo.blob, fileInfo.fileName);

  var waText = buildWhatsAppText_(payload, rows, totalM, totalR);

  return {
    ok: true,
    totalM: totalM,
    totalR: totalR,
    total: totalM + totalR,
    fileUrl: fileInfo.url,
    needsPricing: needsPricing,
    whatsappUrl: 'https://wa.me/?text=' + encodeURIComponent(waText)
  };
}

function buildExportFile_(payload, rows, totalM, totalR) {
  var dateStr = Utilities.formatDate(new Date(payload.date), Session.getScriptTimeZone(), 'yyyyMMdd');
  var fileName = dateStr + ' - ' + payload.loginId + ' - ' + payload.village;

  var tempSs = SpreadsheetApp.create(fileName);
  var sh = tempSs.getSheets()[0];
  sh.setName('Дата');
  sh.appendRow(['Наименование', 'Количество', 'Цена за ед.', 'Цена за ед. работ', 'Общ. Сумма мат', 'Общ. Сумма работ']);
  rows.forEach(function (r) {
    var rowNum = sh.getLastRow() + 1;
    sh.appendRow([r[0], r[1], r[2], r[3], '=B' + rowNum + '*C' + rowNum, '=B' + rowNum + '*D' + rowNum]);
  });
  sh.appendRow(['']);
  sh.appendRow(['', '', '', '', 'Итого работы', totalR]);
  sh.appendRow(['', '', '', '', 'Итого материал', totalM]);
  sh.appendRow(['', '', '', '', 'Итого', totalM + totalR]);
  sh.appendRow(['']);
  var teamLine = 'Пользователи - ' + [payload.fio].concat(payload.teammates || []).join(', ');
  sh.appendRow([teamLine]);
  var locLine = [payload.area, payload.district, payload.okrug, payload.village, payload.street]
    .filter(function (x) { return x; }).join(', ');
  sh.appendRow([locLine]);
  sh.autoResizeColumns(1, 6);
  SpreadsheetApp.flush();

  var url = 'https://docs.google.com/spreadsheets/d/' + tempSs.getId() + '/export?format=xlsx';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
  });
  var xlsxBlob = response.getBlob().setName(fileName + '.xlsx');

  var folder = getOrCreateFolder_(getSetting_('Папка на Google Диске для файлов отчётов') || 'Отчёты_объёмы_работ');
  var savedFile = folder.createFile(xlsxBlob);
  DriveApp.getFileById(tempSs.getId()).setTrashed(true); // временную Google-таблицу больше не храним, оставляем только xlsx

  return { blob: xlsxBlob, fileName: fileName + '.xlsx', url: savedFile.getUrl() };
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

function logReport_(payload, totalM, totalR, fileUrl) {
  var sh = sheet_('Отчёты');
  sh.appendRow([
    new Date(), payload.date, payload.loginId, payload.fio,
    (payload.teammates || []).join(', '),
    payload.area, payload.district, payload.okrug, payload.village, payload.street || '',
    JSON.stringify(payload.items || []),
    totalM, totalR, totalM + totalR, fileUrl
  ]);
}

function sendEmail_(payload, blob, fileName) {
  var to = getSetting_('Email для отправки отчётов');
  if (!to) throw new Error('В листе "Настройки" не указан email для отправки отчётов.');
  MailApp.sendEmail({
    to: to,
    subject: 'Отчёт по объёму работ — ' + payload.village + ' — ' + payload.fio,
    body: 'Отчёт за ' + payload.date + ' от ' + payload.fio + ' (' + payload.loginId + ').\n' +
          'Объект: ' + [payload.area, payload.district, payload.okrug, payload.village].filter(Boolean).join(', ') + '\n' +
          'Файл во вложении и в Google Диске: см. лист "Отчёты".',
    attachments: [blob]
  });
}

function buildWhatsAppText_(payload, rows, totalM, totalR) {
  var lines = [];
  lines.push('Отчёт по объёму работ');
  lines.push('Дата: ' + payload.date);
  lines.push('Бригада: ' + [payload.fio].concat(payload.teammates || []).join(', '));
  lines.push('Объект: ' + [payload.area, payload.district, payload.okrug, payload.village, payload.street].filter(Boolean).join(', '));
  lines.push('');
  rows.forEach(function (r) { lines.push('• ' + r[0] + ' — ' + r[1]); });
  lines.push('');
  lines.push('Итого материал: ' + totalM.toLocaleString('ru-RU'));
  lines.push('Итого работы: ' + totalR.toLocaleString('ru-RU'));
  lines.push('Итого: ' + (totalM + totalR).toLocaleString('ru-RU'));
  return lines.join('\n');
}
