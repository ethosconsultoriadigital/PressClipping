/**
 * Ethos PR Intelligence — router de vistas derivadas desde MENCIONES_MASTER.
 *
 * MASTER es READ-ONLY. 08_Ruteo_Menciones es READ-ONLY.
 * Detection ≠ presentation: no reanaliza título/cuerpo.
 *
 * Bound esperado: ETHOS_MENCIONES_MASTER
 * Puerto de lógica: src/routing/mentionPresentation.ts
 */

var DEFAULT_CONTROL_PLANE_ID = '1aPGIO5zt5b2C1sdC2lOPsmjhcpudn_NvmlCJ8OW39es';
var DEFAULT_ROUTING_TAB = '08_Ruteo_Menciones';
var DEFAULT_MASTER_TAB = 'MENCIONES_MASTER';
var VIEW_NOTE = 'VISTA DERIVADA — NO EDITAR COMO FUENTE DE VERDAD.';
var STALE_NOTE = 'VISTA SIN RUTA ACTIVA';
var ROW_HEIGHT = 30;
var OVERLAP_ROWS = 150;
var MAX_MS = 4.5 * 60 * 1000;
var VISTA_TIPOS = { CLIENTE: 1, PERSONA: 1, TEMA: 1, INTERNO: 1 };
var MANAGED_PREFIXES = ['CLIENTE · ', 'PERSONA · ', 'TEMA · '];
var COLS_FIRST = [
  'fecha_publicacion', 'fecha_captura', 'medio', 'titulo / titular', 'resumen', 'url',
  'sentimiento', 'tema', 'subtema', 'palabra', 'keywords_matched', 'tipo_mencion',
  'campo_match', 'score_relevancia', 'Valoracion del M', 'AUTOR',
];
var COLS_REST = [
  'NOTICIA', 'cliente_id', 'medio_id', 'keyword_id', 'keyword_ids_matched', 'match_count',
  'seccion', 'relevancia_ia', 'tipo_nota', 'calidad_extraccion', 'requiere_alerta',
  'estado_revision', 'matched_at', 'dedupe_key', 'latencia_minutos', 'estanteria',
  'horaPublicacion', 'HoraCaptura', 'nota completa',
];

function props_() {
  return PropertiesService.getScriptProperties();
}

function cfg_() {
  var p = props_();
  return {
    controlPlaneId: p.getProperty('CONTROL_PLANE_ID') || DEFAULT_CONTROL_PLANE_ID,
    routingTab: p.getProperty('ROUTING_TAB') || DEFAULT_ROUTING_TAB,
    masterTab: p.getProperty('MASTER_TAB') || DEFAULT_MASTER_TAB,
    includeInternal: String(p.getProperty('INCLUDE_INTERNAL') || 'false') === 'true',
  };
}

function ethosRouterSetup() {
  var p = props_();
  if (!p.getProperty('CONTROL_PLANE_ID')) p.setProperty('CONTROL_PLANE_ID', DEFAULT_CONTROL_PLANE_ID);
  if (!p.getProperty('ROUTING_TAB')) p.setProperty('ROUTING_TAB', DEFAULT_ROUTING_TAB);
  if (!p.getProperty('MASTER_TAB')) p.setProperty('MASTER_TAB', DEFAULT_MASTER_TAB);
  if (!p.getProperty('INCLUDE_INTERNAL')) p.setProperty('INCLUDE_INTERNAL', 'false');
  SpreadsheetApp.getUi().alert('Ethos router: PropertiesService listo. Ejecuta ethosRouterValidate() y luego ethosRouterFullRebuild().');
}

function ethosRouterInstallTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'ethosRouterSync') {
      SpreadsheetApp.getUi().alert('Trigger ethosRouterSync ya existe. No se duplicó.');
      return;
    }
  }
  ScriptApp.newTrigger('ethosRouterSync').timeBased().everyMinutes(10).create();
  SpreadsheetApp.getUi().alert('Trigger instalado: ethosRouterSync cada 10 minutos.');
}

function ethosRouterRemoveTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'ethosRouterSync') {
      ScriptApp.deleteTrigger(existing[i]);
      n++;
    }
  }
  SpreadsheetApp.getUi().alert('Triggers eliminados: ' + n);
}

function ethosRouterValidate() {
  var v = loadAndValidateRouting_();
  Logger.log(JSON.stringify(v.report, null, 2));
  return v.ok;
}

function ethosRouterStatus() {
  var p = props_();
  var v = loadAndValidateRouting_();
  var master = masterSheet_();
  var status = {
    CONTROL_PLANE_ID: cfg_().controlPlaneId,
    INCLUDE_INTERNAL: cfg_().includeInternal,
    ROUTING_HASH: p.getProperty('ROUTING_HASH'),
    ROUTING_HASH_NOW: v.hash,
    LAST_PROCESSED_MASTER_ROW: p.getProperty('LAST_PROCESSED_MASTER_ROW'),
    MASTER_ROWS: Math.max(0, master.getLastRow() - 1),
    ROUTES: v.routes.length,
    INVALID: !v.ok,
    ACTIVE_KEYWORDS_WITHOUT_ROUTE: v.report.active_keywords_without_route || [],
  };
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

function ethosRouterDryRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('DRY_RUN_SKIPPED_LOCK');
    return { ok: false, reason: 'LOCK' };
  }
  try {
    var v = loadAndValidateRouting_();
    if (!v.ok) return { ok: false, validation: v.report };
    var pack = readMaster_();
    var plan = routeMasterRows_(pack.rows, pack.headers, v.routes, cfg_().includeInternal);
    var out = {
      ok: true,
      master_rows: pack.rows.length,
      routed_rows: plan.routed.length,
      unrouted_rows: plan.unrouted.length,
      destinations: Object.keys(plan.rowsPerView),
      rows_per_view: plan.rowsPerView,
      multi_view_rows: plan.multiView,
      duplicate_suppressed: plan.duplicateSuppressed,
    };
    Logger.log(JSON.stringify(out, null, 2));
    return out;
  } finally {
    lock.releaseLock();
  }
}

function ethosRouterSync() {
  runRouter_('incremental');
}

function ethosRouterFullRebuild() {
  runRouter_('full');
}

function runRouter_(mode) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    Logger.log('ROUTER_SKIPPED_LOCK');
    return;
  }
  var started = Date.now();
  try {
    var v = loadAndValidateRouting_();
    if (!v.ok) {
      Logger.log('CONTROL_PLANE_ROUTING_INVALID — vistas no modificadas');
      Logger.log(JSON.stringify(v.report));
      return;
    }
    var p = props_();
    var prevHash = p.getProperty('ROUTING_HASH');
    var master = masterSheet_();
    var lastRow = master.getLastRow();
    var masterCount = Math.max(0, lastRow - 1);
    var lastProcessed = Number(p.getProperty('LAST_PROCESSED_MASTER_ROW') || '1');
    var needFull = mode === 'full' || !prevHash || prevHash !== v.hash || masterCount < lastProcessed;
    var pack = readMaster_();
    var plan = routeMasterRows_(pack.rows, pack.headers, v.routes, cfg_().includeInternal);
    var viewHeaders = orderViewHeaders_(pack.headers);
    var byView = groupByView_(plan.routed, viewHeaders);
    var activeViews = {};
    Object.keys(byView).forEach(function (name) { activeViews[name] = true; });
    if (needFull) {
      writeFullViews_(byView, viewHeaders, activeViews, started);
    } else {
      writeIncremental_(pack, plan, viewHeaders, lastProcessed, started);
    }
    markStaleViews_(activeViews);
    p.setProperty('ROUTING_HASH', v.hash);
    p.setProperty('LAST_PROCESSED_MASTER_ROW', String(master.getLastRow()));
    Logger.log(needFull ? 'FULL_REBUILD_DONE' : 'INCREMENTAL_DONE');
  } finally {
    lock.releaseLock();
  }
}

function masterSpreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function masterSheet_() {
  var ss = masterSpreadsheet_();
  var sh = ss.getSheetByName(cfg_().masterTab);
  if (!sh) throw new Error('No existe pestaña MASTER: ' + cfg_().masterTab);
  return sh;
}

function loadAndValidateRouting_() {
  var c = cfg_();
  var doc = SpreadsheetApp.openById(c.controlPlaneId);
  var sh = doc.getSheetByName(c.routingTab);
  if (!sh) {
    return { ok: false, routes: [], hash: '', report: { error: 'MISSING_ROUTING_TAB' } };
  }
  var values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) {
    return { ok: false, routes: [], hash: '', report: { error: 'EMPTY_ROUTING' } };
  }
  var headers = values[0];
  var idx = headerIndex_(headers);
  var required = ['route_id', 'keyword_id', 'detection_scope_id', 'vista_tipo', 'vista_nombre', 'activo', 'prioridad', 'notas'];
  for (var r = 0; r < required.length; r++) {
    if (idx[required[r]] == null) {
      return { ok: false, routes: [], hash: '', report: { error: 'MISSING_HEADER', header: required[r] } };
    }
  }
  var routes = [];
  var issues = [];
  var idCounts = {};
  var keyCounts = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var rec = {
      route_id: String(row[idx.route_id] || '').trim(),
      keyword_id: String(row[idx.keyword_id] || '').trim(),
      detection_scope_id: String(row[idx.detection_scope_id] || '').trim(),
      vista_tipo: String(row[idx.vista_tipo] || '').trim().toUpperCase(),
      vista_nombre: String(row[idx.vista_nombre] || '').trim(),
      activo: parseBoolCell_(row[idx.activo]),
      activoRaw: String(row[idx.activo] || ''),
      prioridad: String(row[idx.prioridad] || '').trim(),
      notas: String(row[idx.notas] || '').trim(),
    };
    if (!rec.route_id && !rec.keyword_id) continue;
    if (!rec.route_id) issues.push('BLANK_ROUTE_ID:' + (i + 1));
    if (!rec.keyword_id) issues.push('INVALID_KEYWORD_ID:' + rec.route_id);
    if (!VISTA_TIPOS[rec.vista_tipo]) issues.push('INVALID_VISTA_TIPO:' + rec.route_id);
    if (!rec.vista_nombre) issues.push('BLANK_VISTA_NOMBRE:' + rec.route_id);
    if (!isBoolCell_(rec.activoRaw)) issues.push('INVALID_ACTIVO:' + rec.route_id);
    idCounts[rec.route_id] = (idCounts[rec.route_id] || 0) + 1;
    var rk = rec.keyword_id.toUpperCase() + '|' + rec.vista_tipo + '|' + rec.vista_nombre;
    keyCounts[rk] = (keyCounts[rk] || 0) + 1;
    routes.push(rec);
  }
  Object.keys(idCounts).forEach(function (id) {
    if (idCounts[id] > 1) issues.push('DUPLICATE_ROUTE_ID:' + id);
  });
  Object.keys(keyCounts).forEach(function (k) {
    if (keyCounts[k] > 1) issues.push('DUPLICATE_ROUTE_KEY:' + k);
  });
  var hash = sha256Hex_(JSON.stringify(routes.map(function (x) {
    return [x.route_id, x.keyword_id, x.detection_scope_id, x.vista_tipo, x.vista_nombre, x.activo, x.prioridad, x.notas];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); })));

  var kwWithout = activeKeywordsWithoutRoute_(doc, routes, c.includeInternal);
  return {
    ok: issues.length === 0,
    routes: routes,
    hash: hash,
    report: {
      issues: issues,
      routes: routes.length,
      active_keywords_without_route: kwWithout,
    },
  };
}

function activeKeywordsWithoutRoute_(controlDoc, routes, includeInternal) {
  var sh = controlDoc.getSheetByName('02_Keywords');
  if (!sh) return [];
  var values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) return [];
  var idx = headerIndex_(values[0]);
  var covered = {};
  routes.forEach(function (r) {
    if (!r.activo) return;
    if (!includeInternal && r.vista_tipo === 'INTERNO') return;
    covered[r.keyword_id.toUpperCase()] = true;
  });
  var missing = [];
  for (var i = 1; i < values.length; i++) {
    var id = String(values[i][idx.keyword_id] || '').trim();
    if (!id) continue;
    var activa = parseBoolCell_(values[i][idx.activa]);
    if (!activa) continue;
    var cliente = String(values[i][idx.cliente_id] || '').trim();
    if (cliente === 'CLI-PRUEBA') continue;
    if (!covered[id.toUpperCase()]) missing.push(id);
  }
  return missing;
}

function readMaster_() {
  var sh = masterSheet_();
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1) return { headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var rec = {};
    for (var c = 0; c < headers.length; c++) rec[headers[c]] = values[i][c];
    rows.push({ values: rec, sheetRow: i + 1 });
  }
  return { headers: headers, rows: rows };
}

function parseKeywordIdsMatched_(raw, fallback) {
  var s = String(raw || '').trim();
  var parts = s.split(/[|,;]+/);
  var out = [];
  var seen = {};
  for (var i = 0; i < parts.length; i++) {
    var p = String(parts[i] || '').trim();
    if (!p) continue;
    var k = p.toUpperCase();
    if (seen[k]) continue;
    seen[k] = true;
    out.push(p);
  }
  if (out.length) return out;
  var fb = String(fallback || '').trim();
  return fb ? [fb] : [];
}

function masterDedupeKey_(row) {
  var explicit = String(row.dedupe_key || '').trim();
  if (explicit) return explicit;
  var cliente = String(row.cliente_id || '').trim();
  var noticia = String(row.NOTICIA || row.noticia || '').trim();
  if (cliente && noticia) return cliente + '//' + noticia;
  if (noticia) return noticia;
  return '';
}

function routeMasterRows_(rows, headers, routes, includeInternal) {
  var byKw = {};
  routes.forEach(function (r) {
    if (!r.activo) return;
    if (!includeInternal && r.vista_tipo === 'INTERNO') return;
    var k = r.keyword_id.toUpperCase();
    if (!byKw[k]) byKw[k] = [];
    byKw[k].push(r);
  });
  var routed = [];
  var unrouted = [];
  var duplicateSuppressed = 0;
  var seen = {};
  var viewsByMaster = {};
  rows.forEach(function (source) {
    var ids = parseKeywordIdsMatched_(source.values.keyword_ids_matched, source.values.keyword_id);
    var dests = [];
    var destKeys = {};
    ids.forEach(function (id) {
      var matches = byKw[id.toUpperCase()] || [];
      matches.forEach(function (r) {
        var dk = r.keyword_id.toUpperCase() + '|' + r.vista_tipo + '|' + r.vista_nombre;
        if (destKeys[dk]) return;
        destKeys[dk] = true;
        dests.push(r);
      });
    });
    var masterKey = masterDedupeKey_(source.values) || ('row:' + source.sheetRow);
    if (!dests.length) {
      unrouted.push({ source: source, keyword_ids: ids, reason: ids.length ? 'UNKNOWN_KEYWORD_ROUTE' : 'NO_KEYWORD_ID' });
      return;
    }
    if (!viewsByMaster[masterKey]) viewsByMaster[masterKey] = {};
    dests.forEach(function (r) {
      var viewName = r.vista_tipo + ' · ' + r.vista_nombre;
      var uniq = r.vista_tipo + '|' + r.vista_nombre + '|' + masterKey;
      if (seen[uniq]) {
        duplicateSuppressed++;
        return;
      }
      seen[uniq] = true;
      viewsByMaster[masterKey][viewName] = true;
      routed.push({ view_name: viewName, source: source, dedupe_key: masterKey });
    });
  });
  var rowsPerView = {};
  routed.forEach(function (r) {
    rowsPerView[r.view_name] = (rowsPerView[r.view_name] || 0) + 1;
  });
  var multiView = 0;
  Object.keys(viewsByMaster).forEach(function (k) {
    if (Object.keys(viewsByMaster[k]).length > 1) multiView++;
  });
  return {
    routed: routed,
    unrouted: unrouted,
    duplicateSuppressed: duplicateSuppressed,
    rowsPerView: rowsPerView,
    multiView: multiView,
  };
}

function orderViewHeaders_(masterHeaders) {
  var byNorm = {};
  masterHeaders.forEach(function (h) { byNorm[String(h).trim().toLowerCase()] = h; });
  var used = {};
  var out = [];
  COLS_FIRST.concat(COLS_REST).forEach(function (want) {
    var hit = byNorm[want.toLowerCase()];
    if (hit && !used[hit]) {
      out.push(hit);
      used[hit] = true;
    }
  });
  masterHeaders.forEach(function (h) {
    if (!used[h]) out.push(h);
  });
  return out;
}

function groupByView_(routed, viewHeaders) {
  var by = {};
  routed.forEach(function (r) {
    if (!by[r.view_name]) by[r.view_name] = [];
    var line = [];
    for (var i = 0; i < viewHeaders.length; i++) {
      line.push(r.source.values[viewHeaders[i]] || '');
    }
    by[r.view_name].push({ line: line, values: r.source.values, dedupe_key: r.dedupe_key });
  });
  Object.keys(by).forEach(function (name) {
    by[name].sort(function (a, b) {
      var ka = String(a.values.fecha_publicacion || '') + '\t' + String(a.values.fecha_captura || '') + '\t' + String(a.values.matched_at || '');
      var kb = String(b.values.fecha_publicacion || '') + '\t' + String(b.values.fecha_captura || '') + '\t' + String(b.values.matched_at || '');
      return kb.localeCompare(ka);
    });
  });
  return by;
}

function writeFullViews_(byView, viewHeaders, activeViews, started) {
  var names = Object.keys(byView);
  for (var i = 0; i < names.length; i++) {
    if (Date.now() - started > MAX_MS) {
      Logger.log('FULL_REBUILD_CHECKPOINT ' + names[i]);
      return;
    }
    writeViewSheet_(names[i], viewHeaders, byView[names[i]].map(function (x) { return x.line; }), true);
  }
}

function writeIncremental_(pack, plan, viewHeaders, lastProcessed, started) {
  var startRow = Math.max(2, lastProcessed - OVERLAP_ROWS + 1);
  var subset = pack.rows.filter(function (r) { return r.sheetRow >= startRow; });
  var subPlan = routeMasterRows_(subset, pack.headers, loadAndValidateRouting_().routes, cfg_().includeInternal);
  var byView = groupByView_(subPlan.routed, viewHeaders);
  Object.keys(byView).forEach(function (name) {
    if (Date.now() - started > MAX_MS) return;
    var sh = ensureViewSheet_(name, viewHeaders);
    var existing = existingDedupe_(sh, viewHeaders);
    var add = [];
    byView[name].forEach(function (item) {
      if (!existing[item.dedupe_key]) add.push(item.line);
    });
    if (!add.length) return;
    appendValues_(sh, add);
    formatView_(sh, viewHeaders, false);
  });
}

function existingDedupe_(sh, viewHeaders) {
  var map = {};
  var last = sh.getLastRow();
  if (last < 2) return map;
  var di = -1;
  for (var i = 0; i < viewHeaders.length; i++) {
    if (String(viewHeaders[i]).toLowerCase() === 'dedupe_key') di = i;
  }
  if (di < 0) return map;
  var vals = sh.getRange(2, di + 1, last - 1, 1).getDisplayValues();
  for (var r = 0; r < vals.length; r++) {
    var k = String(vals[r][0] || '').trim();
    if (k) map[k] = true;
  }
  return map;
}

function writeViewSheet_(name, headers, lines, rebuild) {
  var sh = ensureViewSheet_(name, headers);
  if (rebuild) {
    var last = Math.max(sh.getLastRow(), 2);
    var cols = Math.max(sh.getLastColumn(), headers.length);
    if (last >= 2) sh.getRange(2, 1, last - 1, cols).clearContent();
  }
  if (lines.length) {
    var chunk = 400;
    for (var i = 0; i < lines.length; i += chunk) {
      var part = lines.slice(i, i + chunk);
      var start = sh.getLastRow() + 1;
      if (start < 2) start = 2;
      sh.getRange(start, 1, part.length, headers.length).setValues(part);
    }
  }
  formatView_(sh, headers, true);
}

function ensureViewSheet_(name, headers) {
  var ss = masterSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  var needHeader = sh.getLastRow() < 1;
  if (!needHeader) {
    var h = sh.getRange(1, 1, 1, Math.max(headers.length, sh.getLastColumn())).getDisplayValues()[0];
    if (!h[0]) needHeader = true;
  }
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function appendValues_(sh, lines) {
  if (!lines.length) return;
  var start = Math.max(sh.getLastRow() + 1, 2);
  sh.getRange(start, 1, lines.length, lines[0].length).setValues(lines);
}

function formatView_(sh, headers, resetFilter) {
  var lastCol = headers.length;
  var lastRow = Math.max(sh.getLastRow(), 1);
  sh.setFrozenRows(1);
  var header = sh.getRange(1, 1, 1, lastCol);
  header.setFontWeight('bold');
  header.setNote(VIEW_NOTE);
  sh.getRange(1, 1, lastRow, lastCol)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP)
    .setVerticalAlignment('middle');
  if (lastRow >= 2) {
    sh.setRowHeights(2, lastRow - 1, ROW_HEIGHT);
  }
  var noteCol = -1;
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).toLowerCase() === 'nota completa') noteCol = i + 1;
  }
  if (noteCol > 0) sh.hideColumns(noteCol);
  if (resetFilter) {
    var existing = sh.getFilter();
    if (existing) existing.remove();
    sh.getRange(1, 1, Math.max(lastRow, 1), lastCol).createFilter();
  }
}

function markStaleViews_(activeViews) {
  var ss = masterSpreadsheet_();
  var sheets = ss.getSheets();
  sheets.forEach(function (sh) {
    var name = sh.getName();
    var managed = MANAGED_PREFIXES.some(function (p) { return name.indexOf(p) === 0; });
    if (!managed) return;
    if (activeViews[name]) return;
    sh.getRange(1, 1).setNote(STALE_NOTE + ' — ' + VIEW_NOTE);
  });
}

function headerIndex_(headers) {
  var idx = {};
  for (var i = 0; i < headers.length; i++) {
    var n = String(headers[i] || '').trim().toLowerCase();
    idx[n] = i;
    idx[String(headers[i] || '').trim()] = i;
  }
  return idx;
}

function isBoolCell_(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return true;
  return ['true', 'false', '1', '0', 'si', 'sí', 'yes', 'no', 'y', 'n', 'verdadero', 'falso', 'x', 'activo', 'inactivo'].indexOf(s) >= 0;
}

function parseBoolCell_(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (['true', '1', 'si', 'sí', 'yes', 'y', 'verdadero', 'x', 'activo'].indexOf(s) >= 0) return true;
  return false;
}

function sha256Hex_(s) {
  var raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < raw.length; i++) {
    var b = raw[i];
    if (b < 0) b += 256;
    var h = b.toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}
