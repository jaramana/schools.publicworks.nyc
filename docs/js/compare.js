/* Side-by-side comparison of a shortlist of schools.
   ------------------------------------------------------------------
   Schools are columns and measures are rows. Every slot shows from the start,
   hollow until a school fills it, so the table never changes shape.

   Factual only. Every row is one published measure, each cell states the year
   it comes from when the schools disagree, and no school is marked as better
   than another. Figures are plain. The City scores each school against its own
   comparison group, so its bands stay on the profile and never sit side by
   side here. */

(function () {
  'use strict';

  var chosen = [];
  var loaded = {};
  var peers = {};           // peer files by slug, for saying why a value is missing
  var metrics = null;
  var maxSchools = 5;

  // One row is one measure. Where the City publishes a measure separately for
  // each report type, such as attendance for elementary and for high schools,
  // the versions share a row and each school reads its own.
  var rows = {};            // row id -> row
  var rowOf = {};           // metric id -> row id
  var rowOrder = [];        // row ids in the profile's order
  var picked = [];          // row ids on the sheet, in rowOrder
  var shown = [];           // row ids drawn last, for the download

  // Rows and schools that just arrived. They flash once so a reader sees
  // where they landed.
  var fresh = { rows: {}, schools: {} };

  // One measure from each part of a profile, so the first view is useful.
  var DEFAULT_MEASURES = [
    'qr_impact', 'qr_performance',
    'qr_rating_instruction', 'qr_rating_climate', 'qr_rating_families',
    'demo_economic_need_index',
    'attendance_k8_all', 'chronic_absent_ems_all',
    'prof_pct_ela_all', 'prof_pct_mth_all',
    'grad_pct_4_all', 'ccr_4yr_all'
  ];

  var SEARCH_PLACEHOLDER = 'Add a school by name or DBN…';

  function reduceMotion() {
    return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function say(text) {
    document.getElementById('compare-status').textContent = text;
  }

  // ---- Rows ---------------------------------------------------------------

  // Versions share a row only when each covers different report types.
  // Measures that share a heading but describe different things, such as a
  // school's share of a group beside its district's, stay apart.
  function disjoint(ids) {
    var seen = {};
    return ids.every(function (id) {
      return (metrics[id].applies_to || []).every(function (r) {
        if (seen[r]) return false;
        seen[r] = true;
        return true;
      });
    });
  }

  function baseOf(metric, id) {
    return metric.base_id || metric.category + ':' + id;
  }

  function buildRows() {
    // A measure's heading ranks the way the profile ranks it.
    var bases = {};
    var byKey = {};
    var keys = [];
    Object.keys(metrics).forEach(function (id) {
      var m = metrics[id];
      var b = baseOf(m, id);
      var base = bases[b] || (bases[b] = {
        label: m.base_label || m.label, rank: m.theme_rank, headline: false
      });
      base.rank = Math.min(base.rank, m.theme_rank);
      if (m.headline) base.headline = true;

      var key = b + '|' + (m.subgroup || '');
      if (!byKey[key]) { byKey[key] = []; keys.push(key); }
      byKey[key].push(id);
    });

    keys.forEach(function (key) {
      var ids = byKey[key];
      var sets = disjoint(ids) ? [ids] : ids.map(function (id) { return [id]; });
      sets.forEach(function (set) {
        var first = metrics[set[0]];
        var b = baseOf(first, set[0]);
        // The row's id is the version most schools read.
        var id = set.filter(function (i) {
          return (metrics[i].applies_to || []).indexOf('EMS') !== -1;
        })[0] || set[0];
        rows[id] = {
          id: id, ids: set,
          // Shared versions drop the report type the source appends.
          label: set.length > 1 ? first.label.replace(/\s*\([^)]*\)\s*$/, '') : first.label,
          category: first.category, categoryLabel: first.category_label || first.category,
          base: b, baseLabel: bases[b].label,
          rank: bases[b].rank, headline: bases[b].headline,
          whole: !first.subgroup || first.theme === 'all',
          theme: first.theme
        };
        set.forEach(function (i) { rowOf[i] = id; });
      });
    });

    // The profile's order: topic, then headline measures, then A to Z, with a
    // measure's student groups after its all-students figure.
    var cats = SF.display.category_order || [];
    var themes = SF.display.theme_order || [];
    function at(list, v) { var i = list.indexOf(v); return i === -1 ? list.length : i; }
    rowOrder = Object.keys(rows).sort(function (x, y) {
      var a = rows[x], b = rows[y];
      return at(cats, a.category) - at(cats, b.category) ||
        a.categoryLabel.localeCompare(b.categoryLabel) ||
        a.rank - b.rank ||
        (a.headline === b.headline ? 0 : a.headline ? -1 : 1) ||
        a.baseLabel.localeCompare(b.baseLabel) ||
        a.base.localeCompare(b.base) ||
        (a.whole === b.whole ? 0 : a.whole ? -1 : 1) ||
        at(themes, a.theme) - at(themes, b.theme) ||
        a.label.localeCompare(b.label, 'en', { numeric: true });
    });
  }

  // Any measure ids, as row ids in the profile's order.
  function inOrder(ids) {
    var want = {};
    ids.forEach(function (id) { if (rowOf[id]) want[rowOf[id]] = true; });
    return rowOrder.filter(function (id) { return want[id]; });
  }

  function defaults() { return inOrder(DEFAULT_MEASURES); }

  // ---- State in the address bar -------------------------------------------

  function readParams() {
    var raw = SF.param('schools');
    var list = raw ? raw.split(',') : SF.store.get('compare', []);
    chosen = list.map(function (s) { return String(s).trim().toUpperCase(); })
      .filter(function (s) { return /^\d{2}[MXKQR]\d{3}$/.test(s); })
      .filter(function (s, i, a) { return a.indexOf(s) === i; })
      .slice(0, maxSchools);

    var measures = SF.param('measures');
    picked = measures ? inOrder(measures.split(',')) : defaults();
  }

  function syncUrl() {
    SF.setParam('schools', chosen.join(','), true);
    SF.setParam('measures', picked.join(','), true);
    SF.store.set('compare', chosen);
  }

  // ---- Reading a value -----------------------------------------------------

  // A value and the year it describes travel together. Comparing a 2024-25
  // figure against a 2019-20 one without saying so is the easiest way to
  // mislead with this data.
  function latestPoint(series, reportType) {
    if (!series) return null;
    for (var i = series.y.length - 1; i >= 0; i--) {
      if (series.rt && reportType && series.rt[i] !== reportType) continue;
      if (!SF.isBlank(series.v[i])) {
        return {
          year: series.y[i], value: series.v[i],
          n: series.n ? series.n[i] : null,
          score: series.s ? series.s[i] : null,
          word: series.t ? series.t[i] : null
        };
      }
      // A bound the source published, such as "Above 95%", is a value for
      // reading purposes even though it cannot be sorted as a number.
      if (series.bd && series.bd[i]) {
        return { year: series.y[i], value: null, bound: series.bd[i], n: null, score: null };
      }
    }
    // No figure in any year. The reason is still worth carrying: a value the
    // City withheld because too few students are in the group is not the same
    // as one it never published, and a dash would say neither.
    for (var j = series.y.length - 1; j >= 0; j--) {
      if (series.rt && reportType && series.rt[j] !== reportType) continue;
      return { year: series.y[j], value: null, n: null, score: null,
               status: series.st ? series.st[j] : 'missing' };
    }
    return null;
  }

  function appliesTo(id, types) {
    return (metrics[id].applies_to || []).some(function (r) { return types.indexOf(r) !== -1; });
  }

  // The version of a row this school reads: the one for its own report, then
  // any it has figures in.
  function variantFor(row, payload) {
    if (row.ids.length === 1) return row.ids[0];
    var series = payload.series || {};
    var own = [payload.school.report_type];
    var mine = SF.reportTypesOf(payload.school);
    return row.ids.filter(function (id) { return series[id] && appliesTo(id, own); })[0] ||
      row.ids.filter(function (id) { return series[id] && appliesTo(id, mine); })[0] ||
      row.ids.filter(function (id) { return series[id]; })[0] ||
      row.ids.filter(function (id) { return appliesTo(id, own); })[0] ||
      row.ids[0];
  }

  // A cell is a figure, or the reason there is none.
  function cellFor(row, payload) {
    var id = variantFor(row, payload);
    var point = latestPoint((payload.series || {})[id], payload.school.report_type);
    if (point && !point.status) return { id: id, point: point };
    var status = point ? point.status
      : SF.absenceOf(id, metrics[id], payload.school, payload.peer_types, peers);
    return { id: id, point: null, status: status };
  }

  function hasFigure(row, payload) {
    var series = payload.series || {};
    return row.ids.some(function (id) {
      var point = latestPoint(series[id], payload.school.report_type);
      return point && !point.status;
    });
  }

  // ---- Schools --------------------------------------------------------------

  // The schools that are chosen and whose profiles have arrived, in the order
  // they were chosen.
  function loadedPayloads() {
    return chosen.map(function (d) { return loaded[d]; }).filter(Boolean);
  }

  function nameOf(dbn) {
    return loaded[dbn] ? (loaded[dbn].school.name || dbn) : dbn;
  }

  function slotsSaid() {
    return chosen.length + ' of ' + maxSchools + ' slots filled.';
  }

  function add(dbn, name) {
    if (chosen.indexOf(dbn) !== -1) return;
    if (chosen.length >= maxSchools) {
      say('All ' + maxSchools + ' slots are full. Remove a school before adding ' + (name || dbn) + '.');
      return;
    }
    chosen.push(dbn);
    fresh.schools[dbn] = true;
    syncUrl();
    loadAll().then(function () {
      draw();
      say('Added ' + nameOf(dbn) + '. ' + slotsSaid());
    });
  }

  function removeSchool(dbn, fromPin) {
    var slot = chosen.indexOf(dbn);
    var name = nameOf(dbn);
    chosen = chosen.filter(function (d) { return d !== dbn; });
    syncUrl();
    draw();
    say('Removed ' + name + '. ' + slotsSaid());
    // The keyboard stays in the slot it was in.
    if (fromPin) return;
    var heads = document.querySelectorAll('#sheet .sheet-wrap thead th.school-head');
    var next = heads[slot] && heads[slot].querySelector('button');
    if (next) next.focus();
  }

  function clearSchools() {
    chosen = [];
    syncUrl();
    draw();
    say('All schools removed.');
    focusSearch();
  }

  function focusSearch() {
    var input = document.querySelector('#compare-search input');
    if (input && !input.disabled) input.focus();
  }

  // ---- Toolbar --------------------------------------------------------------

  function renderBar() {
    var empty = !chosen.length;
    var count = document.getElementById('measures-count');
    count.textContent = picked.length;
    document.getElementById('measures-open').setAttribute('aria-label',
      'Choose measures, ' + picked.length + ' on the table');
    ['clear-schools', 'download-csv', 'copy-link'].forEach(function (id) {
      document.getElementById(id).disabled = empty;
    });

    // A full shortlist closes the search, and the box says why.
    var input = document.querySelector('#compare-search input');
    if (!input) return;
    var full = chosen.length >= maxSchools;
    input.disabled = full;
    input.placeholder = full
      ? 'All ' + maxSchools + ' slots are full. Remove a school to add another.'
      : SEARCH_PLACEHOLDER;
  }

  // ---- Drawing --------------------------------------------------------------

  function draw() {
    renderBar();
    renderSheet();
  }

  // Fixed facts about a school, in the order a reader asks for them. The DBN
  // and type sit in each column's head, so they are not repeated here.
  var IDENTITY = [
    { label: 'Borough', get: function (s) { return s.boro; } },
    { label: 'District', get: function (s) { return s.district_label || s.district; } },
    { label: 'Grades', get: function (s) { return s.grades; } },
    { label: 'Students', sub: function (s) { return s.enrollment_year; },
      get: function (s) {
        return SF.isBlank(s.enrollment) ? null : SF.fmt.count(s.enrollment);
      } },
    { label: 'Status',
      get: function (s) { return s.status === 'open' ? 'Open' : 'Closed or former'; } }
  ];

  function renderSheet() {
    var host = document.getElementById('comparison');
    var payloads = loadedPayloads();

    // A row no chosen school could ever report stays off the sheet until one
    // can. It stays picked, so it returns when such a school is added.
    function computeCells() {
      var out = {};
      picked.forEach(function (id) {
        out[id] = payloads.map(function (p) { return cellFor(rows[id], p); });
      });
      return out;
    }
    function visibleOf(cells) {
      if (!payloads.length) return picked.slice();
      return picked.filter(function (id) {
        return cells[id].some(function (c) { return c.status !== 'not_applicable'; });
      });
    }
    var cells = computeCells();
    var visible = visibleOf(cells);

    // A shortlist that reports none of the picked measures, which happens for
    // District 75 schools, gets the first measures it does report.
    if (payloads.length && !visible.length) {
      picked = rowOrder.filter(function (id) {
        return payloads.some(function (p) { return hasFigure(rows[id], p); });
      }).slice(0, 6);
      syncUrl();
      renderBar();
      cells = computeCells();
      visible = visibleOf(cells);
    }

    shown = visible;
    host.innerHTML = '';
    host.appendChild(specSheet(payloads, visible, cells));
    pinSheet();
    fresh = { rows: {}, schools: {} };
  }

  // Every column has a set width, so the sheet keeps its shape as schools
  // and measures come and go. The widths live in the stylesheet.
  function sheetTable() {
    var table = SF.el('table', { class: 'spec-sheet', style: '--slots: ' + maxSchools });
    var cols = SF.el('colgroup');
    cols.appendChild(SF.el('col', { class: 'col-label' }));
    for (var i = 0; i < maxSchools; i++) cols.appendChild(SF.el('col', { class: 'col-school' }));
    table.appendChild(cols);
    return table;
  }

  // The school row: a head per chosen school, then a hollow slot per place
  // left. Each school's type sits under its name.
  function sheetHead(payloads, pinned) {
    var thead = SF.el('thead');
    var tr = SF.el('tr');
    tr.appendChild(SF.el('th', { scope: 'col', class: 'corner', text: 'Measure' }));
    for (var i = 0; i < maxSchools; i++) {
      tr.appendChild(payloads[i] ? schoolHead(payloads[i], pinned) : slotHead(pinned));
    }
    thead.appendChild(tr);
    return thead;
  }

  function schoolHead(payload, pinned) {
    var s = payload.school;
    var name = s.name || s.dbn;
    var th = SF.el('th', {
      scope: 'col', class: 'school-head' + (fresh.schools[s.dbn] ? ' is-new' : '')
    });
    var top = SF.el('div', { class: 'head-top' });
    var link = SF.el('a', { href: 'school.html?dbn=' + s.dbn, text: name });
    var remove = SF.el('button', {
      type: 'button', class: 'head-remove', text: '×',
      'aria-label': 'Remove ' + name + ' from the comparison'
    });
    if (pinned) { link.tabIndex = -1; remove.tabIndex = -1; }
    remove.addEventListener('click', function () { removeSchool(s.dbn, pinned); });
    top.appendChild(link);
    top.appendChild(remove);
    th.appendChild(top);
    th.appendChild(SF.el('span', {
      class: 'th-sub', text: [s.school_type, s.dbn].filter(Boolean).join(' · ')
    }));
    return th;
  }

  function slotHead(pinned) {
    var th = SF.el('th', { scope: 'col', class: 'school-head is-empty' });
    var button = SF.el('button', { type: 'button', class: 'slot-add' });
    button.appendChild(SF.el('span', { 'aria-hidden': 'true', text: '+ ' }));
    button.appendChild(document.createTextNode('Add a school'));
    if (pinned) button.tabIndex = -1;
    button.addEventListener('click', focusSearch);
    th.appendChild(button);
    return th;
  }

  function specSheet(payloads, visible, cells) {
    var span = maxSchools + 1;
    var table = sheetTable();
    var caption = 'The chosen schools, one per column, and the chosen measures, one per row.';
    table.appendChild(SF.el('caption', { class: 'sr-only', text: caption }));
    table.appendChild(sheetHead(payloads, false));

    var body = SF.el('tbody');

    function groupRow(label) {
      var tr = SF.el('tr', { class: 'group' });
      var th = SF.el('th', { scope: 'colgroup', colspan: String(span) });
      th.appendChild(SF.el('span', { text: label }));
      tr.appendChild(th);
      body.appendChild(tr);
    }

    function labelCell(main, sub) {
      var th = SF.el('th', { scope: 'row', class: 'spec-label' });
      th.appendChild(SF.el('span', { class: 'th-main', text: main }));
      if (sub) th.appendChild(SF.el('span', { class: 'th-sub', text: sub }));
      return th;
    }

    // Slots without a school get a hollow cell, and a school that just
    // arrived flashes down its column.
    function fillRow(tr, cellOf) {
      for (var i = 0; i < maxSchools; i++) {
        var p = payloads[i];
        if (!p) { tr.appendChild(SF.el('td', { class: 'hollow' })); continue; }
        var td = cellOf(p, i);
        if (fresh.schools[p.school.dbn]) td.classList.add('is-new');
        tr.appendChild(td);
      }
    }

    groupRow('The schools');
    IDENTITY.forEach(function (field) {
      var tr = SF.el('tr');
      // Where every school gives the same answer, say it once under the label.
      var subs = {};
      payloads.forEach(function (p) {
        var s = field.sub && field.sub(p.school);
        if (s) subs[s] = true;
      });
      var sharedSub = Object.keys(subs).length === 1 ? Object.keys(subs)[0] : null;
      tr.appendChild(labelCell(field.label, sharedSub));
      fillRow(tr, function (p) {
        var value = field.get(p.school);
        var td = SF.el('td');
        if (SF.isBlank(value)) {
          td.className = 'muted';
          td.textContent = 'Not reported';
          return td;
        }
        td.appendChild(SF.el('span', { text: String(value) }));
        var own = field.sub && field.sub(p.school);
        if (own && !sharedSub) td.appendChild(SF.el('span', { class: 'period', text: own }));
        return td;
      });
      body.appendChild(tr);
    });

    var category = null;
    visible.forEach(function (id) {
      var row = rows[id];
      if (row.category !== category) {
        category = row.category;
        groupRow(row.categoryLabel);
      }
      var metric = metrics[id];
      var scale = SF.scaleOf(metric.format);

      // Measure names run long. The qualifier the pipeline appended, the unit
      // and the shared year drop to a quieter second line.
      var main = row.label;
      var sub = [];
      var qualifier = main.match(/\s*\(([^)]+)\)\s*$/);
      if (qualifier) {
        main = main.slice(0, qualifier.index).trim();
        sub.push(qualifier[1]);
      }
      if (scale) sub.push('out of ' + scale.replace('/ ', ''));

      var years = {};
      cells[id].forEach(function (c) { if (c.point) years[c.point.year] = true; });
      var yearList = Object.keys(years);
      var sharedYear = yearList.length === 1 ? yearList[0] : null;
      if (sharedYear) sub.push(sharedYear);

      var tr = SF.el('tr', { 'data-row': id, class: fresh.rows[id] ? 'is-new' : '' });
      tr.appendChild(labelCell(main, sub.join(' · ')));
      fillRow(tr, function (p, i) { return valueCell(cells[id][i], sharedYear, p); });
      body.appendChild(tr);
    });

    table.appendChild(body);

    // The sheet runs the full length of the page. It scrolls sideways when
    // the window is too narrow for every slot, so the scrolling box has to be
    // reachable from the keyboard and announced.
    var wrap = SF.el('div', { class: 'table-wrap sheet-wrap' });
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', caption);
    wrap.appendChild(table);

    // A copy of the school row pins under the masthead once the real one
    // scrolls away. Screen readers and the keyboard use the real row.
    var pin = SF.el('div', { class: 'sheet-pin', 'aria-hidden': 'true' });
    var pinTable = sheetTable();
    pinTable.setAttribute('role', 'presentation');
    pinTable.appendChild(sheetHead(payloads, true));
    pin.appendChild(pinTable);

    var sheet = SF.el('div', { class: 'sheet', id: 'sheet' });
    sheet.appendChild(pin);
    sheet.appendChild(wrap);
    return sheet;
  }

  // An absence is written out, never left as a blank cell. A silent empty cell
  // reads as nothing at all rather than as a gap in the data, and it hides the
  // difference between a figure the City withheld and one it never published.
  function valueCell(cell, sharedYear, payload) {
    var td = SF.el('td');
    var metric = metrics[cell.id];

    if (!cell.point) {
      var reason = SF.ABSENCE[cell.status] || SF.ABSENCE.missing;
      td.className = 'muted';
      td.textContent = reason;
      if (SF.ABSENCE_DETAIL[cell.status]) td.title = SF.ABSENCE_DETAIL[cell.status];
      return td;
    }

    var point = cell.point;
    td.appendChild(SF.el('span', {
      text: point.bound ||
        (point.word ? point.word + ' ' : '') + SF.formatValue(point.value, metric.format)
    }));
    // A cell carries its own year only when the schools disagree, which is
    // exactly when it needs noticing. Otherwise the row label says it once.
    if (!sharedYear) td.appendChild(SF.el('span', { class: 'period', text: point.year }));
    // A school with two reports shows the one this figure comes from.
    var series = (payload.series || {})[cell.id];
    if (series && series.rt && SF.reportTypesOf(payload.school).length > 1) {
      td.appendChild(SF.el('span', { class: 'period',
        text: SF.REPORT_LABEL[payload.school.report_type] || payload.school.report_type }));
    }
    return td;
  }

  function flash(el) {
    el.classList.remove('is-new');
    void el.offsetWidth;
    el.classList.add('is-new');
  }

  // ---- The pinned school row ----------------------------------------------

  // The pin is a sticky box as tall as the school row, and the table slides
  // up beneath it, so at rest the two coincide. The pin shows only once the
  // table has scrolled under it, and it follows the table sideways.
  var pinWatch = false;
  var pinFrame = 0;
  var pinSize = window.ResizeObserver ? new ResizeObserver(measurePin) : null;

  function pinParts() {
    var sheet = document.getElementById('sheet');
    if (!sheet) return null;
    return {
      sheet: sheet,
      pin: sheet.querySelector('.sheet-pin'),
      wrap: sheet.querySelector('.sheet-wrap'),
      head: sheet.querySelector('.sheet-wrap thead')
    };
  }

  function measurePin() {
    var parts = pinParts();
    if (!parts) return;
    // One extra pixel for the box's top border.
    parts.sheet.style.setProperty('--pin-h', (parts.head.offsetHeight + 1) + 'px');
    placePin();
  }

  function placePin() {
    pinFrame = 0;
    var parts = pinParts();
    if (!parts) return;
    var top = parseFloat(getComputedStyle(parts.pin).top) || 0;
    var stuck = parts.wrap.getBoundingClientRect().top < top - 1;
    parts.sheet.classList.toggle('is-stuck', stuck);
    if (stuck) parts.pin.scrollLeft = parts.wrap.scrollLeft;
  }

  function queuePin() {
    if (!pinFrame) pinFrame = requestAnimationFrame(placePin);
  }

  function pinSheet() {
    var parts = pinParts();
    if (!parts) return;
    parts.wrap.addEventListener('scroll', function () {
      parts.pin.scrollLeft = parts.wrap.scrollLeft;
    }, { passive: true });
    // The row's height changes as the page finishes loading and as names
    // wrap, so the pin re-measures whenever the row resizes.
    if (pinSize) {
      pinSize.disconnect();
      pinSize.observe(parts.head.querySelector('th'));
    }
    measurePin();
    if (pinWatch) return;
    pinWatch = true;
    window.addEventListener('scroll', queuePin, { passive: true });
    window.addEventListener('resize', measurePin);
  }

  // ---- The measures panel ---------------------------------------------------

  // Every measure the chosen schools report, by topic in the table's order.
  // A ticked box is a row on the sheet, so the panel is the one list of what
  // the sheet shows.
  var addedHere = [];

  function openPanel() {
    var panel = document.getElementById('measures-panel');
    var filter = document.getElementById('measure-filter');
    filter.value = '';
    buildPanel();
    addedHere = [];
    panel.showModal();
  }

  function offeredRows() {
    var payloads = loadedPayloads();
    var keep = {};
    picked.forEach(function (id) { keep[id] = true; });
    return rowOrder.filter(function (id) {
      return keep[id] || !payloads.length ||
        payloads.some(function (p) { return hasFigure(rows[id], p); });
    });
  }

  function buildPanel() {
    var host = document.getElementById('measure-list');
    host.innerHTML = '';

    var topics = [];
    offeredRows().forEach(function (id) {
      var r = rows[id];
      var topic = topics[topics.length - 1];
      if (!topic || topic.category !== r.category) {
        topic = { category: r.category, label: r.categoryLabel, bases: [] };
        topics.push(topic);
      }
      var base = topic.bases[topic.bases.length - 1];
      if (!base || base.key !== r.base) {
        base = { key: r.base, label: r.baseLabel, ids: [] };
        topic.bases.push(base);
      }
      base.ids.push(id);
    });

    topics.forEach(function (topic) { host.appendChild(topicBlock(topic)); });
    host.appendChild(SF.el('p', { class: 'panel-empty', id: 'measure-none', hidden: '',
                                  text: 'No measure matches.' }));
    recount();
  }

  function topicBlock(topic) {
    var details = SF.el('details', { class: 'topic' });
    var summary = SF.el('summary');
    summary.appendChild(SF.el('span', { class: 'topic-name', text: topic.label }));
    summary.appendChild(SF.el('span', { class: 'topic-count' }));
    details.appendChild(summary);

    var list = SF.el('ul', { class: 'topic-list' });
    topic.bases.forEach(function (base) {
      list.appendChild(baseItem(base, topic.label));
    });
    details.appendChild(list);
    details.open = !!details.querySelector('input:checked');
    return details;
  }

  // A measure with student groups lists the groups under it, named by group.
  function baseItem(base, topicLabel) {
    var li = SF.el('li', { class: 'base' });
    if (base.ids.length === 1) {
      li.appendChild(pickBox(base.ids[0], rows[base.ids[0]].label, topicLabel));
      return li;
    }
    var whole = base.ids.filter(function (id) { return rows[id].whole; });
    var lead = whole.length === 1 ? whole[0] : null;
    li.appendChild(lead
      ? pickBox(lead, base.label, topicLabel)
      : SF.el('p', { class: 'base-name', text: base.label }));
    var subs = SF.el('ul', { class: 'subs' });
    base.ids.forEach(function (id) {
      if (id === lead) return;
      var item = SF.el('li');
      item.appendChild(pickBox(id, shortLabel(rows[id].label, base.label), topicLabel));
      subs.appendChild(item);
    });
    li.appendChild(subs);
    return li;
  }

  function shortLabel(label, baseLabel) {
    if (label.indexOf(baseLabel) === 0) {
      var rest = label.slice(baseLabel.length).replace(/^[\s,:\-–—]+/, '');
      if (rest) return rest;
    }
    return label;
  }

  function pickBox(id, text, topicLabel) {
    var label = SF.el('label', { class: 'pick',
      'data-find': (rows[id].label + ' ' + topicLabel).toLowerCase() });
    var box = SF.el('input', { type: 'checkbox', value: id });
    box.checked = picked.indexOf(id) !== -1;
    box.addEventListener('change', function () { toggleRow(id, box.checked); });
    label.appendChild(box);
    var words = SF.el('span', { text: text });
    // A ticked measure that applies to none of the chosen schools is off the
    // table until one can, and says so here.
    if (box.checked && chosen.length && shown.indexOf(id) === -1) {
      words.appendChild(SF.el('span', { class: 'pick-note', text: 'Does not apply to these schools' }));
    }
    label.appendChild(words);
    return label;
  }

  function toggleRow(id, on) {
    if (on && picked.indexOf(id) === -1) {
      picked.push(id);
      addedHere.push(id);
      fresh.rows[id] = true;
    }
    if (!on) picked = picked.filter(function (x) { return x !== id; });
    picked = inOrder(picked);
    syncUrl();
    renderBar();
    renderSheet();
    recount();
  }

  function resetMeasures() {
    var before = picked.slice();
    picked = defaults();
    picked.forEach(function (id) {
      if (before.indexOf(id) === -1) { addedHere.push(id); fresh.rows[id] = true; }
    });
    syncUrl();
    renderBar();
    renderSheet();
    document.querySelectorAll('#measure-list input[type="checkbox"]').forEach(function (box) {
      box.checked = picked.indexOf(box.value) !== -1;
    });
    recount();
    say('Measures reset to the defaults.');
  }

  function recount() {
    document.querySelectorAll('#measure-list details.topic').forEach(function (topic) {
      var boxes = topic.querySelectorAll('input[type="checkbox"]');
      var on = topic.querySelectorAll('input[type="checkbox"]:checked').length;
      topic.querySelector('.topic-count').textContent = on + ' of ' + boxes.length;
    });
  }

  // Every word must appear in the measure's name or its topic. A measure's
  // own line stays in view above any of its groups that match.
  function filterPanel(query) {
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var any = false;
    document.querySelectorAll('#measure-list details.topic').forEach(function (topic) {
      var hits = 0;
      topic.querySelectorAll('li.base').forEach(function (base) {
        var baseHits = 0;
        base.querySelectorAll('label.pick').forEach(function (label) {
          var text = label.getAttribute('data-find');
          var hit = terms.every(function (t) { return text.indexOf(t) !== -1; });
          var item = label.parentNode.tagName === 'LI' && label.parentNode !== base
            ? label.parentNode : label;
          item.hidden = !hit;
          if (hit) baseHits++;
        });
        var lead = base.firstElementChild;
        if (baseHits && lead) lead.hidden = false;
        base.hidden = !baseHits;
        hits += baseHits;
      });
      topic.hidden = !hits;
      topic.open = terms.length ? hits > 0 : !!topic.querySelector('input:checked');
      if (hits) any = true;
    });
    document.getElementById('measure-none').hidden = any;
  }

  // On closing, the sheet scrolls to the first row added and flashes each.
  function panelClosed() {
    var added = addedHere.filter(function (id) { return picked.indexOf(id) !== -1; });
    addedHere = [];
    var trs = rowOrder.filter(function (id) { return added.indexOf(id) !== -1; })
      .map(function (id) { return document.querySelector('#sheet tr[data-row="' + id + '"]'); })
      .filter(Boolean);
    if (!trs.length) return;
    trs[0].scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    trs.forEach(flash);
  }

  function wirePanel() {
    var panel = document.getElementById('measures-panel');
    document.getElementById('measures-open').addEventListener('click', openPanel);
    document.getElementById('measures-close').addEventListener('click', function () { panel.close(); });
    document.getElementById('measures-done').addEventListener('click', function () { panel.close(); });
    document.getElementById('measures-reset').addEventListener('click', resetMeasures);
    document.getElementById('measure-filter').addEventListener('input', function (e) {
      filterPanel(e.target.value);
    });
    // A click on the shaded page outside the panel closes it.
    panel.addEventListener('click', function (e) {
      if (e.target !== panel) return;
      var box = panel.getBoundingClientRect();
      var inside = e.clientX >= box.left && e.clientX <= box.right &&
                   e.clientY >= box.top && e.clientY <= box.bottom;
      if (!inside) panel.close();
    });
    panel.addEventListener('close', panelClosed);
  }

  // ---- Taking the comparison with you -------------------------------------

  // The table someone assembles here is their work, not the site's, so it has
  // to be possible to keep it. The address bar holds the whole state, and the
  // CSV is built in the browser from exactly what is on screen.

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var text = String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function buildCsv(payloads) {
    var header = ['dbn', 'school', 'borough', 'district', 'type', 'grades'];
    shown.forEach(function (id) {
      // Value, period and the City's score each get their own column, so the
      // file is analyzable rather than a screenshot of the page.
      var label = rows[id].label;
      header.push(label, label + ' — school year', label + ' — NYC score out of 5');
    });

    var lines = [header.map(csvCell).join(',')];
    payloads.forEach(function (p) {
      var s = p.school;
      var line = [s.dbn, s.name, s.boro, s.district, s.school_type, s.grades];
      shown.forEach(function (id) {
        // Raw values, not formatted strings: a proportion stays a proportion so
        // a spreadsheet can do arithmetic with it.
        var point = cellFor(rows[id], p).point;
        line.push(point ? (point.bound !== undefined && point.bound !== null
                           ? point.bound : point.value) : '');
        line.push(point ? point.year : '');
        line.push(point && point.score !== null && point.score !== undefined ? point.score : '');
      });
      lines.push(line.map(csvCell).join(','));
    });

    lines.push('');
    lines.push(csvCell('Generated by Schools Finder (schools.publicworks.nyc). Values are as published ' +
      'by New York City Public Schools. A proportion is between 0 and 1. An ' +
      'empty cell means no value was published, which is not a zero. The score ' +
      'out of 5 is the City\'s own rating of that measure against a comparison ' +
      'group of similar schools.'));
    lines.push(csvCell(location.href));
    return lines.join('\n');
  }

  function download() {
    var payloads = loadedPayloads();
    var blob = new Blob([buildCsv(payloads)], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = SF.el('a', {
      href: url,
      download: 'schools-publicworks-nyc-comparison-' + payloads.length + '-schools.csv'
    });
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function copyLink(button) {
    function done() {
      button.textContent = 'Link copied';
      say('Link copied.');
      setTimeout(function () { button.textContent = 'Copy link'; }, 2000);
    }
    function failed() { say('Copy the address from the address bar.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(location.href).then(done, failed);
    } else {
      failed();
    }
  }

  function wireBar() {
    document.getElementById('clear-schools').addEventListener('click', clearSchools);
    document.getElementById('download-csv').addEventListener('click', download);
    var copy = document.getElementById('copy-link');
    copy.addEventListener('click', function () { copyLink(copy); });
  }

  // ---- Loading ---------------------------------------------------------------

  function loadAll() {
    return Promise.all(chosen.map(function (dbn) {
      if (loaded[dbn]) return Promise.resolve(loaded[dbn]);
      return SF.load('schools/' + dbn + '.json').then(function (p) {
        loaded[dbn] = p;
        return p;
      }).catch(function () {
        // A DBN in the address with no profile is dropped rather than failing
        // the whole page.
        chosen = chosen.filter(function (d) { return d !== dbn; });
        return null;
      });
    })).then(loadPeers);
  }

  // The peer files tell a measure the school's type never has from one this
  // school did not report. A file that fails to load costs only that wording.
  function loadPeers() {
    var slugs = [];
    loadedPayloads().forEach(function (p) {
      Object.keys(p.peer_types || {}).forEach(function (k) {
        var slug = p.peer_types[k];
        if (slug && !peers[slug] && slugs.indexOf(slug) === -1) slugs.push(slug);
      });
    });
    return Promise.all(slugs.map(function (slug) {
      return SF.load('peers/' + slug + '.json')
        .then(function (file) { peers[slug] = file; })
        .catch(function () {});
    }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([SF.load('metrics.json'), SF.loadDisplay()]).then(function (loadedBits) {
      metrics = loadedBits[0];
      maxSchools = SF.display.max_compare || 5;
      buildRows();
      readParams();

      SFSearch.mount('#compare-search', {
        placeholder: SEARCH_PLACEHOLDER,
        label: 'Add a school to the comparison',
        // A school already on the shortlist is not offered again, so picking
        // one can never be refused for being a duplicate.
        exclude: function (row) { return chosen.indexOf(row.dbn) !== -1; },
        excludedNote: 'Already in this comparison',
        onPick: function (row) { add(row.dbn, row.name); }
      });
      // The search sets its own placeholder once its index arrives, so a full
      // shortlist says so again after that.
      SF.load('search-index.json').then(renderBar, function () {});
      wireBar();
      wirePanel();

      return loadAll();
    }).then(function () {
      syncUrl();
      draw();
      document.getElementById('main').classList.remove('is-loading');
      measurePin();
    }).catch(function (err) {
      document.getElementById('main').classList.remove('is-loading');
      SF.fail(document.getElementById('comparison'), err);
    });
  });
})();
