/* Browse: filters for finding a school when you do not have a name.
   ------------------------------------------------------------------
   Filter state lives in the URL, so a narrowed list is a link someone can
   send. Nothing here ranks: the list is alphabetical, always. */

(function () {
  'use strict';

  var PAGE_SIZE = 60;
  var shown = PAGE_SIZE;
  var rows = [];

  var FILTERS = [
    { key: 'boro',     label: 'Borough',  all: 'Every borough' },
    { key: 'district', label: 'District', all: 'Every district' },
    { key: 'type',     label: 'Type',     all: 'Every type' },
    { key: 'grade',    label: 'Grade',    all: 'Any grade' },
    { key: 'status',   label: 'Status',   all: 'Open schools' }
  ];

  // Grade filtering works on the grade span the sources publish, which is
  // written in several ways: "PK-5", "K to 8", "9 to 12", "06,07,08". Rather
  // than parse every spelling, match the tokens a reader would search for.
  var GRADE_TESTS = {
    '3K': /(^|[^0-9])3K/i,
    'PK': /\bPK\b|PRE-?K/i,
    'K': /\bK\b|KINDER/i,
    'Elementary': /\b(1|2|3|4|5|01|02|03|04|05)\b/,
    'Middle': /\b(6|7|8|06|07|08)\b/,
    'High': /\b(9|10|11|12|09)\b/
  };

  function gradeMatches(grades, wanted) {
    if (!grades) return false;
    var test = GRADE_TESTS[wanted];
    if (!test) return true;
    // A span such as "K-8" implies the grades between its ends, so expand it
    // before testing rather than matching the written label alone.
    var expanded = expandSpan(grades);
    return test.test(expanded);
  }

  function expandSpan(grades) {
    var text = String(grades).toUpperCase().replace(/\s+TO\s+/g, '-');
    var match = text.match(/(3K|PK|K|\d{1,2})\s*-\s*(3K|PK|K|\d{1,2})/);
    if (!match) return text;
    var order = ['3K', 'PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];
    var from = order.indexOf(match[1].replace(/^0/, ''));
    var to = order.indexOf(match[2].replace(/^0/, ''));
    if (from === -1 || to === -1 || to < from) return text;
    return text + ' ' + order.slice(from, to + 1).join(' ');
  }

  function currentFilters() {
    var state = {};
    FILTERS.forEach(function (f) { state[f.key] = SF.param(f.key) || ''; });
    return state;
  }

  function apply(state) {
    return rows.filter(function (r) {
      // Closed schools keep their profiles and stay findable by search, but a
      // browse list is about schools a family could attend, so open is the
      // default and including the rest is a deliberate choice.
      if (state.status === 'all') { /* keep everything */ }
      else if (state.status === 'former') { if (r.status !== 'former') return false; }
      else if (r.status !== 'open') return false;

      if (state.boro && r.boro !== state.boro) return false;
      if (state.district && r.district !== state.district) return false;
      if (state.type && r.type !== state.type) return false;
      if (state.grade && !gradeMatches(r.grades, state.grade)) return false;
      return true;
    });
  }

  function optionsFor(key) {
    var seen = {};
    rows.forEach(function (r) {
      var v = r[key];
      if (v) seen[v] = (seen[v] || 0) + 1;
    });
    return Object.keys(seen).sort(function (a, b) {
      return a.localeCompare(b, 'en', { numeric: true });
    });
  }

  function buildControls(host, state, onChange) {
    host.innerHTML = '';
    FILTERS.forEach(function (f) {
      var wrapper = SF.el('div', { class: 'control' });
      var id = 'filter-' + f.key;
      wrapper.appendChild(SF.el('label', { for: id, text: f.label }));
      var select = SF.el('select', { id: id });

      var choices;
      if (f.key === 'grade') choices = Object.keys(GRADE_TESTS);
      else if (f.key === 'status') choices = [];
      else choices = optionsFor(f.key);

      if (f.key === 'status') {
        [['', 'Open schools'], ['all', 'Open and closed'], ['former', 'Closed only']]
          .forEach(function (pair) {
            select.appendChild(SF.el('option', { value: pair[0], text: pair[1] }));
          });
      } else {
        select.appendChild(SF.el('option', { value: '', text: f.all }));
        choices.forEach(function (c) {
          var label = f.key === 'district' ? districtLabel(c) : c;
          select.appendChild(SF.el('option', { value: c, text: label }));
        });
      }

      select.value = state[f.key] || '';
      select.addEventListener('change', function () {
        SF.setParam(f.key, select.value, true);
        onChange();
      });
      wrapper.appendChild(select);
      host.appendChild(wrapper);
    });

    var reset = SF.el('div', { class: 'control' });
    reset.appendChild(SF.el('label', { html: '&nbsp;', 'aria-hidden': 'true' }));
    var button = SF.el('button', { class: 'pill', type: 'button', text: 'Clear filters' });
    button.addEventListener('click', function () {
      FILTERS.forEach(function (f) { SF.setParam(f.key, '', true); });
      onChange();
    });
    reset.appendChild(button);
    host.appendChild(reset);
  }

  function districtLabel(code) {
    var special = { '75': 'District 75, special education', '79': 'District 79, alternative',
                    '84': 'District 84, charter' };
    var plain = String(parseInt(code, 10));
    return special[plain] || ('District ' + plain);
  }

  function card(row) {
    var link = SF.el('a', {
      class: 'school-card',
      href: 'school.html?dbn=' + encodeURIComponent(row.dbn)
    });
    link.appendChild(SF.el('span', { class: 'name', text: row.name || row.dbn }));
    var where = [row.boro, districtLabel(row.district)].filter(Boolean).join(' · ');
    link.appendChild(SF.el('span', { class: 'where', text: where }));
    var ident = [row.dbn, row.grades, row.type].filter(Boolean).join(' · ');
    if (row.status === 'former') ident += ' · closed';
    link.appendChild(SF.el('span', { class: 'ident', text: ident }));
    return link;
  }

  function draw() {
    var state = currentFilters();
    var list = apply(state);
    var grid = document.getElementById('school-list');
    var count = document.getElementById('school-count');
    var more = document.getElementById('show-more');

    grid.innerHTML = '';
    list.slice(0, shown).forEach(function (row) {
      grid.appendChild(SF.el('li', {}, [card(row)]));
    });

    count.textContent = list.length === 0
      ? 'No schools match these filters.'
      : (shown < list.length
          ? 'Showing ' + shown.toLocaleString('en-US') + ' of ' +
            list.length.toLocaleString('en-US') + ' schools, in alphabetical order.'
          : list.length.toLocaleString('en-US') +
            (list.length === 1 ? ' school.' : ' schools, in alphabetical order.'));

    more.hidden = shown >= list.length;
    more.textContent = 'Show ' + Math.min(PAGE_SIZE, list.length - shown) + ' more';
  }

  document.addEventListener('DOMContentLoaded', function () {
    SFSearch.mount('#browse-search', {});

    var listHost = document.getElementById('browse');
    SFSearch.data().then(function (data) {
      rows = data;
      var controls = document.getElementById('filters');
      buildControls(controls, currentFilters(), function () { shown = PAGE_SIZE; draw(); });

      document.getElementById('show-more').addEventListener('click', function () {
        shown += PAGE_SIZE;
        draw();
      });

      draw();
    }).catch(function (err) { SF.fail(listHost, err); });
  });
})();
