/* Side-by-side comparison of a shortlist of schools.
   ------------------------------------------------------------------
   Schools are rows and measures are columns. Twelve schools across the top of
   a table is unreadable, and a row per school is the shape a real shortlist
   has anyway.

   Factual only. Every column is one published measure, each cell states the
   year it comes from when the schools disagree, and no row is ever marked as
   better than another. Where New York City publishes its own score against a
   comparison group, the cell carries that band, which is the City's reading
   and not this site's. */

(function () {
  'use strict';

  var chosen = [];
  var loaded = {};
  var metrics = null;
  var picked = [];          // metric ids shown as columns
  var maxSchools = 12;

  // Whatever the last action was, said out loud. Silence after a click reads
  // as a broken page: picking a school when the list is full, or picking one
  // that is already on it, both used to do nothing at all and say nothing.
  var lastAction = '';

  // What to show before anyone chooses. One measure from each part of a
  // profile, so the first view is useful rather than empty.
  // Total enrollment is not here: the sheet always carries a Students row in
  // the schools group, and the same figure twice is just noise.
  var DEFAULT_MEASURES = [
    'demo_economic_need_index',
    'attendance_k8_all', 'attendance_hs_all',
    'chronic_absent_ems_all', 'chronic_absent_hs_all',
    'prof_pct_ela_all', 'prof_pct_mth_all',
    'grad_pct_4_all', 'ccr_4yr_all'
  ];

  // ---- State in the address bar -----------------------------------------

  function readParams() {
    var raw = SF.param('schools');
    var list = raw
      ? raw.split(',')
      : SF.store.get('compare', []);
    chosen = list.map(function (s) { return String(s).trim().toUpperCase(); })
      .filter(function (s) { return /^\d{2}[MXKQR]\d{3}$/.test(s); })
      .filter(function (s, i, a) { return a.indexOf(s) === i; })
      .slice(0, maxSchools);

    // The default rows are laid down before any school is chosen, so the sheet
    // opens with the measures already on it and a school fills them in rather
    // than bringing them into existence.
    var measures = SF.param('measures');
    picked = measures
      ? measures.split(',').filter(function (m) { return metrics[m]; })
      : DEFAULT_MEASURES.filter(function (m) { return metrics[m]; });
  }

  function syncUrl() {
    SF.setParam('schools', chosen.join(','), true);
    SF.setParam('measures', picked.join(','), true);
    SF.store.set('compare', chosen);
  }

  // ---- Chosen schools ----------------------------------------------------

  function renderChosen() {
    var host = document.getElementById('chosen');
    host.innerHTML = '';
    chosen.forEach(function (dbn) {
      var payload = loaded[dbn];
      var name = payload ? (payload.school.name || dbn) : dbn;
      var item = SF.el('li');
      item.appendChild(SF.el('span', { text: name }));
      var remove = SF.el('button', {
        type: 'button', text: '×',
        'aria-label': 'Remove ' + name + ' from the comparison'
      });
      remove.addEventListener('click', function () {
        chosen = chosen.filter(function (d) { return d !== dbn; });
        lastAction = '';
        syncUrl();
        draw();
      });
      item.appendChild(remove);
      host.appendChild(item);
    });

    // A shortlist is remembered between visits, so there has to be a way out
    // of one that is not removing every row by hand.
    var tools = document.getElementById('chosen-tools');
    tools.innerHTML = '';
    if (chosen.length) {
      var clear = SF.el('button', {
        class: 'pill', type: 'button',
        text: chosen.length === 1 ? 'Remove this school' : 'Clear all ' + chosen.length + ' schools'
      });
      clear.addEventListener('click', clearAll);
      tools.appendChild(clear);
    }

    var note = document.getElementById('picker-note');
    if (lastAction) {
      note.textContent = lastAction;
      note.className = 'hint warned';
      return;
    }
    note.className = 'hint';
    if (!chosen.length) {
      // The guidance that used to replace the table now lives here, because the
      // table no longer goes away to make room for it.
      note.textContent = 'Search for a school to start a comparison, or open a ' +
        'school profile and use Add to comparison.';
    } else if (chosen.length >= maxSchools) {
      note.textContent = maxSchools + ' schools is the limit. Remove one to add another.';
    } else {
      note.textContent = chosen.length + ' of up to ' + maxSchools + ' schools.' +
        (chosen.length === 1 ? ' Add one more to compare them.' : '');
    }
  }

  function add(dbn, name) {
    // A guard, not a path anyone should reach: the search leaves out schools
    // already on the shortlist, so a duplicate cannot be offered in the first
    // place. Kept because add() is also reachable from a hand-edited address.
    if (chosen.indexOf(dbn) !== -1) return;
    if (chosen.length >= maxSchools) {
      lastAction = 'This comparison already holds ' + maxSchools +
        ' schools. Remove one before adding ' + (name || dbn) + '.';
      renderChosen();
      return;
    }
    chosen.push(dbn);
    lastAction = '';
    syncUrl();
    // Load before drawing. Drawing first was why a newly added school only
    // appeared after a reload: its profile had not arrived yet.
    renderChosen();
    loadAll().then(draw);
  }

  function clearAll() {
    chosen = [];
    // The button clears schools. The rows go back to the set the sheet opens
    // with rather than emptying, so clearing lands on the resting state and not
    // on a stripped sheet the reader then has to rebuild.
    picked = DEFAULT_MEASURES.filter(function (m) { return metrics[m]; });
    lastAction = '';
    syncUrl();
    draw();
  }

  // ---- Which measures are columns ----------------------------------------

  function availableMeasures() {
    // Only measures at least one chosen school actually reports, so the picker
    // never offers a column that would come back entirely empty.
    var seen = {};
    chosen.forEach(function (dbn) {
      var payload = loaded[dbn];
      if (!payload) return;
      Object.keys(payload.series || {}).forEach(function (id) {
        if (!metrics[id]) return;
        var point = latestPoint(payload.series[id], payload.school.report_type);
        // A point that carries only a reason, and no figure, does not make the
        // measure worth offering as a row: it would come back empty for every
        // school on the list.
        if (point && !point.status) seen[id] = true;
      });
    });
    return Object.keys(seen);
  }

  function defaultMeasures(available) {
    var picks = DEFAULT_MEASURES.filter(function (m) { return available.indexOf(m) !== -1; });
    if (picks.length) return picks.slice(0, 8);
    // Nothing from the default set applies to these schools, which happens for
    // District 75 and transfer schools. Fall back to whatever they do report.
    return available.slice(0, 6);
  }

  // The picker is always on the page, even with nothing to offer yet. A control
  // that appears once you have done something else is a control nobody expects.
  function renderPicker() {
    var host = document.getElementById('measure-picker');
    host.innerHTML = '';
    host.hidden = false;
    var available = availableMeasures();

    var byCategory = {};
    available.forEach(function (id) {
      var m = metrics[id];
      (byCategory[m.category] = byCategory[m.category] || []).push(id);
    });
    var order = (SF.display.category_order || []).filter(function (c) { return byCategory[c]; });
    Object.keys(byCategory).forEach(function (c) {
      if (order.indexOf(c) === -1) order.push(c);
    });

    var control = SF.el('div', { class: 'control' });
    control.appendChild(SF.el('label', { for: 'add-measure', text: 'Add a measure' }));
    var select = SF.el('select', { id: 'add-measure' });
    select.appendChild(SF.el('option', {
      value: '',
      text: available.length ? 'Choose a measure to add…' : 'Add a school first…'
    }));
    if (!available.length) select.disabled = true;
    order.forEach(function (category) {
      var group = SF.el('optgroup', { label: metrics[byCategory[category][0]].category_label });
      byCategory[category]
        .filter(function (id) { return picked.indexOf(id) === -1; })
        .sort(function (a, b) { return metrics[a].label.localeCompare(metrics[b].label); })
        .forEach(function (id) {
          group.appendChild(SF.el('option', { value: id, text: metrics[id].label }));
        });
      if (group.children.length) select.appendChild(group);
    });
    select.addEventListener('change', function () {
      if (!select.value) return;
      picked.push(select.value);
      syncUrl();
      draw();
    });
    control.appendChild(select);
    host.appendChild(control);

    var chips = SF.el('ul', { class: 'picked-measures' });
    picked.forEach(function (id) {
      var chip = SF.el('li');
      var button = SF.el('button', {
        class: 'pill', type: 'button',
        'aria-label': 'Remove the ' + metrics[id].label + ' row',
        text: metrics[id].label + ' ×'
      });
      button.addEventListener('click', function () {
        picked = picked.filter(function (m) { return m !== id; });
        syncUrl();
        draw();
      });
      chip.appendChild(button);
      chips.appendChild(chip);
    });
    var reset = SF.el('li');
    var resetButton = SF.el('button', { class: 'pill', type: 'button', text: 'Reset rows' });
    resetButton.addEventListener('click', function () {
      // Back to the set the sheet opens with, not to whatever the current
      // shortlist happens to report, so reset lands somewhere predictable.
      picked = DEFAULT_MEASURES.filter(function (m) { return metrics[m]; });
      syncUrl();
      draw();
    });
    reset.appendChild(resetButton);
    chips.appendChild(reset);
    host.appendChild(chips);
  }

  // ---- Reading a value ---------------------------------------------------

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
          band: series.b ? series.b[i] : null
        };
      }
      // A bound the source published, such as "Above 95%", is a value for
      // reading purposes even though it cannot be sorted as a number.
      if (series.bd && series.bd[i]) {
        return { year: series.y[i], value: null, bound: series.bd[i],
                 n: null, score: null, band: null };
      }
    }
    // No figure in any year. The reason is still worth carrying: a value the
    // City withheld because too few students are in the group is not the same
    // as one it never published, and a dash would say neither.
    for (var j = series.y.length - 1; j >= 0; j--) {
      if (series.rt && reportType && series.rt[j] !== reportType) continue;
      return { year: series.y[j], value: null, n: null, score: null, band: null,
               status: series.st ? series.st[j] : 'missing' };
    }
    return null;
  }

  // ---- Drawing -----------------------------------------------------------

  // One sheet, the way a car comparison reads: the schools stay across the top
  // and every fact runs down the side in labeled groups, so a reader scrolls
  // one continuous list instead of moving between tables and working out which
  // control drives which. The schools are the first group of rows, not a
  // separate table above.
  //
  // The two axes grow differently, which is why the schools are the columns. A
  // shortlist stops at twelve; the measures do not stop at all, and there are
  // 485 to choose from. Across the top, adding the ones you care about pushed
  // the sheet sideways without end. Down the side it only gets longer, which a
  // page already does.
  function draw() {
    renderChosen();
    renderSheet();
  }

  // The schools that are chosen and whose profiles have arrived, in the order
  // they were chosen. Drawing reads this rather than `chosen`, so a region can
  // never show a school whose profile has not loaded.
  function loadedPayloads() {
    return chosen.map(function (d) { return loaded[d]; }).filter(Boolean);
  }

  // Fixed facts about a school, in the order a reader asks for them. These are
  // always present, so they are not part of the measure picker.
  var IDENTITY = [
    { label: 'DBN', get: function (s) { return s.dbn; } },
    { label: 'Borough', get: function (s) { return s.boro; } },
    { label: 'District', get: function (s) { return s.district_label || s.district; } },
    { label: 'Type', get: function (s) { return s.school_type; } },
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
    host.innerHTML = '';

    // The sheet is drawn at every count, including none. It used to be replaced
    // by a note until two schools were chosen, so the table, the picker and the
    // download buttons all appeared at once on the second pick. Nothing on this
    // page should arrive that a reader did not ask for: adding a school adds a
    // column and adding a measure adds a row, and that is the whole of it.
    var payloads = loadedPayloads();

    // A row that is on the sheet stays on it. Rows used to be dropped when no
    // chosen school reported them, which meant adding or removing one school
    // silently rewrote the list of measures; the cell says "Does not apply"
    // instead, which is both stable and the truth. The only exception is a
    // shortlist that reports none of the picked measures at all, where falling
    // back to what it does report beats a sheet of nothing.
    var available = availableMeasures();
    var anyReported = picked.some(function (id) { return available.indexOf(id) !== -1; });
    if (payloads.length && !anyReported) picked = defaultMeasures(available);
    renderPicker();

    var kinds = {};
    payloads.forEach(function (p) { kinds[p.school.school_type || 'unknown'] = true; });
    if (Object.keys(kinds).length > 1) {
      host.appendChild(SF.el('div', {
        class: 'note-box caution',
        html: '<p><strong>These schools are different types.</strong> ' +
              SF.escapeHtml(Object.keys(kinds).join(', ')) + '. They report ' +
              'different measures, so some rows will be empty for some of them. ' +
              'That is a difference in reporting, not in quality.</p>'
      }));
    }

    host.appendChild(renderActions(payloads));
    host.appendChild(specSheet(payloads));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'A colored figure carries the score New York City publishes for that ' +
            'measure against a group of schools it considers similar, out of 5. ' +
            'Where the City publishes no score, the figure is shown plain. ' +
            'Withheld means the City held a figure back because too few students ' +
            'are in the group; it is not a zero.'
    }));
  }

  // Measures grouped the way a profile groups them, in the config's theme
  // order, so the sheet reads in sections rather than as one long undivided
  // list. A group the reader has picked nothing from does not appear.
  function measureGroups() {
    var byCategory = {};
    picked.forEach(function (id) {
      var category = metrics[id].category;
      (byCategory[category] = byCategory[category] || []).push(id);
    });
    var order = (SF.display.category_order || []).filter(function (c) { return byCategory[c]; });
    Object.keys(byCategory).forEach(function (c) {
      if (order.indexOf(c) === -1) order.push(c);
    });
    return order.map(function (category) {
      return {
        label: metrics[byCategory[category][0]].category_label,
        ids: byCategory[category]
      };
    });
  }

  function specSheet(payloads) {
    // With nothing chosen the sheet still stands, with one empty column in
    // place of the first school, so the frame a reader is filling in is visible
    // before they start rather than appearing once they have.
    var ghost = payloads.length === 0;
    var span = (ghost ? 1 : payloads.length) + 1;

    var table = SF.el('table', { class: 'spec-sheet' });
    var caption = 'Every chosen school in a column and every chosen fact in a ' +
      'row. Each row states the school year it describes. Nothing is added up ' +
      'and no school is marked as better than another.';
    table.appendChild(SF.el('caption', { class: 'sr-only', text: caption }));

    // The schools stay across the top while the sheet scrolls, so a figure far
    // down the list never loses the column it belongs to.
    var thead = SF.el('thead');
    var headRow = SF.el('tr');
    var corner = SF.el('th', { scope: 'col', class: 'corner', text: 'Measure' });
    headRow.appendChild(corner);
    if (ghost) {
      headRow.appendChild(SF.el('th', {
        scope: 'col', class: 'school-head ghost', text: 'No school chosen yet'
      }));
    }
    payloads.forEach(function (p) {
      var th = SF.el('th', { scope: 'col', class: 'school-head' });
      th.appendChild(SF.el('a', {
        href: 'school.html?dbn=' + p.school.dbn,
        text: p.school.name || p.school.dbn
      }));
      th.appendChild(SF.el('span', { class: 'th-sub', text: p.school.dbn }));
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var body = SF.el('tbody');

    function groupRow(label) {
      var tr = SF.el('tr', { class: 'group' });
      var th = SF.el('th', { scope: 'colgroup', colspan: String(span), text: label });
      tr.appendChild(th);
      body.appendChild(tr);
    }

    function labelCell(main, sub) {
      var th = SF.el('th', { scope: 'row', class: 'spec-label' });
      th.appendChild(SF.el('span', { class: 'th-main', text: main }));
      if (sub) th.appendChild(SF.el('span', { class: 'th-sub', text: sub }));
      return th;
    }

    groupRow('The schools');
    IDENTITY.forEach(function (field) {
      var tr = SF.el('tr');
      // Where every school gives the same answer, say it once under the label
      // rather than on each cell.
      var subs = {};
      payloads.forEach(function (p) {
        var s = field.sub && field.sub(p.school);
        if (s) subs[s] = true;
      });
      var sharedSub = Object.keys(subs).length === 1 ? Object.keys(subs)[0] : null;
      tr.appendChild(labelCell(field.label, sharedSub));
      if (ghost) tr.appendChild(SF.el('td', { class: 'ghost' }));
      payloads.forEach(function (p) {
        var value = field.get(p.school);
        var td = SF.el('td');
        if (SF.isBlank(value)) {
          td.className = 'muted';
          td.textContent = 'Not reported';
          td.setAttribute('aria-label', 'Not published');
        } else {
          td.appendChild(SF.el('span', { text: String(value) }));
          var own = field.sub && field.sub(p.school);
          if (own && !sharedSub) td.appendChild(SF.el('span', { class: 'period', text: own }));
        }
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });

    measureGroups().forEach(function (group) {
      groupRow(group.label);
      group.ids.forEach(function (id) {
        var metric = metrics[id];
        var scale = SF.scaleOf(metric.format);

        // Measure names run long. The name is not rewritten: the qualifier the
        // pipeline appended, the unit and the shared year drop to a quieter
        // second line, leaving one thing to read on the first.
        var main = metric.label;
        var sub = [];
        var qualifier = main.match(/\s*\(([^)]+)\)\s*$/);
        if (qualifier) {
          main = main.slice(0, qualifier.index).trim();
          sub.push(qualifier[1]);
        }
        if (scale) sub.push('out of ' + scale.replace('/ ', ''));

        var points = payloads.map(function (p) {
          return latestPoint((p.series || {})[id], p.school.report_type);
        });
        var years = {};
        points.forEach(function (point) { if (point) years[point.year] = true; });
        var yearList = Object.keys(years);
        var sharedYear = yearList.length === 1 ? yearList[0] : null;
        if (sharedYear) sub.push(sharedYear);

        var tr = SF.el('tr');
        tr.appendChild(labelCell(main, sub.join(' · ')));
        if (ghost) tr.appendChild(SF.el('td', { class: 'ghost' }));
        points.forEach(function (point) {
          tr.appendChild(valueCell(point, metric, sharedYear));
        });
        body.appendChild(tr);
      });
    });

    table.appendChild(body);

    // The sheet scrolls sideways once there are more schools than fit, so the
    // scrolling box has to be reachable from the keyboard and announced.
    var wrap = SF.el('div', { class: 'table-wrap sheet-wrap' });
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', caption);
    wrap.appendChild(table);
    return wrap;
  }

  // An absence is written out, never left as a blank cell. A silent empty cell
  // reads as nothing at all rather than as a gap in the data, and it hides the
  // difference between a figure the City withheld and one it never published.
  function valueCell(point, metric, sharedYear) {
    var td = SF.el('td', { class: 'num' });

    if (!point || point.status) {
      var reason = point ? (SF.ABSENCE[point.status] || SF.ABSENCE.missing)
                         : SF.ABSENCE.not_applicable;
      td.className = 'num muted';
      td.textContent = reason;
      td.setAttribute('aria-label', reason);
      if (point && SF.ABSENCE_DETAIL[point.status]) {
        td.title = SF.ABSENCE_DETAIL[point.status];
      } else if (!point) {
        td.title = 'This measure is not published for this school.';
      }
      return td;
    }

    var text = point.bound || SF.formatValue(point.value, metric.format);
    if (point.band) {
      td.appendChild(SF.el('span', {
        class: 'cell-band band-' + point.band,
        title: SF.BAND_LABEL[point.band] + ', scored ' +
               Number(point.score).toFixed(1) + ' out of 5 by New York City',
        text: text
      }));
    } else {
      td.appendChild(SF.el('span', { text: text }));
    }
    // A cell carries its own year only when the schools disagree, which is
    // exactly when it needs noticing. Otherwise the row header says it once.
    if (!sharedYear) {
      td.appendChild(SF.el('span', { class: 'period', text: point.year }));
    }
    return td;
  }

  // ---- Taking the comparison with you ------------------------------------

  // The table someone assembles here is their work, not the site's, so it has
  // to be possible to keep it. Two ways out: the address bar holds the whole
  // state, and the CSV is built in the browser from exactly what is on screen.

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    var text = String(value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function buildCsv(payloads) {
    var header = ['dbn', 'school', 'borough', 'district', 'type', 'grades'];
    picked.forEach(function (id) {
      // Value, period and the City's score each get their own column, so the
      // file is analyzable rather than a screenshot of the page.
      header.push(metrics[id].label);
      header.push(metrics[id].label + ' — school year');
      header.push(metrics[id].label + ' — NYC score out of 5');
    });

    var lines = [header.map(csvCell).join(',')];
    payloads.forEach(function (p) {
      var s = p.school;
      var row = [s.dbn, s.name, s.boro, s.district, s.school_type, s.grades];
      picked.forEach(function (id) {
        var point = latestPoint((p.series || {})[id], s.report_type);
        // A point that carries only a reason is an absence, not a reading, so
        // it leaves the value and the year empty rather than dating a figure
        // that was never published.
        if (point && point.status) point = null;
        // Raw values, not formatted strings: a proportion stays a proportion so
        // a spreadsheet can do arithmetic with it.
        row.push(point ? (point.bound !== undefined && point.bound !== null
                          ? point.bound : point.value) : '');
        row.push(point ? point.year : '');
        row.push(point && point.score !== null && point.score !== undefined
                 ? point.score : '');
      });
      lines.push(row.map(csvCell).join(','));
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

  // These sit above the sheet at every count. Disabled while there is nothing
  // to take away, rather than absent: a button that materializes on the second
  // school is a button nobody was looking for.
  function renderActions(payloads) {
    var host = SF.el('div', { class: 'table-tools' });
    var empty = payloads.length === 0;

    var download = SF.el('button', { class: 'pill', type: 'button',
                                     text: 'Download this comparison (CSV)' });
    download.disabled = empty;
    download.addEventListener('click', function () {
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
    });
    host.appendChild(download);

    var copy = SF.el('button', { class: 'pill', type: 'button',
                                 text: 'Copy link to this comparison' });
    copy.disabled = empty;
    var said = SF.el('span', { class: 'count', role: 'status' });
    copy.addEventListener('click', function () {
      var url = location.href;
      var done = function () { said.textContent = 'Link copied.'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done, function () {
          said.textContent = 'Copy the address from the address bar.';
        });
      } else {
        said.textContent = 'Copy the address from the address bar.';
      }
    });
    host.appendChild(copy);
    host.appendChild(said);

    host.appendChild(SF.el('span', {
      class: 'count',
      text: 'Your shortlist is also remembered in this browser.'
    }));
    return host;
  }

  // ---- Loading ------------------------------------------------------------

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
    }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([SF.load('metrics.json'), SF.loadDisplay()]).then(function (loadedBits) {
      metrics = loadedBits[0];
      maxSchools = SF.display.max_compare || 12;

      readParams();

      SFSearch.mount('#compare-search', {
        placeholder: 'Add a school by name or DBN…',
        label: 'Add a school to the comparison',
        // A school already on the shortlist is not offered again, so picking
        // one can never be refused for being a duplicate.
        exclude: function (row) { return chosen.indexOf(row.dbn) !== -1; },
        excludedNote: 'Already in this comparison',
        onPick: function (row) { add(row.dbn, row.name); }
      });

      return loadAll();
    }).then(function () {
      syncUrl();
      draw();
    }).catch(function (err) {
      SF.fail(document.getElementById('comparison'), err);
    });
  });
})();
