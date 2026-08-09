/* The data page: downloads, source coverage and freshness, data dictionary.
   ------------------------------------------------------------------
   Everything shown here is read from the same status and sources files the
   pipeline writes, so the page cannot claim a freshness the build did not
   produce. */

(function () {
  'use strict';

  function bytes(n) {
    if (SF.isBlank(n)) return null;
    n = Number(n);
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function renderCounts(status) {
    var host = document.getElementById('counts');
    host.innerHTML = '';
    var c = status.counts;
    [
      ['Schools', SF.fmt.count(c.schools), SF.fmt.count(c.schools_open) + ' currently open'],
      ['Measures', SF.fmt.count(c.metrics), 'each with a definition and a period'],
      ['Published values', SF.fmt.count(c.observations_reported),
       'out of ' + SF.fmt.count(c.observations) + ' rows'],
      ['Programs', SF.fmt.count(c.programs), 'from the Fall 2025 directories']
    ].forEach(function (row) {
      var block = SF.el('div', { class: 'fact' });
      block.appendChild(SF.el('dt', { text: row[0] }));
      var dd = SF.el('dd', { class: 'big', text: row[1] });
      dd.appendChild(SF.el('span', { class: 'note', text: row[2] }));
      block.appendChild(dd);
      host.appendChild(block);
    });
  }

  function renderDownloads(status) {
    var host = document.getElementById('download-list');
    host.innerHTML = '';
    var files = [
      {
        href: 'downloads/' + status.downloads.xlsx,
        title: 'Excel workbook',
        text: 'Five sheets: schools, headline measures across every year, ' +
              'programs and admissions, the data dictionary, and the sources ' +
              'with their coverage.'
      },
      {
        href: 'downloads/' + status.downloads.zip,
        title: 'CSV archive',
        text: 'Normalized tables for analysis, including every published value ' +
              'for every year. Join on the DBN.'
      }
    ];
    files.forEach(function (f) {
      var link = SF.el('a', { class: 'download', href: f.href });
      link.appendChild(SF.el('h3', { text: f.title }));
      link.appendChild(SF.el('p', { text: f.text }));
      link.appendChild(SF.el('span', { class: 'size', text: f.href.split('/').pop() }));
      host.appendChild(link);
    });
  }

  function renderSources(sources, status) {
    var host = document.getElementById('source-table');
    host.innerHTML = '';
    var stale = {};
    (status.stale_sources || []).forEach(function (s) { stale[s.source_id] = s; });

    var rows = sources.map(function (s) {
      return {
        title: s.title,
        agency: s.agency,
        period: s.latest_period || '—',
        rows: SF.isBlank(s.rows) ? null : Number(s.rows),
        schools: SF.isBlank(s.schools) ? null : Number(s.schools),
        retrieved: s.retrieved,
        state: stale[s.source_id] ? 'Overdue by ' +
               (stale[s.source_id].days - stale[s.source_id].limit) + ' days' : 'Current',
        limitations: s.limitations,
        url: s.url
      };
    });

    SFTable.render(host, {
      columns: [
        { key: 'title', label: 'Source', name: true, rowHeader: true,
          render: function (v, r) {
            return '<a href="' + SF.escapeHtml(r.url) + '">' + SF.escapeHtml(v) + '</a>' +
              '<br><span class="muted">' + SF.escapeHtml(r.agency) + '</span>';
          } },
        { key: 'period', label: 'Latest period' },
        { key: 'rows', label: 'Rows', num: true,
          render: function (v) { return SF.isBlank(v) ? '—' : SF.fmt.count(v); } },
        { key: 'schools', label: 'Schools', num: true,
          render: function (v) { return SF.isBlank(v) ? '—' : SF.fmt.count(v); } },
        { key: 'retrieved', label: 'Retrieved' },
        { key: 'state', label: 'Freshness' },
        { key: 'limitations', label: 'Known limits', wrap: true }
      ],
      rows: rows,
      search: false,
      caption: 'Every source behind this site, with the reporting period read ' +
               'from the data itself rather than from the file date.'
    });
  }

  function renderDictionary() {
    var host = document.getElementById('dict-table');
    SF.load('metrics.json').then(function (metrics) {
      var rows = Object.keys(metrics).map(function (id) {
        var m = metrics[id];
        return {
          id: id,
          label: m.label,
          category: m.category_label,
          unit: m.unit + (m.format_source === 'inferred' ? ' (inferred)' : ''),
          applies: (m.applies_to || []).join(', '),
          years: (m.first_year || '') + ' to ' + (m.last_year || ''),
          source: m.source_id
        };
      });
      rows.sort(function (a, b) { return a.category.localeCompare(b.category) ||
                                         a.label.localeCompare(b.label); });
      SFTable.render(host, {
        columns: [
          { key: 'label', label: 'Measure', name: true, rowHeader: true },
          { key: 'id', label: 'Identifier',
            render: function (v) { return '<code>' + SF.escapeHtml(v) + '</code>'; } },
          { key: 'category', label: 'Section' },
          { key: 'unit', label: 'Unit', wrap: true },
          { key: 'applies', label: 'Applies to' },
          { key: 'years', label: 'Years' },
          { key: 'source', label: 'Source' }
        ],
        rows: rows,
        limit: 40,
        searchPlaceholder: 'Search ' + rows.length + ' measures…',
        caption: 'Every measure published on this site. The identifier is the ' +
                 'column name in the downloads.'
      });
    }).catch(function (err) { SF.fail(host, err); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    Promise.all([SF.load('status.json'), SF.load('sources.json')])
      .then(function (both) {
        renderCounts(both[0]);
        renderDownloads(both[0]);
        renderSources(both[1], both[0]);
        renderDictionary();
      })
      .catch(function (err) { SF.fail(document.getElementById('counts'), err); });
  });
})();
