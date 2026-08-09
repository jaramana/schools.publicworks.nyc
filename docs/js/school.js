/* A school profile.
   ------------------------------------------------------------------
   Loads one school file and the metric manifest, then renders every value
   the sources publish for that school, grouped by category.

   Three rules decide what appears:
     a value is shown with the year it describes, never on its own;
     an absence says which kind of absence it is;
     a measure that does not apply to this type of school is not listed as
     missing, because it was never expected. */

(function () {
  'use strict';

  var CATEGORY_ORDER = [
    'demographics', 'attendance', 'state_tests', 'alt_assessments', 'regents',
    'growth', 'coursework', 'graduation', 'college', 'climate',
    'student_support', 'other'
  ];

  var state = { school: null, metrics: null, dbn: null };

  // ---- Small pieces -------------------------------------------------

  function districtLabel(code) {
    var special = { '75': 'District 75, special education',
                    '79': 'District 79, alternative programmes',
                    '84': 'District 84, charter' };
    var plain = String(parseInt(code, 10));
    return special[plain] || ('District ' + plain);
  }

  function latestIndex(series) {
    // The newest year that actually carries a value. A school that stopped
    // reporting last year should show the year it last reported, labelled.
    for (var i = series.y.length - 1; i >= 0; i--) {
      if (!SF.isBlank(series.v[i])) return i;
    }
    return -1;
  }

  // Report types, spelled out. A school serving grades 6 to 12 files two
  // quality reports and publishes some measures in both, for different groups
  // of its own students. Those are two facts, so the profile shows two rows.
  var REPORT_LABEL = {
    EMS: 'elementary and middle grades',
    HS: 'high school grades',
    HST: 'transfer school report',
    EC: 'early childhood report',
    D75: 'District 75 report',
    YABC: 'Young Adult Borough Centre report'
  };

  function splitByReport(series) {
    // Returns one entry per report type. Most metrics have exactly one, in
    // which case the label is left off entirely.
    if (!series) return [];
    if (!series.rt) return [{ label: null, series: series }];
    var groups = {};
    series.y.forEach(function (year, i) {
      var key = series.rt[i] || '';
      var g = groups[key] || (groups[key] = { y: [], v: [], st: [], n: [], c: [], s: [] });
      g.y.push(year);
      g.v.push(series.v[i]);
      g.st.push(series.st[i]);
      if (series.n) g.n.push(series.n[i]);
      if (series.c) g.c.push(series.c[i]);
      if (series.s) g.s.push(series.s[i]);
    });
    return Object.keys(groups).sort().map(function (key) {
      var g = groups[key];
      if (!g.n.length) delete g.n;
      if (!g.c.length) delete g.c;
      if (!g.s.length) delete g.s;
      return { label: REPORT_LABEL[key] || key, series: g };
    });
  }

  function fact(term, value, options) {
    var o = options || {};
    var wrapper = SF.el('div', { class: 'fact' });
    wrapper.appendChild(SF.el('dt', { text: term }));
    var dd = SF.el('dd', { class: o.big ? 'big' : '' });
    if (o.href) {
      dd.appendChild(SF.el('a', { href: o.href, text: value,
                                  rel: o.external ? 'noopener' : null }));
    } else {
      dd.appendChild(document.createTextNode(value));
    }
    if (o.note) dd.appendChild(SF.el('span', { class: 'note', text: o.note }));
    wrapper.appendChild(dd);
    return wrapper;
  }

  // ---- Head and facts ------------------------------------------------

  function renderHead(school) {
    var host = document.getElementById('school-head');
    host.innerHTML = '';

    var kind = [school.school_type, school.status === 'former' ? 'closed' : null]
      .filter(Boolean).join(' · ') || 'New York City public school';
    host.appendChild(SF.el('p', { class: 'kind', text: kind }));
    host.appendChild(SF.el('h1', { text: school.name || school.dbn }));

    var where = [
      school.dbn,
      school.boro,
      districtLabel(school.district),
      school.grades ? 'Grades ' + school.grades : null
    ].filter(Boolean).join(' · ');
    host.appendChild(SF.el('p', { class: 'where mono', text: where }));

    document.title = (school.name || school.dbn) + ' — schoolsfinder.nyc';

    if (school.status === 'former') {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p><strong>This school is not in the current directory or the ' +
              'newest enrolment snapshot.</strong> Its published history is kept ' +
              'here in full. Nothing on this page describes a school you can ' +
              'currently apply to.</p>'
      }));
    }
  }

  function renderFacts(school) {
    var host = document.getElementById('school-facts');
    host.innerHTML = '';

    if (school.enrollment !== null && school.enrollment !== undefined) {
      host.appendChild(fact('Students', SF.fmt.count(school.enrollment),
        { big: true, note: school.enrollment_year || null }));
    }
    if (school.grades) host.appendChild(fact('Grades served', school.grades));
    if (school.address) {
      // An external map link rather than an embedded map: this version of the
      // site does not load a mapping library.
      var query = encodeURIComponent(school.address);
      host.appendChild(fact('Address', school.address, {
        href: 'https://www.openstreetmap.org/search?query=' + query,
        external: true,
        note: school.latitude
          ? (school.coordinate_source === 'source'
              ? 'Coordinates published by the source'
              : 'Coordinates matched from this address')
          : null
      }));
    }
    if (school.phone) host.appendChild(fact('Telephone', school.phone, { href: 'tel:' + school.phone }));
    if (school.website) {
      var url = /^https?:/i.test(school.website) ? school.website : 'https://' + school.website;
      host.appendChild(fact('School website', school.website, { href: url, external: true }));
    }
    if (school.start_time || school.end_time) {
      host.appendChild(fact('School day',
        [school.start_time, school.end_time].filter(Boolean).join(' to ')));
    }
    if (school.accessibility) host.appendChild(fact('Building access', school.accessibility));
    if (school.languages) host.appendChild(fact('Languages taught', school.languages));
    if (school.neighborhood) host.appendChild(fact('Neighbourhood', school.neighborhood));
    // The directories write this as 1 or 0, which means nothing on a page.
    if (school.shared_building === '1' || school.shared_building === 1) {
      host.appendChild(fact('Building', 'Shared with at least one other school'));
    } else if (school.shared_building === '0' || school.shared_building === 0) {
      host.appendChild(fact('Building', 'Not shared with another school'));
    }
    if (school.directory_url) {
      host.appendChild(fact('Directory listing', 'Open in MySchools',
        { href: school.directory_url, external: true }));
    }

    if (!host.children.length) {
      host.appendChild(SF.el('div', {
        class: 'fact',
        html: '<dt>Contact details</dt><dd>Not published for this school. ' +
              'Only schools in a current admissions directory have them.</dd>'
      }));
    }
  }

  function renderOverview(school) {
    var host = document.getElementById('school-overview');
    host.innerHTML = '';
    if (!school.overview) { host.hidden = true; return; }
    host.hidden = false;
    host.appendChild(SF.el('h2', { class: 'section-label', text: 'In the school’s own words' }));
    host.appendChild(SF.el('p', { class: 'prose', text: school.overview }));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'Written by the school for the admissions directory. It is a ' +
            'description, not a measured value.'
    }));
  }

  // ---- Metrics --------------------------------------------------------

  function appliesToSchool(metric, school) {
    var mine = (school.report_types || school.report_type || '').split('|');
    if (!mine.length || !mine[0]) return true;
    return (metric.applies_to || []).some(function (r) { return mine.indexOf(r) !== -1; });
  }

  function metricRow(metricId, metric, series, reportLabel) {
    var item = SF.el('li', { class: 'metric' });
    var label = metric.label || metricId;
    if (reportLabel) label += ', ' + reportLabel;
    item.appendChild(SF.el('span', { class: 'm-label', text: label }));

    var index = series ? latestIndex(series) : -1;
    var value = SF.el('span', { class: 'm-value' });
    var meta = SF.el('span', { class: 'm-meta' });

    if (index >= 0) {
      value.textContent = SF.formatValue(series.v[index], metric.format);
      var bits = [series.y[index]];
      if (series.n && !SF.isBlank(series.n[index])) {
        bits.push(SF.fmt.count(series.n[index]) + ' students');
      }
      if (series.c && !SF.isBlank(series.c[index])) {
        bits.push('comparison group ' + SF.formatValue(series.c[index], metric.format));
      }
      bits.forEach(function (b, i) {
        if (i) meta.appendChild(SF.el('span', { class: 'sep', text: '·' }));
        meta.appendChild(SF.el('span', { text: b }));
      });
    } else {
      // No value anywhere in the series. Say which kind of absence it is,
      // using the source's own status where there is one.
      var status = series && series.st && series.st.length
        ? series.st[series.st.length - 1] : 'missing';
      value.className = 'm-value absent';
      value.textContent = SF.ABSENCE[status] || SF.ABSENCE.missing;
      meta.appendChild(SF.el('span', { text: SF.ABSENCE_DETAIL[status] || SF.ABSENCE_DETAIL.missing }));
    }
    item.appendChild(value);
    item.appendChild(meta);

    item.appendChild(details(metricId, metric, series));
    return item;
  }

  function details(metricId, metric, series) {
    var wrapper = SF.el('details');
    wrapper.appendChild(SF.el('summary', { text: 'Definition, source and history' }));
    var body = SF.el('div', { class: 'm-detail' });

    body.appendChild(SF.el('p', { text: metric.description || metric.label }));
    body.appendChild(SF.el('p', {
      html: 'Unit: ' + SF.escapeHtml(metric.unit) +
            (metric.format_source === 'inferred'
              ? ' <span class="muted">(inferred from the published values, not stated by the source)</span>'
              : '') +
            '. Identifier: <code>' + SF.escapeHtml(metricId) + '</code>.'
    }));
    body.appendChild(SF.el('p', {
      html: 'Source: ' + SF.escapeHtml(metric.source_id) +
            '. Published for school years ' + SF.escapeHtml(String(metric.first_year)) +
            ' to ' + SF.escapeHtml(String(metric.last_year)) +
            '. <a href="method.html">How to read this</a>.'
    }));
    if (metric.comparability_note) {
      body.appendChild(SF.el('p', { html: '<strong>Comparability:</strong> ' +
        SF.escapeHtml(metric.comparability_note) }));
    }

    if (series && series.y.length) {
      var strip = SF.el('div', { class: 'history' });
      series.y.forEach(function (year, i) {
        var chip = SF.el('span', { class: 'h-year' });
        chip.appendChild(document.createTextNode(year + ' '));
        var shown = SF.isBlank(series.v[i])
          ? (SF.ABSENCE[series.st[i]] || SF.ABSENCE.missing)
          : SF.formatValue(series.v[i], metric.format);
        chip.appendChild(SF.el('b', { text: shown }));
        strip.appendChild(chip);
      });
      body.appendChild(strip);
    }

    wrapper.appendChild(body);
    return wrapper;
  }

  function renderMetrics(payload, metrics) {
    var host = document.getElementById('school-metrics');
    host.innerHTML = '';
    var school = payload.school;
    var series = payload.series || {};

    var buckets = {};
    var notReported = {};

    Object.keys(metrics).forEach(function (metricId) {
      var metric = metrics[metricId];
      var parts = splitByReport(series[metricId]);
      var withValues = parts.filter(function (p) { return latestIndex(p.series) >= 0; });
      var category = metric.category || 'other';
      if (withValues.length) {
        withValues.forEach(function (part) {
          (buckets[category] = buckets[category] || [])
            .push([metricId, metric, part.series, part.label]);
        });
      } else {
        if (!appliesToSchool(metric, school)) return;   // never expected here
        (notReported[category] = notReported[category] || []).push(metric.label || metricId);
      }
    });

    var drew = false;
    CATEGORY_ORDER.forEach(function (category) {
      var rows = buckets[category] || [];
      var absent = notReported[category] || [];
      if (!rows.length && !absent.length) return;
      drew = true;

      var label = rows.length ? rows[0][1].category_label
                              : (metricsLabelFor(metrics, category) || category);
      host.appendChild(SF.el('h2', { class: 'section-label', text: label }));

      if (rows.length) {
        rows.sort(function (a, b) {
          return (a[1].headline === b[1].headline)
            ? (a[1].label || '').localeCompare(b[1].label || '')
            : (a[1].headline ? -1 : 1);
        });
        var list = SF.el('ul', { class: 'metric-list' });
        rows.forEach(function (r) { list.appendChild(metricRow(r[0], r[1], r[2], r[3])); });
        host.appendChild(list);
      }

      if (absent.length) {
        var note = SF.el('details', { class: 'section-note' });
        note.appendChild(SF.el('summary', {
          text: absent.length + ' further ' +
                (absent.length === 1 ? 'measure applies' : 'measures apply') +
                ' to this type of school but were not published for it'
        }));
        var ul = SF.el('ul');
        absent.sort().forEach(function (name) { ul.appendChild(SF.el('li', { text: name })); });
        note.appendChild(ul);
        host.appendChild(note);
      }
    });

    if (!drew) {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p><strong>No published statistics for this school.</strong> ' +
              'It is in the school directory but has no quality report or ' +
              'enrolment snapshot yet. This is common for a school that has ' +
              'just opened.</p>'
      }));
    }
  }

  function metricsLabelFor(metrics, category) {
    var found = null;
    Object.keys(metrics).some(function (id) {
      if (metrics[id].category === category) { found = metrics[id].category_label; return true; }
      return false;
    });
    return found;
  }

  // ---- Programmes ------------------------------------------------------

  function renderPrograms(payload) {
    var host = document.getElementById('school-programs');
    host.innerHTML = '';
    var programs = payload.programs || [];
    if (!programs.length) { host.hidden = true; return; }
    host.hidden = false;

    host.appendChild(SF.el('h2', { class: 'section-label', text: 'Programmes and admissions' }));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'Admissions are set per programme, not per school. Seats and ' +
            'applicants are from the Fall 2025 directory and describe that ' +
            'season only. GE means general education seats, SWD means seats ' +
            'set aside for students with disabilities.'
    }));

    var rows = programs.map(function (p) {
      return {
        name: p.name || p.code,
        code: p.code,
        method: p.method,
        seats: joinPair(p.seats_ge, p.seats_swd),
        applicants: joinPair(p.applicants_ge, p.applicants_swd),
        per_seat: joinPair(p.per_seat_ge, p.per_seat_swd, 2),
        eligibility: p.eligibility,
        priorities: (p.priorities || []).join(' → ')
      };
    });

    SFTable.render(host, {
      columns: [
        { key: 'name', label: 'Programme', name: true },
        { key: 'code', label: 'Code' },
        { key: 'method', label: 'Admissions method', wrap: true },
        { key: 'seats', label: 'Seats, GE / SWD', num: true },
        { key: 'applicants', label: 'Applicants, GE / SWD', num: true },
        { key: 'per_seat', label: 'Applicants per seat', num: true },
        { key: 'priorities', label: 'Priority order', wrap: true }
      ],
      rows: rows,
      search: rows.length > 6,
      searchPlaceholder: 'Filter programmes…',
      caption: 'Programmes at this school in the Fall 2025 directory. ' +
               'An empty cell means the directory published no value.'
    });
  }

  function joinPair(a, b, places) {
    var f = function (v) {
      if (SF.isBlank(v)) return null;
      return places ? Number(v).toFixed(places) : SF.fmt.count(v);
    };
    var left = f(a), right = f(b);
    if (left === null && right === null) return null;
    return (left === null ? '—' : left) + ' / ' + (right === null ? '—' : right);
  }

  // ---- Comparison basket ------------------------------------------------

  function renderCompareButton(school) {
    var host = document.getElementById('compare-action');
    host.innerHTML = '';
    var basket = SF.store.get('compare', []);
    var inBasket = basket.indexOf(school.dbn) !== -1;

    var button = SF.el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': inBasket ? 'true' : 'false',
      text: inBasket ? 'In your comparison' : 'Add to comparison'
    });
    button.addEventListener('click', function () {
      var current = SF.store.get('compare', []);
      var at = current.indexOf(school.dbn);
      if (at === -1) {
        if (current.length >= 3) {
          message.textContent = 'A comparison holds three schools. Remove one first.';
          return;
        }
        current.push(school.dbn);
      } else {
        current.splice(at, 1);
      }
      SF.store.set('compare', current);
      renderCompareButton(school);
    });
    host.appendChild(button);

    if (basket.length) {
      host.appendChild(SF.el('a', {
        class: 'pill',
        href: 'compare.html?schools=' + basket.join(','),
        text: 'Compare ' + basket.length +
              (basket.length === 1 ? ' school' : ' schools')
      }));
    }
    var message = SF.el('span', { class: 'count', role: 'status' });
    host.appendChild(message);
  }

  // ---- Entry point --------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var dbn = (SF.param('dbn') || '').toUpperCase();
    var main = document.getElementById('main');

    if (!/^\d{2}[MXKQR]\d{3}$/.test(dbn)) {
      SF.fail(document.getElementById('school-head'),
        new Error('No school was named in the address. Search for one instead.'));
      return;
    }

    SFSearch.mount('#profile-search');

    Promise.all([
      SF.load('schools/' + dbn + '.json'),
      SF.load('metrics.json')
    ]).then(function (both) {
      var payload = both[0], metrics = both[1];
      state.school = payload; state.metrics = metrics; state.dbn = dbn;
      renderHead(payload.school);
      renderFacts(payload.school);
      renderOverview(payload.school);
      renderCompareButton(payload.school);
      renderPrograms(payload);
      renderMetrics(payload, metrics);
    }).catch(function (err) {
      var head = document.getElementById('school-head');
      if (String(err.message || '').indexOf('404') !== -1) {
        head.innerHTML = '<h1>No school with that number</h1>' +
          '<p>Nothing is published under <code>' + SF.escapeHtml(dbn) +
          '</code>. Search by name below.</p>';
      } else {
        SF.fail(head, err);
      }
    });
  });
})();
