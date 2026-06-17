var NummiBackendRuntime = (function () {
  'use strict';

  /**
   * Nummi - Google Apps Script backend
   *
   * Deploy as Web App:
   * - Execute as: Me
   * - Who has access: Anyone with the link
   *
   * No external API key or AI credential is used here.
   */

  const APP = {
    name: 'Nummi',
    version: '2026.06.17',
    usersSheet: '_Nummi_Users',
    auditSheet: '_Nummi_Audit',
    schemaVersion: 1
  };

  const COLLECTIONS = {
    transactions: {
      sheet: 'Transactions',
      fields: ['id', 'description', 'amount', 'type', 'category', 'date', 'createdAt', 'note', 'recurrenceId']
    },
    investments: {
      sheet: 'Investments',
      fields: ['id', 'name', 'amount', 'type', 'isDeductible', 'createdAt']
    },
    investmentReturns: {
      sheet: 'InvestmentReturns',
      fields: ['id', 'investmentId', 'investmentName', 'month', 'amount', 'percent', 'note', 'createdAt']
    },
    vouchers: {
      sheet: 'Vouchers',
      fields: ['id', 'name', 'total', 'used', 'createdAt', 'history', 'autoRenew', 'renewDay', 'lastRenewedDate']
    },
    goals: {
      sheet: 'Goals',
      fields: ['id', 'name', 'current', 'target', 'targetDate', 'createdAt']
    },
    budgets: {
      sheet: 'Budgets',
      fields: ['id', 'category', 'amount', 'month', 'rollover', 'createdAt']
    },
    recurrences: {
      sheet: 'Recurrences',
      fields: ['id', 'description', 'amount', 'type', 'category', 'frequency', 'nextDate', 'active', 'autoPost', 'createdAt']
    },
    notifications: {
      sheet: 'Notifications',
      fields: ['id', 'title', 'message', 'type', 'createdAt', 'read', 'key']
    },
    notificationHistory: {
      sheet: 'NotificationHistory',
      fields: ['id', 'title', 'message', 'type', 'createdAt', 'read', 'key']
    },
    settings: {
      sheet: 'Settings',
      fields: [
        'theme',
        'soundEnabled',
        'notificationsEnabled',
        'budgetAlertPercent',
        'voucherAlertPercent',
        'bigExpenseAlertAmount',
        'upcomingReminderDays',
        'defaultDatePreset',
        'compactMode'
      ]
    }
  };

  const NUMERIC_FIELDS = {
    amount: true,
    total: true,
    used: true,
    current: true,
    target: true,
    renewDay: true,
    percent: true,
    budgetAlertPercent: true,
    voucherAlertPercent: true,
    bigExpenseAlertAmount: true,
    upcomingReminderDays: true
  };

  const BOOLEAN_FIELDS = {
    isDeductible: true,
    autoRenew: true,
    rollover: true,
    active: true,
    autoPost: true,
    read: true,
    soundEnabled: true,
    notificationsEnabled: true,
    compactMode: true
  };

  function doGet() {
    return responseJSON({
      status: 'success',
      app: APP.name,
      version: APP.version,
      schemaVersion: APP.schemaVersion,
      message: 'Nummi backend online.'
    });
  }

  function doPost(e) {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const params = parseBody(e);
      const action = String(params.action || '').trim();
      const ss = getSpreadsheet();

      if (action === 'ping') {
        return responseJSON({ status: 'success', data: { app: APP.name, version: APP.version } });
      }

      if (action === 'register') {
        const username = String(params.username || '').trim();
        const email = String(params.email || '').trim();
        const password = String(params.password || '');
        if (!username || !email || !password) {
          return responseJSON({ status: 'error', message: 'username, email e password sao obrigatorios.' });
        }
        return responseJSON(registerUser(ss, username, email, password));
      }

      if (action === 'login') {
        const identifier = String(params.username || params.email || '').trim();
        const password = String(params.password || '');
        if (!identifier || !password) {
          return responseJSON({ status: 'error', message: 'Usuario/e-mail e senha sao obrigatorios.' });
        }
        const user = authenticateUser(ss, identifier, password);
        if (!user) return responseJSON({ status: 'error', message: 'Credenciais invalidas.' });
        user.token = createSessionToken(ss, user.userId, user.username);
        appendAudit(ss, user.userId, 'login', {});
        return responseJSON({ status: 'success', user: user });
      }

      const username = String(params.username || '').trim();
      if (!username) {
        return responseJSON({ status: 'error', message: 'username e obrigatorio.' });
      }
      const userContext = requireSession(ss, username, params.token);
      const userKey = userContext.userId;

      if (action === 'load') {
        return responseJSON({ status: 'success', data: loadAll(ss, userKey) });
      }

      if (action === 'save_all') {
        validateCompleteData(params.data || {});
        const data = normalizeFinanceData(params.data || {});
        saveAll(ss, userKey, data);
        appendAudit(ss, userKey, 'save_all', countCollections(data));
        return responseJSON({ status: 'success', data: loadAll(ss, userKey) });
      }

      if (action === 'save_collection') {
        const collection = String(params.collection || params.type || '').trim();
        if (!COLLECTIONS[collection]) {
          return responseJSON({ status: 'error', message: 'Colecao invalida.' });
        }
        saveCollection(ss, userKey, collection, params.data);
        appendAudit(ss, userKey, 'save_collection', { collection: collection });
        return responseJSON({ status: 'success', data: loadAll(ss, userKey) });
      }

      if (action === 'export_csv') {
        const collection = String(params.collection || 'transactions').trim();
        if (!COLLECTIONS[collection]) {
          return responseJSON({ status: 'error', message: 'Colecao invalida.' });
        }
        return responseJSON({ status: 'success', data: { collection: collection, csv: exportCsv(ss, userKey, collection) } });
      }

      if (action === 'import_csv') {
        const collection = String(params.collection || 'transactions').trim();
        const csv = String(params.csv || '');
        if (!COLLECTIONS[collection]) {
          return responseJSON({ status: 'error', message: 'Colecao invalida.' });
        }
        saveCollection(ss, userKey, collection, parseCsv(csv));
        appendAudit(ss, userKey, 'import_csv', { collection: collection });
        return responseJSON({ status: 'success', data: loadAll(ss, userKey) });
      }

      if (action === 'archive') {
        archiveUserData(ss, userKey);
        appendAudit(ss, userKey, 'archive', {});
        return responseJSON({ status: 'success', message: 'Arquivo criado.' });
      }

      if (action === 'daily_process') {
        const result = processUserDaily(ss, userKey, new Date());
        appendAudit(ss, userKey, 'daily_process', result);
        return responseJSON({ status: 'success', data: result });
      }

      return responseJSON({ status: 'error', message: 'Acao desconhecida: ' + action });
    } catch (err) {
      return responseJSON({ status: 'error', message: err && err.message ? err.message : String(err) });
    } finally {
      lock.releaseLock();
    }
  }

  function parseBody(e) {
    if (!e) return {};
    if (e.postData && e.postData.contents) {
      const raw = e.postData.contents;
      try {
        return JSON.parse(raw);
      } catch (err) {
        return e.parameter || {};
      }
    }
    return e.parameter || {};
  }

  function getSpreadsheet() {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) throw new Error('Nenhuma planilha ativa. Vincule o script a uma planilha ou configure SPREADSHEET_ID.');
    return active;
  }

  function responseJSON(obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  }

  function ensureUsersSheet(ss) {
    let sheet = ss.getSheetByName(APP.usersSheet);
    if (!sheet) sheet = ss.insertSheet(APP.usersSheet);
    const headers = ['username', 'email', 'password_hash', 'salt', 'created_at', 'last_login', 'user_id', 'session_token', 'session_expires'];
    ensureHeaders(sheet, headers);
    return sheet;
  }

  function registerUser(ss, username, email, password) {
    const sheet = ensureUsersSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const normalizedUsername = username.toLowerCase();
    const normalizedEmail = email.toLowerCase();

    for (let i = 1; i < rows.length; i += 1) {
      const existingUser = String(rows[i][0] || '').toLowerCase();
      const existingEmail = String(rows[i][1] || '').toLowerCase();
      if (existingUser === normalizedUsername || existingEmail === normalizedEmail) {
        return { status: 'error', message: 'Usuario ou email ja existe.' };
      }
    }

    const userId = Utilities.getUuid();
    const salt = makeSalt();
    const hash = hashPassword(password, salt);
    const session = makeSession();
    sheet.appendRow([username, email, hash, salt, new Date(), new Date(), userId, session.token, session.expires]);
    appendAudit(ss, userId, 'register', {});
    return {
      status: 'success',
      message: 'Usuario criado.',
      user: { username: username, email: email, userId: userId, token: session.token }
    };
  }

  function authenticateUser(ss, identifier, password) {
    const sheet = ensureUsersSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const normalized = identifier.toLowerCase();

    for (let i = 1; i < rows.length; i += 1) {
      const username = String(rows[i][0] || '');
      const email = String(rows[i][1] || '');
      const hash = String(rows[i][2] || '');
      const salt = String(rows[i][3] || '');
      if (username.toLowerCase() !== normalized && email.toLowerCase() !== normalized) continue;
      if (hashPassword(password, salt) !== hash) return null;
      let userId = String(rows[i][6] || '');
      if (!userId) {
        userId = Utilities.getUuid();
        sheet.getRange(i + 1, 7).setValue(userId);
      }
      sheet.getRange(i + 1, 6).setValue(new Date());
      return { username: username, email: email, userId: userId };
    }

    return null;
  }

  function makeSession() {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    return { token: Utilities.getUuid() + ':' + Utilities.getUuid(), expires: expires };
  }

  function createSessionToken(ss, userId, username) {
    const sheet = ensureUsersSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const session = makeSession();
    for (let i = 1; i < rows.length; i += 1) {
      const rowUserId = String(rows[i][6] || '');
      const rowUsername = String(rows[i][0] || '');
      if (rowUserId === String(userId) || rowUsername.toLowerCase() === String(username || '').toLowerCase()) {
        sheet.getRange(i + 1, 8).setValue(session.token);
        sheet.getRange(i + 1, 9).setValue(session.expires);
        return session.token;
      }
    }
    throw new Error('Usuario nao encontrado para sessao.');
  }

  function requireSession(ss, username, token) {
    const sheet = ensureUsersSheet(ss);
    const rows = sheet.getDataRange().getValues();
    const normalized = String(username || '').toLowerCase();
    const providedToken = String(token || '');
    if (!providedToken) throw new Error('Sessao ausente. Faca login novamente.');

    for (let i = 1; i < rows.length; i += 1) {
      const rowUsername = String(rows[i][0] || '');
      const rowEmail = String(rows[i][1] || '');
      let userId = String(rows[i][6] || '');
      const rowToken = String(rows[i][7] || '');
      const expires = rows[i][8] instanceof Date ? rows[i][8] : new Date(String(rows[i][8] || ''));
      const matchesUser = rowUsername.toLowerCase() === normalized || rowEmail.toLowerCase() === normalized;
      if (!matchesUser) continue;
      if (!userId) {
        userId = Utilities.getUuid();
        sheet.getRange(i + 1, 7).setValue(userId);
      }
      if (rowToken !== providedToken || !expires || expires.getTime() < new Date().getTime()) {
        throw new Error('Sessao expirada. Faca login novamente.');
      }
      return { username: rowUsername, email: rowEmail, userId: userId };
    }

    throw new Error('Usuario nao encontrado.');
  }

  function makeSalt() {
    return Utilities.getUuid() + ':' + new Date().getTime();
  }

  function hashPassword(password, salt) {
    const digest = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(salt) + ':' + String(password),
      Utilities.Charset.UTF_8
    );
    return digest.map(function (byte) {
      const value = (byte + 256) % 256;
      return ('0' + value.toString(16)).slice(-2);
    }).join('');
  }

  function loadAll(ss, username) {
    const data = {};
    Object.keys(COLLECTIONS).forEach(function (collection) {
      const records = readCollection(ss, username, collection);
      data[collection] = collection === 'settings' ? normalizeSettings(records[0] || {}) : records;
    });
    return normalizeFinanceData(data);
  }

  function saveAll(ss, username, data) {
    const normalized = normalizeFinanceData(data);
    Object.keys(COLLECTIONS).forEach(function (collection) {
      saveCollection(ss, username, collection, normalized[collection]);
    });
  }

  function validateCompleteData(data) {
    const required = [
      'transactions',
      'investments',
      'investmentReturns',
      'vouchers',
      'goals',
      'budgets',
      'recurrences',
      'notifications',
      'notificationHistory'
    ];
    required.forEach(function (collection) {
      if (!Array.isArray(data[collection])) {
        throw new Error('Payload incompleto: colecao ausente ' + collection);
      }
    });
    if (!data.settings || typeof data.settings !== 'object') {
      throw new Error('Payload incompleto: settings ausente.');
    }
  }

  function saveCollection(ss, username, collection, value) {
    const def = COLLECTIONS[collection];
    if (!def) throw new Error('Colecao invalida: ' + collection);
    const sheet = ensureCollectionSheet(ss, username, collection);
    const records = collection === 'settings' ? [normalizeSettings(value || {})] : normalizeArray(value);
    const rows = records.map(function (record) {
      return def.fields.map(function (field) {
        return serializeCell(record[field]);
      });
    });

    const tempName = ('_tmp_' + sheet.getName() + '_' + new Date().getTime()).slice(0, 99);
    const tempSheet = ss.insertSheet(tempName);
    tempSheet.getRange(1, 1, 1, def.fields.length).setValues([def.fields]);
    if (rows.length) {
      tempSheet.getRange(2, 1, rows.length, def.fields.length).setValues(rows);
    }

    sheet.clearContents();
    const tempValues = tempSheet.getDataRange().getValues();
    sheet.getRange(1, 1, tempValues.length, def.fields.length).setValues(tempValues);
    ss.deleteSheet(tempSheet);
    sheet.autoResizeColumns(1, def.fields.length);
  }

  function readCollection(ss, username, collection) {
    const def = COLLECTIONS[collection];
    const sheet = ensureCollectionSheet(ss, username, collection);
    const range = sheet.getDataRange();
    const values = range.getValues();
    if (values.length <= 1) return [];
    const headers = values[0].map(function (header) {
      return String(header || '');
    });

    return values.slice(1).filter(rowHasValue).map(function (row) {
      const record = {};
      headers.forEach(function (header, index) {
        if (!header) return;
        record[header] = parseCell(header, row[index]);
      });
      return record;
    });
  }

  function ensureCollectionSheet(ss, username, collection) {
    const def = COLLECTIONS[collection];
    const name = collectionSheetName(username, def.sheet);
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    ensureHeaders(sheet, def.fields);
    return sheet;
  }

  function ensureHeaders(sheet, headers) {
    const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
    const missing = headers.some(function (header, index) {
      return String(current[index] || '') !== header;
    });
    if (missing) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }

  function collectionSheetName(username, suffix) {
    const safe = sanitizeName(username);
    return ('N_' + safe + '_' + suffix).slice(0, 99);
  }

  function sanitizeName(value) {
    const safe = String(value || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return safe || 'user';
  }

  function normalizeFinanceData(data) {
    data = data || {};
    return {
      transactions: normalizeArray(data.transactions),
      investments: normalizeArray(data.investments),
      investmentReturns: normalizeArray(data.investmentReturns),
      vouchers: normalizeArray(data.vouchers).map(function (item) {
        item.history = normalizeHistory(item.history);
        item.autoRenew = toBoolean(item.autoRenew);
        item.renewDay = Number(item.renewDay || 1);
        return item;
      }),
      goals: normalizeArray(data.goals),
      budgets: normalizeArray(data.budgets),
      recurrences: normalizeArray(data.recurrences),
      notifications: normalizeArray(data.notifications),
      notificationHistory: normalizeArray(data.notificationHistory),
      settings: normalizeSettings(data.settings || {})
    };
  }

  function normalizeArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
  }

  function normalizeSettings(value) {
    value = value || {};
    return {
      theme: value.theme === 'light' ? 'light' : 'dark',
      soundEnabled: value.soundEnabled === undefined ? true : toBoolean(value.soundEnabled),
      notificationsEnabled: value.notificationsEnabled === undefined ? true : toBoolean(value.notificationsEnabled),
      budgetAlertPercent: Number(value.budgetAlertPercent || 90),
      voucherAlertPercent: Number(value.voucherAlertPercent || 15),
      bigExpenseAlertAmount: Number(value.bigExpenseAlertAmount || 500),
      upcomingReminderDays: Number(value.upcomingReminderDays || 3),
      defaultDatePreset: String(value.defaultDatePreset || 'currentMonth'),
      compactMode: value.compactMode === undefined ? false : toBoolean(value.compactMode)
    };
  }

  function normalizeHistory(value) {
    if (Array.isArray(value)) return value;
    if (!value) return [];
    try {
      const parsed = JSON.parse(String(value));
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      return [];
    }
  }

  function serializeCell(value) {
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
    if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'string') return escapeSheetText(value);
    return value;
  }

  function escapeSheetText(value) {
    if (/^[=+\-@]/.test(value)) return "'" + value;
    return value;
  }

  function parseCell(field, value) {
    if (value === '' || value === null || value === undefined) {
      if (BOOLEAN_FIELDS[field]) return false;
      if (NUMERIC_FIELDS[field]) return 0;
      return '';
    }
    if (NUMERIC_FIELDS[field]) return Number(value) || 0;
    if (BOOLEAN_FIELDS[field]) return toBoolean(value);
    if (field === 'history') return normalizeHistory(value);
    return value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd') : value;
  }

  function toBoolean(value) {
    if (value === true) return true;
    if (value === false) return false;
    const normalized = String(value || '').toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'sim' || normalized === 'yes';
  }

  function rowHasValue(row) {
    return row.some(function (cell) {
      return cell !== '' && cell !== null && cell !== undefined;
    });
  }

  function countCollections(data) {
    const counts = {};
    Object.keys(COLLECTIONS).forEach(function (collection) {
      counts[collection] = Array.isArray(data[collection]) ? data[collection].length : 1;
    });
    return counts;
  }

  function exportCsv(ss, username, collection) {
    const def = COLLECTIONS[collection];
    const rows = [def.fields].concat(
      readCollection(ss, username, collection).map(function (record) {
        return def.fields.map(function (field) {
          return serializeCell(record[field]);
        });
      })
    );
    return rows.map(function (row) {
      return row.map(csvCell).join(';');
    }).join('\n');
  }

  function csvCell(value) {
    const text = String(value === undefined || value === null ? '' : value);
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function parseCsv(csv) {
    const lines = String(csv || '').split(/\r?\n/).filter(function (line) {
      return line.trim() !== '';
    });
    if (!lines.length) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map(function (line) {
      const cells = splitCsvLine(line);
      const record = {};
      headers.forEach(function (header, index) {
        record[header] = cells[index] || '';
      });
      return record;
    });
  }

  function splitCsvLine(line) {
    const result = [];
    let current = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      const next = line[i + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if ((char === ';' || char === ',') && !quoted) {
        result.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current);
    return result;
  }

  function archiveUserData(ss, username) {
    const archiveName = ('N_Archive_' + sanitizeName(username) + '_' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss')).slice(0, 99);
    const sheet = ss.insertSheet(archiveName);
    const data = loadAll(ss, username);
    sheet.getRange(1, 1).setValue(JSON.stringify(data, null, 2));
    sheet.autoResizeColumn(1);
  }

  function appendAudit(ss, username, action, details) {
    let sheet = ss.getSheetByName(APP.auditSheet);
    if (!sheet) sheet = ss.insertSheet(APP.auditSheet);
    ensureHeaders(sheet, ['created_at', 'username', 'action', 'details']);
    sheet.appendRow([new Date(), username || '', action || '', JSON.stringify(details || {})]);
  }

  function dailyProcess() {
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      const ss = getSpreadsheet();
      const users = readUsers(ss);
      const today = new Date();
      const results = users.map(function (user) {
        try {
          return {
            username: user.username,
            result: processUserDaily(ss, user.userId, today)
          };
        } catch (err) {
          return {
            username: user.username,
            error: err && err.message ? err.message : String(err)
          };
        }
      });
      appendAudit(ss, 'system', 'dailyProcess', { users: results.length });
      return results;
    } finally {
      lock.releaseLock();
    }
  }

  function readUsers(ss) {
    const sheet = ensureUsersSheet(ss);
    const values = sheet.getDataRange().getValues();
    return values.slice(1).filter(rowHasValue).map(function (row) {
      return { username: String(row[0] || ''), email: String(row[1] || ''), userId: String(row[6] || row[0] || '') };
    }).filter(function (user) {
      return user.username && user.userId;
    });
  }

  function processUserDaily(ss, username, today) {
    const data = loadAll(ss, username);
    const todayIso = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const todayDay = Number(Utilities.formatDate(today, Session.getScriptTimeZone(), 'd'));
    let posted = 0;
    let renewed = 0;

    const transactions = data.transactions.slice();
    const recurrences = data.recurrences.map(function (recurrence) {
      if (!toBoolean(recurrence.active) || !toBoolean(recurrence.autoPost)) return recurrence;
      let guard = 0;
      let nextDate = String(recurrence.nextDate || todayIso);
      while (nextDate <= todayIso && guard < 24) {
        const alreadyExists = transactions.some(function (transaction) {
          return String(transaction.recurrenceId || '') === String(recurrence.id || '') && String(transaction.date || '') === nextDate;
        });
        if (!alreadyExists) {
          transactions.unshift({
            id: Utilities.getUuid(),
            description: recurrence.description,
            amount: Number(recurrence.amount || 0),
            type: recurrence.type || 'expense',
            category: recurrence.category || 'Geral',
            date: nextDate,
            createdAt: todayIso,
            note: 'Gerado automaticamente pelo Nummi',
            recurrenceId: recurrence.id
          });
          posted += 1;
        }
        nextDate = nextDateForFrequency(nextDate, recurrence.frequency || 'monthly');
        guard += 1;
      }
      recurrence.nextDate = nextDate;
      return recurrence;
    });

    const vouchers = data.vouchers.map(function (voucher) {
      if (
        toBoolean(voucher.autoRenew) &&
        Number(voucher.renewDay || 1) === todayDay &&
        Number(voucher.used || 0) > 0 &&
        String(voucher.lastRenewedDate || '') !== todayIso
      ) {
        voucher.used = 0;
        voucher.lastRenewedDate = todayIso;
        renewed += 1;
      }
      return voucher;
    });

    const notifications = data.notifications.slice();
    const notificationHistory = data.notificationHistory.slice();
    if (posted > 0 && !notifications.some(function (item) { return item.key === 'daily-post:' + todayIso; })) {
      const notification = {
        id: Utilities.getUuid(),
        title: 'Recorrencias lancadas',
        message: posted + ' lancamento(s) automatico(s) criado(s).',
        type: 'info',
        createdAt: todayIso,
        read: false,
        key: 'daily-post:' + todayIso
      };
      notifications.unshift(notification);
      notificationHistory.unshift(notification);
    }
    if (renewed > 0 && !notifications.some(function (item) { return item.key === 'daily-voucher:' + todayIso; })) {
      const notification = {
        id: Utilities.getUuid(),
        title: 'Vales renovados',
        message: renewed + ' vale(s) renovado(s).',
        type: 'success',
        createdAt: todayIso,
        read: false,
        key: 'daily-voucher:' + todayIso
      };
      notifications.unshift(notification);
      notificationHistory.unshift(notification);
    }

    saveAll(ss, username, Object.assign({}, data, {
      transactions: transactions,
      recurrences: recurrences,
      vouchers: vouchers,
      notifications: notifications.slice(0, 80),
      notificationHistory: notificationHistory.slice(0, 500)
    }));

    return { posted: posted, renewed: renewed };
  }

  function nextDateForFrequency(date, frequency) {
    const parsed = new Date(String(date) + 'T00:00:00');
    if (frequency === 'weekly') parsed.setDate(parsed.getDate() + 7);
    else if (frequency === 'yearly') parsed.setFullYear(parsed.getFullYear() + 1);
    else parsed.setMonth(parsed.getMonth() + 1);
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  function installDailyTrigger() {
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (trigger) {
      if (trigger.getHandlerFunction() === 'dailyProcess') {
        ScriptApp.deleteTrigger(trigger);
      }
    });
    ScriptApp.newTrigger('dailyProcess')
      .timeBased()
      .everyDays(1)
      .atHour(3)
      .create();
    return 'Trigger instalado: dailyProcess executara diariamente.';
  }

  return {
    doGet: doGet,
    doPost: doPost,
    dailyProcess: dailyProcess,
    installDailyTrigger: installDailyTrigger
  };
}());

function doGet(e) {
  return NummiBackendRuntime.doGet(e);
}

function doPost(e) {
  return NummiBackendRuntime.doPost(e);
}

function dailyProcess() {
  return NummiBackendRuntime.dailyProcess();
}

function installDailyTrigger() {
  return NummiBackendRuntime.installDailyTrigger();
}
