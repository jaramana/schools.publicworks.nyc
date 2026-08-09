/* Side-by-side comparison of two or three schools.
   ------------------------------------------------------------------
   Factual only. Every compared value uses the same metric and the same
   reporting period, and no column is ever marked better. Where the schools
   last reported in different years, the row says so rather than lining up
   values that describe different times. */

(function () {
  'use strict';

  var MAX = 3;
  var CATEGORY_ORDER = [
    'demographics', 'attendance', 'state_tests', 'alt_assessments', 'regents',
    'growth', 'coursework', 'graduation', 'college', 'climate',
    'student_support', 'other'
  ];

  var chosen = [];
  var loaded = {};
  var metrics = null;

  function readParam() {
    var raw = SF.param('schools');
    if (!raw) return SF.store.get('compare', []).slice(0, MAX);
    return raw.split(',').map(function (s) { return s.trim().toUpperCase(); })
      .filter(function (s) { return /^\d{2}[MXKQR]\d{3}$/.test(s); })
      .slice(0, MAX);
  }

  function syncUrl() {
    SF.setParam('schools', chosen.join(','), true);
    SF.store.set('compare', chosen);
  }

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
        syncUrl();
        draw();
      });
      item.appendChild(remove);
      host.appendChild(item);
    });

    var note = document.getElementById('picker-note');
    note.textContent = chosen.length >= MAX
      ? 'Three schools is the limit. Remove one to add another.'
      : 'Add up to ' + MAX + ' schools. Currently ' + chosen.length + '.';
  }

  function add(dbn) {
    if (chosen.indexOf(dbn) !== -1 || chosen.length >= MAX) return;
    chosen.push(dbn);
    syncUrl();
    draw();
  }

  // A value and the year it describes travel together. Comparing a 2024-25
  // figure against a 2019-20 one without saying so is the single easiest way
  // to mislead with this data.
  function latestPoint(series, reportType) {
    if (!series) return null;
    for (var i = series.y.length - 1; i >= 0; i--) {
      // Where a school files two quality reports, take the value from the one
      // that matches the school's current report type rather than whichever
      // row happens to sort last.
      if (series.rt && reportType && series.rt[i] !== reportType) continue;
      if (!SF.isBlank(series.v[i])) {
        return { year: series.y[i], value: series.v[i], n: series.n ? series.n[i] : null,
                 report: series.rt ? series.rt[i] : null };
      }
    }
    return { year: series.y[series.y.length - 1], value: null,
             status: series.st[series.st.length - 1] };
  }

  function draw() {
    renderChosen();
    var host = document.getElementById('comparison');
    host.innerHTML = '';

    if (chosen.length < 2) {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p>Choose at least two schools to compare. Search above, or open ' +
              'a school profile and use <em>Add to comparison</em>.</p>'
      }));
      return;
    }

    var payloads = chosen.map(function (d) { return loaded[d]; });
    if (payloads.some(function (p) { return !p; })) return;

    // Identity block first: what kind of schools these are. Comparing an
    // elementary school with a high school is allowed, but the reader should
    // see that is what they are doing.
    var kinds = payloads.map(function (p) { return p.school.school_type || 'unknown'; });
    if (new Set(kinds).size > 1) {
      host.appendChild(SF.el('div', {
        class: 'note-box caution',
        html: '<p><strong>These schools are different types.</strong> ' +
              SF.escapeHtml(kinds.join(', ')) + '. They report different ' +
              'measures, so most rows below will be published for some of them ' +
              'and not for others. That is a difference in reporting, not in ' +
              'quality.</p>'
      }));
    }

    host.appendChild(identityTable(payloads));

    var byCategory = {};
    Object.keys(metrics).forEach(function (metricId) {
      var metric = metrics[metricId];
      var points = payloads.map(function (p) {
        return latestPoint((p.series || {})[metricId], p.school.report_type);
      });
      var anyValue = points.some(function (pt) { return pt && !SF.isBlank(pt.value); });
      if (!anyValue) return;
      (byCategory[metric.category] = byCategory[metric.category] || [])
        .push({ id: metricId, metric: metric, points: points });
    });

    CATEGORY_ORDER.forEach(function (category) {
      var rows = byCategory[category];
      if (!rows || !rows.length) return;
      host.appendChild(SF.el('h2', {
        class: 'section-label', text: rows[0].metric.category_label
      }));
      host.appendChild(metricTable(rows, payloads));
    });

    if (!Object.keys(byCategory).length) {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p>These schools have no published measure in common.</p>'
      }));
    }
  }

  function identityTable(payloads) {
    var fields = [
      ['DBN', function (s) { return s.dbn; }],
      ['Borough', function (s) { return s.boro; }],
      ['District', function (s) { return s.district; }],
      ['Type', function (s) { return s.school_type; }],
      ['Grades', function (s) { return s.grades; }],
      ['Students', function (s) {
        return SF.isBlank(s.enrollment) ? null
          : SF.fmt.count(s.enrollment) + ' (' + (s.enrollment_year || '') + ')';
      }],
      ['Address', function (s) { return s.address; }],
      ['Status', function (s) { return s.status === 'open' ? 'Open' : 'Closed or former'; }]
    ];
    return buildTable(
      payloads,
      fields.map(function (f) {
        return {
          label: f[0],
          cells: payloads.map(function (p) { return f[1](p.school); }),
          note: null
        };
      }),
      'School details'
    );
  }

  function metricTable(rows, payloads) {
    return buildTable(
      payloads,
      rows.map(function (row) {
        var years = row.points.map(function (pt) { return pt ? pt.year : null; });
        var distinct = new Set(years.filter(Boolean));
        return {
          label: row.metric.label,
          cells: row.points.map(function (pt) {
            if (!pt) return null;
            if (SF.isBlank(pt.value)) return SF.ABSENCE[pt.status] || SF.ABSENCE.missing;
            return SF.formatValue(pt.value, row.metric.format);
          }),
          note: distinct.size === 1
            ? Array.from(distinct)[0]
            : 'different years: ' + years.map(function (y) { return y || 'none'; }).join(', ')
        };
      }),
      'Comparison of published measures'
    );
  }

  function buildTable(payloads, rows, caption) {
    var wrap = SF.el('div', { class: 'table-wrap', role: 'region', tabindex: '0',
                              'aria-label': caption });
    var table = SF.el('table', { class: 'compare-table' });
    table.appendChild(SF.el('caption', { class: 'sr-only', text: caption }));

    var thead = SF.el('thead');
    var head = SF.el('tr');
    head.appendChild(SF.el('th', { scope: 'col', text: 'Measure' }));
    payloads.forEach(function (p) {
      var th = SF.el('th', { class: 'school', scope: 'col' });
      th.appendChild(SF.el('a', {
        href: 'school.html?dbn=' + p.school.dbn,
        text: p.school.name || p.school.dbn
      }));
      head.appendChild(th);
    });
    head.appendChild(SF.el('th', { scope: 'col', text: 'Period' }));
    thead.appendChild(head);
    table.appendChild(thead);

    var body = SF.el('tbody');
    rows.forEach(function (row) {
      var tr = SF.el('tr');
      tr.appendChild(SF.el('th', { scope: 'row', class: 'name', text: row.label }));
      row.cells.forEach(function (cell) {
        var td = SF.el('td', { class: 'value num' });
        if (cell === null || cell === undefined || cell === '') {
          td.textContent = '—';
          td.className = 'value num muted';
        } else {
          td.textContent = cell;
        }
        tr.appendChild(td);
      });
      var note = SF.el('td', { class: 'muted', text: row.note || '' });
      tr.appendChild(note);
      body.appendChild(tr);
    });
    table.appendChild(body);
    wrap.appendChild(table);
    return wrap;
  }

  function loadAll() {
    return Promise.all(chosen.map(function (dbn) {
      if (loaded[dbn]) return Promise.resolve(loaded[dbn]);
      return SF.load('schools/' + dbn + '.json').then(function (p) {
        loaded[dbn] = p;
        return p;
      }).catch(function () {
        // A DBN in the address that has no profile is dropped rather than
        // failing the whole page.
        chosen = chosen.filter(function (d) { return d !== dbn; });
        return null;
      });
    }));
  }

  document.addEventListener('DOMContentLoaded', function () {
    chosen = readParam();

    SFSearch.mount('#compare-search', {
      placeholder: 'Add a school by name or DBN…',
      label: 'Add a school to the comparison',
      onPick: function (row) { add(row.dbn); }
    });

    SF.load('metrics.json').then(function (m) {
      metrics = m;
      return loadAll();
    }).then(function () {
      syncUrl();
      draw();
    }).catch(function (err) {
      SF.fail(document.getElementById('comparison'), err);
    });
  });
})();
