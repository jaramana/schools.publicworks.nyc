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

  // What to show before anyone chooses. One measure from each part of a
  // profile, so the first view is useful rather than empty.
  var DEFAULT_MEASURES = [
    'demo_enrollment_total',
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

    var measures = SF.param('measures');
    picked = measures ? measures.split(',').filter(function (m) { return metrics[m]; }) : [];
  }

  function syncUrl() {
    SF.setParam('schools', chosen.join(','), true);
    SF.setParam('measures', picked.join(','), true);
    SF.store.set('compare', chosen);
  }

  // ---- Chosen schools ----------------------------------------------------

  // Whatever the last action was, said out loud. Silence after a click reads
  // as a broken page: picking a school when the list is full, or picking one
  // that is already on it, both used to do nothing at all and say nothing.
  var lastAction = '';

  function add(dbn, name) {
    if (chosen.indexOf(dbn) !== -1) {
      lastAction = (name || dbn) + ' is already in this comparison.';
      renderNote();
      return;
    }
    if (chosen.length >= maxSchools) {
      lastAction = 'This comparison already holds ' + maxSchools +
        ' schools. Remove one before adding ' + (name || dbn) + '.';
      renderNote();
      return;
    }
    chosen.push(dbn);
    lastAction = '';
    syncUrl();
    // Load before drawing. Drawing first was why a newly added school only
    // appeared after a reload: its profile had not arrived yet.
    loadAll().then(draw);
  }

  function clearAll() {
    chosen = [];
    picked = [];
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
        if (metrics[id] && latestPoint(payload.series[id], payload.school.report_type)) {
          seen[id] = true;
        }
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

  function renderPicker() {
    var host = document.getElementById('measure-picker');
    host.innerHTML = '';
    var available = availableMeasures();
    if (!available.length) { host.hidden = true; return; }
    host.hidden = false;

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
    select.appendChild(SF.el('option', { value: '', text: 'Choose a measure to add…' }));
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

    var reset = SF.el('button', { class: 'pill', type: 'button',
                                  text: 'Reset to the default measures' });
    reset.addEventListener('click', function () {
      picked = defaultMeasures(availableMeasures());
      syncUrl();
      draw();
    });
    var resetWrap = SF.el('div', { class: 'control' });
    resetWrap.appendChild(SF.el('label', { html: '&nbsp;', 'aria-hidden': 'true' }));
    resetWrap.appendChild(reset);
    host.appendChild(resetWrap);
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
      // A value the City withheld is a fact about the group, not an absence of
      // data, and it should not draw the same dash as a measure the school
      // never reported.
      if (series.st && series.st[i] === 'suppressed') {
        return { year: series.y[i], value: null, withheld: true,
                 n: null, score: null, band: null };
      }
    }
    return null;
  }

  // ---- Drawing -----------------------------------------------------------

  // Draw is three independent regions, each of which always reflects the
  // current state. It used to bail out early when fewer than two schools were
  // chosen, which left the school table showing whatever it had last time: an
  // × removed a school from the comparison and from the URL, and the table it
  // was clicked in carried on listing it.
  function draw() {
    renderNote();
    renderSchools();
    renderMeasures();
  }

  function renderNote() {
    var note = document.getElementById('picker-note');
    if (lastAction) {
      note.textContent = lastAction;
      note.className = 'hint warned';
      return;
    }
    note.className = 'hint';
    if (!chosen.length) {
      note.textContent = 'Search for a school to start a comparison.';
    } else if (chosen.length >= maxSchools) {
      note.textContent = maxSchools + ' schools is the limit. Remove one to add another.';
    } else {
      note.textContent = chosen.length + ' of up to ' + maxSchools + ' schools.' +
        (chosen.length === 1 ? ' Add one more to compare them.' : '');
    }
  }

  function renderSchools() {
    var host = document.getElementById('schools-table');
    host.innerHTML = '';
    var payloads = loadedPayloads();
    if (!payloads.length) return;

    host.appendChild(SF.el('h2', {
      class: 'section-label', text: 'Schools being compared'
    }));

    // A shortlist is remembered between visits, so there has to be a way out of
    // one that is not removing twelve rows by hand.
    var tools = SF.el('div', { class: 'table-tools' });
    var clear = SF.el('button', {
      class: 'pill', type: 'button',
      text: payloads.length === 1 ? 'Remove this school' : 'Clear all ' + payloads.length + ' schools'
    });
    clear.addEventListener('click', clearAll);
    tools.appendChild(clear);
    host.appendChild(tools);

    host.appendChild(identityTable(payloads));

    var kinds = {};
    payloads.forEach(function (p) { kinds[p.school.school_type || 'unknown'] = true; });
    if (Object.keys(kinds).length > 1) {
      host.appendChild(SF.el('div', {
        class: 'note-box caution',
        html: '<p><strong>These schools are different types.</strong> ' +
              SF.escapeHtml(Object.keys(kinds).join(', ')) + '. They report ' +
              'different measures, so some cells will be empty for some of them. ' +
              'That is a difference in reporting, not in quality.</p>'
      }));
    }
  }

  function renderMeasures() {
    var host = document.getElementById('comparison');
    var picker = document.getElementById('measure-picker');
    host.innerHTML = '';

    var payloads = loadedPayloads();
    if (payloads.length < 2) {
      picker.hidden = true;
      picker.innerHTML = '';
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: payloads.length
          ? '<p>One school so far. Add another to see their measures side by ' +
            'side.</p>'
          : '<p>Search above to add a school, or open a school profile and use ' +
            '<em>Add to comparison</em>.</p>'
      }));
      return;
    }

    var available = availableMeasures();
    picked = picked.filter(function (id) { return available.indexOf(id) !== -1; });
    if (!picked.length) picked = defaultMeasures(available);
    renderPicker();

    host.appendChild(SF.el('h2', { class: 'section-label', text: 'Published measures' }));
    host.appendChild(renderActions(payloads));
    host.appendChild(measureTable(payloads));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'A colored cell carries the score New York City publishes for that ' +
            'measure against a group of schools it considers similar, out of 5. ' +
            'Where the City publishes no score, the value is shown plain. ' +
            'Withheld means the City held a figure back because too few students ' +
            'are in the group; a dash means the school published nothing.'
    }));
  }

  // The schools that are chosen and whose profiles have arrived, in the order
  // they were chosen.
  function loadedPayloads() {
    return chosen.map(function (d) { return loaded[d]; }).filter(Boolean);
  }

  function removeSchool(dbn) {
    chosen = chosen.filter(function (d) { return d !== dbn; });
    syncUrl();
    draw();
  }

  function removeButton(label, onRemove) {
    var button = SF.el('button', {
      class: 'row-remove', type: 'button',
      'aria-label': 'Remove ' + label, title: 'Remove ' + label, text: '×'
    });
    button.addEventListener('click', onRemove);
    return button;
  }

  function identityTable(payloads) {
    var columns = [
      // Its own column, not a button tucked inside the name cell. A grid
      // inside a table cell resolves 1fr against min-content rather than the
      // cell's real width, which wrapped long school names to one word a line
      // and let the button overlap them.
      { key: '_remove', label: 'Remove from comparison', gutter: true, sortable: false,
        render: function (v, r) {
          return removeButton(r.name, function () { removeSchool(r.dbn); });
        } },
      { key: 'name', label: 'School', rowHeader: true, name: true,
        render: function (v, r) {
          return SF.el('a', { href: 'school.html?dbn=' + r.dbn, text: v });
        } },
      { key: 'dbn', label: 'DBN' },
      { key: 'boro', label: 'Borough' },
      { key: 'district', label: 'District' },
      { key: 'type', label: 'Type' },
      { key: 'grades', label: 'Grades' },
      { key: 'enrollment', label: 'Students', num: true,
        render: function (v, r) {
          return SF.isBlank(v) ? '—' : SF.fmt.count(v) +
            '<span class="period">' + SF.escapeHtml(r.enrollment_year || '') + '</span>';
        } },
      { key: 'status', label: 'Status' }
    ];
    var rows = payloads.map(function (p) {
      var school = p.school;
      return {
        name: school.name || school.dbn, dbn: school.dbn, boro: school.boro,
        district: school.district, type: school.school_type, grades: school.grades,
        enrollment: school.enrollment, enrollment_year: school.enrollment_year,
        status: school.status === 'open' ? 'Open' : 'Closed or former'
      };
    });
    var host = SF.el('div');
    SFTable.render(host, {
      columns: columns, rows: rows, search: false, sortKey: 'name', sortDir: 'asc',
      caption: 'The schools being compared. Sorting reorders the list; it does ' +
               'not rank the schools.',
      tableClass: 'compare-table'
    });
    return host;
  }

  // Measures are rows and schools are columns.
  //
  // The two axes grow very differently. A shortlist stops at twelve schools; the
  // measures do not stop at all, and there are 485 to choose from. With measures
  // across the top, adding the ones you care about pushed the table sideways
  // without end. Down the side, it just gets longer, which a page already does.
  function measureTable(payloads) {
    var columns = [{
      key: '_remove', label: 'Remove this measure', gutter: true, sortable: false,
      render: function (v, row) {
        return removeButton(row._main, function () {
          picked = picked.filter(function (m) { return m !== row._id; });
          syncUrl();
          draw();
        });
      }
    }, {
      key: 'measure', label: 'Measure', rowHeader: true, name: true,
      sortable: false,
      render: function (v, row) {
        var cell = SF.el('span');
        cell.appendChild(SF.el('span', { class: 'th-main', text: row._main }));
        if (row._sub) cell.appendChild(SF.el('span', { class: 'th-sub', text: row._sub }));
        return cell;
      }
    }];

    payloads.forEach(function (p) {
      columns.push({
        key: p.school.dbn, num: true, sortable: false,
        label: p.school.name || p.school.dbn,
        labelHtml: '<a href="school.html?dbn=' + p.school.dbn + '">' +
                   SF.escapeHtml(p.school.name || p.school.dbn) + '</a>',
        render: function (v, row) {
          var point = row['_pt_' + p.school.dbn];
          if (!point) {
            return '<span class="muted" title="This school published no figure ' +
                   'for this measure">—</span>';
          }
          if (point.withheld) {
            return '<span class="muted" title="The City withheld this figure ' +
                   'because too few students are in the group. It is not a zero.">' +
                   'Withheld</span>';
          }
          var text = point.bound || SF.formatValue(point.value, row._format);
          var cell = point.band
            ? '<span class="cell-band band-' + point.band + '" title="' +
              SF.escapeHtml(SF.BAND_LABEL[point.band]) + ', scored ' +
              Number(point.score).toFixed(1) + ' out of 5 by New York City">' +
              SF.escapeHtml(text) + '</span>'
            : SF.escapeHtml(text);
          return row._sharedYear
            ? cell
            : cell + '<span class="period">' + SF.escapeHtml(point.year) + '</span>';
        }
      });
    });

    var rows = picked.map(function (id) {
      var metric = metrics[id];
      var scale = SF.scaleOf(metric.format);

      var main = metric.label;
      var sub = [];
      var qualifier = main.match(/\s*\(([^)]+)\)\s*$/);
      if (qualifier) {
        main = main.slice(0, qualifier.index).trim();
        sub.push(qualifier[1]);
      }
      if (scale) sub.push('out of ' + scale.replace('/ ', ''));

      var row = { _id: id, _main: main, _format: metric.format, measure: metric.label };
      var years = {};
      payloads.forEach(function (p) {
        var point = latestPoint((p.series || {})[id], p.school.report_type);
        row['_pt_' + p.school.dbn] = point;
        row[p.school.dbn] = point ? point.value : null;
        if (point) years[point.year] = true;
      });
      var yearList = Object.keys(years);
      row._sharedYear = yearList.length === 1 ? yearList[0] : null;
      if (row._sharedYear) sub.push(row._sharedYear);
      row._sub = sub.join(' · ');
      return row;
    });

    var host = SF.el('div');
    SFTable.render(host, {
      columns: columns, rows: rows, search: false,
      caption: 'Published measures for the schools being compared. Each row is ' +
               'one measure, and states the school year it describes.',
      tableClass: 'compare-table pivoted'
    });
    return host;
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
    lines.push(csvCell('Generated by schoolsfinder.nyc. Values are as published ' +
      'by New York City Public Schools. A proportion is between 0 and 1. An ' +
      'empty cell means no value was published, which is not a zero. The score ' +
      'out of 5 is the City\'s own rating of that measure against a comparison ' +
      'group of similar schools.'));
    lines.push(csvCell(location.href));
    return lines.join('\n');
  }

  function renderActions(payloads) {
    var host = SF.el('div', { class: 'table-tools' });

    var download = SF.el('button', { class: 'pill', type: 'button',
                                     text: 'Download this comparison (CSV)' });
    download.addEventListener('click', function () {
      var blob = new Blob([buildCsv(payloads)], { type: 'text/csv;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var link = SF.el('a', {
        href: url,
        download: 'schoolsfinder-comparison-' + payloads.length + '-schools.csv'
      });
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    host.appendChild(download);

    var copy = SF.el('button', { class: 'pill', type: 'button',
                                 text: 'Copy link to this comparison' });
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
