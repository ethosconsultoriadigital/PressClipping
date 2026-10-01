/**
 * Ethos PR Intelligence — router de vistas derivadas desde MENCIONES_MASTER.
 *
 * MASTER es READ-ONLY. 08_Ruteo_Menciones es READ-ONLY.
 * Detection ≠ presentation: no reanaliza título/cuerpo.
 *
 * LAST_PROCESSED_MASTER_ROW = fila absoluta de Sheet (header=1).
 * Con 1 header + 286 noticias, lastRow=287 y lastProcessed=287.
 * Comparar lastRow < lastProcessed, NUNCA (lastRow-1) < lastProcessed.
 *
 * Full rebuild usa un snapshot de masterLastRow. Si MASTER crece durante el
 * rebuild, se termina el snapshot y el incremental posterior cubre filas nuevas.
 *
 * Bound esperado: ETHOS_MENCIONES_MASTER
 * Puerto de lógica: src/routing/mentionPresentation.ts + mentionRouterRuntime.ts
 */

var DEFAULT_CONTROL_PLANE_ID = '1aPGIO5zt5b2C1sdC2lOPsmjhcpudn_NvmlCJ8OW39es';
var DEFAULT_ROUTING_TAB = '08_Ruteo_Menciones';
var DEFAULT_MASTER_TAB = 'MENCIONES_MASTER';
var PENDING_TAB = '09_Ruteo_Pendiente';
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
  SpreadsheetApp.getUi().alert('Ethos router: PropertiesService listo. No instala trigger. Ejecuta Validate → DryRun → FullRebuild → InstallTrigger.');
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
  var lastRow = master.getLastRow();
  var decision = decideRouterRun_({
    requestedMode: 'incremental',
    routingHashNow: v.hash,
    routingHashApplied: p.getProperty('ROUTING_HASH'),
    masterLastRow: lastRow,
    lastProcessedMasterRow: Number(p.getProperty('LAST_PROCESSED_MASTER_ROW') || '1'),
    fullRebuildInProgress: p.getProperty('FULL_REBUILD_IN_PROGRESS') === 'true',
    fullRebuildTargetHash: p.getProperty('FULL_REBUILD_TARGET_HASH'),
    fullRebuildMasterLastRow: Number(p.getProperty('FULL_REBUILD_MASTER_LAST_ROW') || '0'),
  });
  var status = {
    CONTROL_PLANE_ID: cfg_().controlPlaneId,
    INCLUDE_INTERNAL: cfg_().includeInternal,
    FULL_REBUILD_IN_PROGRESS: p.getProperty('FULL_REBUILD_IN_PROGRESS') === 'true',
    FULL_REBUILD_NEXT_VIEW: p.getProperty('FULL_REBUILD_NEXT_VIEW_INDEX'),
    MASTER_LAST_ROW: lastRow,
    LAST_PROCESSED_MASTER_ROW: p.getProperty('LAST_PROCESSED_MASTER_ROW'),
    ROUTING_HASH_CURRENT: v.hash,
    ROUTING_HASH_APPLIED: p.getProperty('ROUTING_HASH'),
    ACTIVE_VIEWS: v.ok ? activeViewNames_(v.routes, cfg_().includeInternal) : [],
    ACTIVE_KEYWORDS_WITHOUT_ROUTE: v.report.active_keywords_without_route || [],
    ROUTE_FOR_INACTIVE_KEYWORD: v.report.route_for_inactive_keyword || [],
    LAST_RUN_MODE: p.getProperty('LAST_RUN_MODE'),
    LAST_RUN_VERDICT: p.getProperty('LAST_RUN_VERDICT'),
    NEXT_RUN_MODE: decision.mode,
    FULL_REBUILD_REQUIRED: decision.needFull,
    FULL_REBUILD_REASON: decision.reason,
    INVALID: !v.ok,
  };
  Logger.log(JSON.stringify(status, null, 2));
  if (v.ok) refreshPendingTab_(v);
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
    var plan = routeMasterRows_(pack.rows, v.routes, cfg_().includeInternal);
    var p = props_();
    var decision = decideRouterRun_({
      requestedMode: 'incremental',
      routingHashNow: v.hash,
      routingHashApplied: p.getProperty('ROUTING_HASH'),
      masterLastRow: masterSheet_().getLastRow(),
      lastProcessedMasterRow: Number(p.getProperty('LAST_PROCESSED_MASTER_ROW') || '1'),
      fullRebuildInProgress: p.getProperty('FULL_REBUILD_IN_PROGRESS') === 'true',
      fullRebuildTargetHash: p.getProperty('FULL_REBUILD_TARGET_HASH'),
      fullRebuildMasterLastRow: Number(p.getProperty('FULL_REBUILD_MASTER_LAST_ROW') || '0'),
    });
    var pending = buildPending_(plan, v);
    var activeRoutes = v.routes.filter(function (r) {
      return r.activo && (cfg_().includeInternal || r.vista_tipo !== 'INTERNO');
    });
    var unique = {};
    plan.routed.forEach(function (r) { unique[r.dedupe_key] = true; });
    var out = {
      ok: true,
      master_rows: pack.rows.length,
      active_route_count: activeRoutes.length,
      active_view_count: activeViewNames_(v.routes, cfg_().includeInternal).length,
      routed_unique_master_rows: Object.keys(unique).length,
      routed_output_rows: plan.routed.length,
      excluded_internal_rows: plan.unrouted.filter(function (u) { return u.reason === 'EXCLUDED_INTERNAL'; }).length,
      unknown_route_rows: plan.unrouted.filter(function (u) { return u.reason === 'UNKNOWN_KEYWORD_ROUTE'; }).length,
      active_keywords_without_route: v.report.active_keywords_without_route || [],
      multi_view_master_rows: plan.multiView,
      duplicate_suppressed: plan.duplicateSuppressed,
      full_rebuild_required: decision.needFull,
      full_rebuild_reason: decision.reason,
      rows_per_view: plan.rowsPerView,
      pending: pending,
    };
    Logger.log(JSON.stringify(out, null, 2));
    refreshPendingTab_(v, pending);
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

function decideRouterRun_(input) {
  var lastProcessed = input.lastProcessedMasterRow;
  if (input.fullRebuildInProgress) {
    if (input.fullRebuildTargetHash && input.fullRebuildTargetHash !== input.routingHashNow) {
      return { mode: 'full', needFull: true, reason: 'HASH_CHANGED_DURING_REBUILD' };
    }
    var snap = input.fullRebuildMasterLastRow || 0;
    if (snap > 0 && input.masterLastRow < snap) {
      return { mode: 'full', needFull: true, reason: 'MASTER_SHRANK_DURING_REBUILD' };
    }
    return { mode: 'resume_full', needFull: true, reason: 'RESUME_FULL_REBUILD' };
  }
  if (input.requestedMode === 'full') return { mode: 'full', needFull: true, reason: 'REQUESTED_FULL' };
  if (!input.routingHashApplied) return { mode: 'full', needFull: true, reason: 'FIRST_RUN' };
  if (input.routingHashApplied !== input.routingHashNow) return { mode: 'full', needFull: true, reason: 'ROUTING_HASH_CHANGED' };
  if (input.masterLastRow < lastProcessed) return { mode: 'full', needFull: true, reason: 'MASTER_SHRANK' };
  if (lastProcessed <= 1) return { mode: 'full', needFull: true, reason: 'FIRST_RUN' };
  return { mode: 'incremental', needFull: false, reason: null };
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
      props_().setProperty('LAST_RUN_VERDICT', 'CONTROL_PLANE_ROUTING_INVALID');
      return;
    }
    var p = props_();
    var master = masterSheet_();
    var lastRow = master.getLastRow();
    var decision = decideRouterRun_({
      requestedMode: mode,
      routingHashNow: v.hash,
      routingHashApplied: p.getProperty('ROUTING_HASH'),
      masterLastRow: lastRow,
      lastProcessedMasterRow: Number(p.getProperty('LAST_PROCESSED_MASTER_ROW') || '1'),
      fullRebuildInProgress: p.getProperty('FULL_REBUILD_IN_PROGRESS') === 'true',
      fullRebuildTargetHash: p.getProperty('FULL_REBUILD_TARGET_HASH'),
      fullRebuildMasterLastRow: Number(p.getProperty('FULL_REBUILD_MASTER_LAST_ROW') || '0'),
    });
    var pack = readMaster_();
    var viewHeaders = orderViewHeaders_(pack.headers);
    var activeNames = activeViewNames_(v.routes, cfg_().includeInternal);
    if (decision.needFull) {
      runFullRebuild_(v, pack, viewHeaders, activeNames, decision, lastRow, started);
    } else {
      writeIncremental_(pack, v.routes, viewHeaders, Number(p.getProperty('LAST_PROCESSED_MASTER_ROW') || '1'), started);
      markStaleViews_(activeNames);
      p.setProperty('LAST_PROCESSED_MASTER_ROW', String(lastRow));
      p.setProperty('LAST_RUN_MODE', 'incremental');
      p.setProperty('LAST_RUN_VERDICT', 'INCREMENTAL_DONE');
      Logger.log('INCREMENTAL_DONE');
    }
  } finally {
    lock.releaseLock();
  }
}

function runFullRebuild_(v, pack, viewHeaders, activeNames, decision, currentLastRow, started) {
  var p = props_();
  var startIndex = 0;
  var snapshotLastRow = currentLastRow;
  if (decision.mode === 'resume_full' && decision.reason === 'RESUME_FULL_REBUILD') {
    startIndex = Number(p.getProperty('FULL_REBUILD_NEXT_VIEW_INDEX') || '0');
    snapshotLastRow = Number(p.getProperty('FULL_REBUILD_MASTER_LAST_ROW') || currentLastRow);
  } else {
    p.setProperty('FULL_REBUILD_IN_PROGRESS', 'true');
    p.setProperty('FULL_REBUILD_TARGET_HASH', v.hash);
    p.setProperty('FULL_REBUILD_NEXT_VIEW_INDEX', '0');
    p.setProperty('FULL_REBUILD_MASTER_LAST_ROW', String(snapshotLastRow));
    p.setProperty('LAST_RUN_MODE', 'full');
    p.setProperty('LAST_RUN_VERDICT', 'FULL_REBUILD_IN_PROGRESS');
  }
  var snapshotRows = pack.rows.filter(function (r) { return r.sheetRow <= snapshotLastRow; });
  var plan = routeMasterRows_(snapshotRows, v.routes, cfg_().includeInternal);
  var result = writeFullViews_(activeNames, plan, viewHeaders, startIndex, started);
  if (!result.completed) {
    p.setProperty('FULL_REBUILD_IN_PROGRESS', 'true');
    p.setProperty('FULL_REBUILD_NEXT_VIEW_INDEX', String(result.next_view_index));
    p.setProperty('FULL_REBUILD_TARGET_HASH', v.hash);
    p.setProperty('FULL_REBUILD_MASTER_LAST_ROW', String(snapshotLastRow));
    p.setProperty('LAST_RUN_VERDICT', 'FULL_REBUILD_CHECKPOINT');
    Logger.log('FULL_REBUILD_CHECKPOINT next=' + result.next_view_index + ' remaining=' + result.remaining_views.join(','));
    return;
  }
  markStaleViews_(activeNames);
  p.setProperty('FULL_REBUILD_IN_PROGRESS', 'false');
  p.setProperty('FULL_REBUILD_NEXT_VIEW_INDEX', '0');
  p.setProperty('ROUTING_HASH', v.hash);
  p.setProperty('LAST_PROCESSED_MASTER_ROW', String(snapshotLastRow));
  p.setProperty('LAST_RUN_MODE', 'full');
  p.setProperty('LAST_RUN_VERDICT', 'FULL_REBUILD_DONE');
  Logger.log('FULL_REBUILD_DONE snapshotLastRow=' + snapshotLastRow);
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

function assertDerivedSheet_(sh) {
  var n = sh.getName();
  if (n === cfg_().masterTab || n === 'MENCIONES_MASTER') {
    throw new Error('MASTER_READ_ONLY');
  }
  if (n === '08_Ruteo_Menciones' || n === '02_Keywords' || n === '03_Clientes') {
    throw new Error('CONTROL_PLANE_SOURCE_READ_ONLY:' + n);
  }
}

function loadAndValidateRouting_() {
  var c = cfg_();
  var doc = SpreadsheetApp.openById(c.controlPlaneId);
  var sh = doc.getSheetByName(c.routingTab);
  if (!sh) {
    return { ok: false, routes: [], hash: '', keywords: [], report: { error: 'MISSING_ROUTING_TAB' } };
  }
  var values = sh.getDataRange().getDisplayValues();
  if (values.length < 2) {
    return { ok: false, routes: [], hash: '', keywords: [], report: { error: 'EMPTY_ROUTING' } };
  }
  var headers = values[0];
  var idx = headerIndex_(headers);
  var required = ['route_id', 'keyword_id', 'detection_scope_id', 'vista_tipo', 'vista_nombre', 'activo', 'prioridad', 'notas'];
  for (var r = 0; r < required.length; r++) {
    if (idx[required[r]] == null) {
      return { ok: false, routes: [], hash: '', keywords: [], report: { error: 'MISSING_HEADER', header: required[r] } };
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

  var catalog = readCatalog_(doc);
  var inactiveInfo = [];
  routes.forEach(function (rec) {
    var kw = catalog.keywords[rec.keyword_id.toUpperCase()];
    if (!kw) {
      issues.push('UNKNOWN_KEYWORD_ID:' + rec.route_id + ':' + rec.keyword_id);
      return;
    }
    if (!catalog.clientes[rec.detection_scope_id]) {
      issues.push('UNKNOWN_DETECTION_SCOPE_ID:' + rec.route_id + ':' + rec.detection_scope_id);
    }
    if (kw.cliente_id && rec.detection_scope_id && kw.cliente_id !== rec.detection_scope_id) {
      issues.push('KEYWORD_SCOPE_MISMATCH:' + rec.route_id);
    }
    if (rec.activo && !kw.activa) inactiveInfo.push(rec.route_id);
  });

  var hash = sha256Hex_(JSON.stringify(routes.map(function (x) {
    return [x.route_id, x.keyword_id, x.detection_scope_id, x.vista_tipo, x.vista_nombre, x.activo, x.prioridad, x.notas];
  }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); })));

  var kwWithout = activeKeywordsWithoutRoute_(catalog, routes, c.includeInternal);
  return {
    ok: issues.length === 0,
    routes: routes,
    hash: hash,
    keywords: catalog.list,
    report: {
      issues: issues,
      routes: routes.length,
      active_keywords_without_route: kwWithout,
      route_for_inactive_keyword: inactiveInfo,
    },
  };
}

function readCatalog_(controlDoc) {
  var keywords = {};
  var list = [];
  var clientes = {};
  var kwSh = controlDoc.getSheetByName('02_Keywords');
  if (kwSh) {
    var kv = kwSh.getDataRange().getDisplayValues();
    var ki = headerIndex_(kv[0] || []);
    for (var i = 1; i < kv.length; i++) {
      var id = String(kv[i][ki.keyword_id] || '').trim();
      if (!id) continue;
      var rec = {
        keyword_id: id,
        cliente_id: String(kv[i][ki.cliente_id] || '').trim(),
        activa: parseBoolCell_(kv[i][ki.activa]),
        keyword: String(kv[i][ki.keyword] || '').trim(),
      };
      keywords[id.toUpperCase()] = rec;
      list.push(rec);
    }
  }
  var clSh = controlDoc.getSheetByName('03_Clientes');
  if (clSh) {
    var cv = clSh.getDataRange().getDisplayValues();
    var ci = headerIndex_(cv[0] || []);
    for (var j = 1; j < cv.length; j++) {
      var cid = String(cv[j][ci.cliente_id] || '').trim();
      if (cid) clientes[cid] = true;
    }
  }
  return { keywords: keywords, list: list, clientes: clientes };
}

function activeKeywordsWithoutRoute_(catalog, routes, includeInternal) {
  var covered = {};
  routes.forEach(function (r) {
    if (!r.activo) return;
    if (!includeInternal && r.vista_tipo === 'INTERNO') return;
    covered[r.keyword_id.toUpperCase()] = true;
  });
  var missing = [];
  catalog.list.forEach(function (k) {
    if (!k.activa) return;
    if (k.cliente_id === 'CLI-PRUEBA') return;
    if (!covered[k.keyword_id.toUpperCase()]) missing.push(k.keyword_id);
  });
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

function routeMasterRows_(rows, routes, includeInternal) {
  var byKw = {};
  var skippedInternal = {};
  routes.forEach(function (r) {
    if (!r.activo) return;
    if (!includeInternal && r.vista_tipo === 'INTERNO') {
      skippedInternal[r.keyword_id.toUpperCase()] = true;
      return;
    }
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
      var excluded = ids.some(function (id) { return skippedInternal[id.toUpperCase()]; });
      unrouted.push({
        source: source,
        keyword_ids: ids,
        reason: excluded ? 'EXCLUDED_INTERNAL' : (ids.length ? 'UNKNOWN_KEYWORD_ROUTE' : 'NO_KEYWORD_ID'),
      });
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

function activeViewNames_(routes, includeInternal) {
  var names = {};
  routes.forEach(function (r) {
    if (!r.activo) return;
    if (!includeInternal && r.vista_tipo === 'INTERNO') return;
    names[r.vista_tipo + ' · ' + r.vista_nombre] = true;
  });
  return Object.keys(names).sort();
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

function writeFullViews_(activeNames, plan, viewHeaders, startIndex, started) {
  var processed = [];
  var next = startIndex;
  for (var i = startIndex; i < activeNames.length; i++) {
    if (Date.now() - started > MAX_MS) {
      return {
        completed: false,
        processed_views: processed,
        remaining_views: activeNames.slice(i),
        next_view_index: i,
      };
    }
    var name = activeNames[i];
    var lines = [];
    plan.routed.forEach(function (r) {
      if (r.view_name !== name) return;
      var line = [];
      for (var c = 0; c < viewHeaders.length; c++) line.push(r.source.values[viewHeaders[c]] || '');
      lines.push({ line: line, values: r.source.values, dedupe_key: r.dedupe_key });
    });
    var uniq = [];
    var seen = {};
    lines.forEach(function (item) {
      if (seen[item.dedupe_key]) return;
      seen[item.dedupe_key] = true;
      uniq.push(item);
    });
    uniq.sort(function (a, b) {
      var ka = String(a.values.fecha_publicacion || '') + '\t' + String(a.values.fecha_captura || '') + '\t' + String(a.values.matched_at || '');
      var kb = String(b.values.fecha_publicacion || '') + '\t' + String(b.values.fecha_captura || '') + '\t' + String(b.values.matched_at || '');
      return kb.localeCompare(ka);
    });
    writeViewSheet_(name, viewHeaders, uniq.map(function (x) { return x.line; }), true);
    processed.push(name);
    next = i + 1;
  }
  return {
    completed: true,
    processed_views: processed,
    remaining_views: [],
    next_view_index: next,
  };
}

function writeIncremental_(pack, routes, viewHeaders, lastProcessed, started) {
  var startRow = Math.max(2, lastProcessed - OVERLAP_ROWS + 1);
  var subset = pack.rows.filter(function (r) { return r.sheetRow >= startRow; });
  var subPlan = routeMasterRows_(subset, routes, cfg_().includeInternal);
  var byView = {};
  subPlan.routed.forEach(function (r) {
    if (!byView[r.view_name]) byView[r.view_name] = [];
    byView[r.view_name].push(r);
  });
  Object.keys(byView).forEach(function (name) {
    if (Date.now() - started > MAX_MS) return;
    upsertRewriteView_(name, viewHeaders, byView[name]);
  });
}

function upsertRewriteView_(name, viewHeaders, incoming) {
  var sh = ensureViewSheet_(name, viewHeaders);
  var existing = readDerivedRows_(sh, viewHeaders);
  var byKey = {};
  existing.forEach(function (item) {
    if (item.dedupe_key) byKey[item.dedupe_key] = item;
  });
  incoming.forEach(function (r) {
    var values = r.source.values;
    byKey[r.dedupe_key] = { dedupe_key: r.dedupe_key, values: values };
  });
  var rows = Object.keys(byKey).map(function (k) { return byKey[k]; });
  rows.sort(function (a, b) {
    var ka = String(a.values.fecha_publicacion || '') + '\t' + String(a.values.fecha_captura || '') + '\t' + String(a.values.matched_at || '');
    var kb = String(b.values.fecha_publicacion || '') + '\t' + String(b.values.fecha_captura || '') + '\t' + String(b.values.matched_at || '');
    return kb.localeCompare(ka);
  });
  var lines = rows.map(function (item) {
    return viewHeaders.map(function (h) { return item.values[h] || ''; });
  });
  writeViewSheet_(name, viewHeaders, lines, true);
}

function readDerivedRows_(sh, viewHeaders) {
  assertDerivedSheet_(sh);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, viewHeaders.length).getDisplayValues();
  var di = -1;
  for (var i = 0; i < viewHeaders.length; i++) {
    if (String(viewHeaders[i]).toLowerCase() === 'dedupe_key') di = i;
  }
  return vals.map(function (line) {
    var values = {};
    for (var c = 0; c < viewHeaders.length; c++) values[viewHeaders[c]] = line[c];
    return { dedupe_key: di >= 0 ? String(line[di] || '').trim() : '', values: values };
  });
}

function writeViewSheet_(name, headers, lines, rebuild) {
  var sh = ensureViewSheet_(name, headers);
  assertDerivedSheet_(sh);
  if (rebuild) {
    var last = Math.max(sh.getLastRow(), 2);
    var cols = Math.max(sh.getLastColumn(), headers.length);
    if (last >= 2) sh.getRange(2, 1, last - 1, cols).clearContent();
  }
  if (lines.length) {
    var chunk = 400;
    for (var i = 0; i < lines.length; i += chunk) {
      var part = lines.slice(i, i + chunk);
      var start = Math.max(sh.getLastRow() + 1, 2);
      sh.getRange(start, 1, part.length, headers.length).setValues(part);
    }
  }
  formatView_(sh, headers, true);
}

function ensureViewSheet_(name, headers) {
  if (name === cfg_().masterTab || name === 'MENCIONES_MASTER') {
    throw new Error('MASTER_READ_ONLY');
  }
  var ss = masterSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  assertDerivedSheet_(sh);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function formatView_(sh, headers, resetFilter) {
  assertDerivedSheet_(sh);
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

function markStaleViews_(activeNames) {
  var active = {};
  activeNames.forEach(function (n) { active[n] = true; });
  var ss = masterSpreadsheet_();
  ss.getSheets().forEach(function (sh) {
    var name = sh.getName();
    if (name === cfg_().masterTab) return;
    var managed = MANAGED_PREFIXES.some(function (p) { return name.indexOf(p) === 0; });
    if (!managed) return;
    if (active[name]) return;
    assertDerivedSheet_(sh);
    sh.getRange(1, 1).setNote(STALE_NOTE + ' — ' + VIEW_NOTE);
  });
}

function buildPending_(plan, v) {
  var agg = {};
  plan.unrouted.forEach(function (u) {
    var kid = (u.keyword_ids[0] || String(u.source.values.keyword_id || '')).trim();
    if (!agg[kid]) {
      agg[kid] = {
        keyword_id: kid,
        keyword: String(u.source.values.palabra || u.source.values.keywords_matched || ''),
        cliente_id: String(u.source.values.cliente_id || ''),
        count_master: 0,
        reason: u.reason,
      };
    }
    agg[kid].count_master++;
  });
  (v.report.active_keywords_without_route || []).forEach(function (id) {
    if (!agg[id]) {
      agg[id] = {
        keyword_id: id,
        keyword: '',
        cliente_id: '',
        count_master: 0,
        reason: 'ACTIVE_KEYWORD_WITHOUT_ROUTE',
      };
    }
  });
  return Object.keys(agg).sort().map(function (k) { return agg[k]; });
}

function refreshPendingTab_(v, pendingOpt) {
  try {
    var doc = SpreadsheetApp.openById(cfg_().controlPlaneId);
    var sh = doc.getSheetByName(PENDING_TAB);
    if (!sh) sh = doc.insertSheet(PENDING_TAB);
    var headers = ['keyword_id', 'keyword', 'cliente_id', 'count_master', 'reason'];
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    var last = Math.max(sh.getLastRow(), 2);
    if (last >= 2) sh.getRange(2, 1, last - 1, headers.length).clearContent();
    var pending = pendingOpt;
    if (!pending) {
      var pack = readMaster_();
      var plan = routeMasterRows_(pack.rows, v.routes, cfg_().includeInternal);
      pending = buildPending_(plan, v);
    }
    if (!pending.length) return;
    var lines = pending.map(function (p) {
      return [p.keyword_id, p.keyword, p.cliente_id, p.count_master, p.reason];
    });
    sh.getRange(2, 1, lines.length, headers.length).setValues(lines);
  } catch (err) {
    Logger.log('PENDING_TAB_SKIP ' + err);
  }
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
