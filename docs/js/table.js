/* Sortable, filterable tables.
   ------------------------------------------------------------------
   SFTable.render(target, { columns, rows, search, caption, limit })

   Kept deliberately small. Sorting is stable and puts absent values last in
   both directions, because a value the source withheld is unknown rather than
   the lowest one. */

(function () {
  'use strict';

  function isAbsent(v) {
    return v === null || v === undefined || v === '' ||
           (typeof v === 'number' && isNaN(v));
  }

  function render(target, cfg) {
    var host = typeof target === 'string' ? document.querySelector(target) : target;
    if (!host) return;

    var columns = cfg.columns;
    var rows = cfg.rows.slice();
    var sortKey = cfg.sortKey || null;
    var sortDir = cfg.sortDir || 'asc';
    var filter = '';
    var expanded = false;

    var block = document.createElement('div');

    var tools = document.createElement('div');
    tools.className = 'table-tools';

    if (cfg.search !== false) {
      var input = document.createElement('input');
      input.type = 'search';
      input.placeholder = cfg.searchPlaceholder || 'Filter…';
      input.setAttribute('aria-label', cfg.searchPlaceholder || 'Filter this table');
      input.addEventListener('input', function () {
        filter = input.value.trim().toLowerCase();
        draw();
      });
      tools.appendChild(input);
    }

    var count = document.createElement('span');
    count.className = 'count';
    count.setAttribute('role', 'status');
    tools.appendChild(count);

    var more = null;
    if (cfg.limit) {
      more = document.createElement('button');
      more.type = 'button';
      more.className = 'pill';
      more.addEventListener('click', function () { expanded = !expanded; draw(); });
      tools.appendChild(more);
    }
    if (tools.children.length) block.appendChild(tools);

    var wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    // The wrapper scrolls sideways on a narrow screen, so it must be reachable
    // from the keyboard and announced as a region.
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', cfg.caption || 'Data table');

    var table = document.createElement('table');
    if (cfg.tableClass) table.className = cfg.tableClass;
    if (cfg.caption) {
      var caption = document.createElement('caption');
      caption.className = 'sr-only';
      caption.textContent = cfg.caption;
      table.appendChild(caption);
    }

    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    columns.forEach(function (c) {
      var th = document.createElement('th');
      th.scope = 'col';
      // A column may supply structured markup for its heading, so a long
      // measure name can put its qualifier on a second, quieter line without
      // the label itself being rewritten.
      if (c.labelHtml) th.innerHTML = c.labelHtml;
      else if (c.gutter) {
        // A control column still needs a name for anyone not looking at it.
        th.innerHTML = '<span class="sr-only">' + (c.label || 'Actions') + '</span>';
      } else th.textContent = c.label;
      if (c.title) th.title = c.title;
      if (c.num) th.className = 'num';
      if (c.gutter) th.classList.add('gutter');
      if (c.sortable !== false) {
        th.classList.add('sortable');
        th.tabIndex = 0;
        var activate = function () {
          if (sortKey === c.key) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
          else { sortKey = c.key; sortDir = c.num ? 'desc' : 'asc'; }
          draw();
        };
        th.addEventListener('click', activate);
        th.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
        });
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);

    if (cfg.caption) {
      block.appendChild(SF.el('p', { class: 'section-note', text: cfg.caption }));
    }
    host.appendChild(block);

    function visible() {
      var out = rows;
      if (filter) {
        out = out.filter(function (r) {
          return columns.some(function (c) {
            var v = r[c.key];
            return !isAbsent(v) && String(v).toLowerCase().indexOf(filter) !== -1;
          });
        });
      }
      if (sortKey) {
        out = out.slice().sort(function (a, b) {
          var av = a[sortKey], bv = b[sortKey];
          if (isAbsent(av) && isAbsent(bv)) return 0;
          if (isAbsent(av)) return 1;
          if (isAbsent(bv)) return -1;
          if (typeof av === 'number' && typeof bv === 'number') {
            return sortDir === 'asc' ? av - bv : bv - av;
          }
          return sortDir === 'asc'
            ? String(av).localeCompare(String(bv), 'en', { numeric: true })
            : String(bv).localeCompare(String(av), 'en', { numeric: true });
        });
      }
      return out;
    }

    function draw() {
      var data = visible();

      columns.forEach(function (c, i) {
        var th = headRow.children[i];
        if (c.key === sortKey) {
          th.setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');
        } else {
          th.removeAttribute('aria-sort');
        }
      });

      tbody.innerHTML = '';
      var limit = (!cfg.limit || expanded) ? data.length : cfg.limit;
      data.slice(0, limit).forEach(function (r) {
        var tr = document.createElement('tr');
        columns.forEach(function (c) {
          var cell = document.createElement(c.rowHeader ? 'th' : 'td');
          if (c.rowHeader) cell.scope = 'row';
          var v = r[c.key];
          if (c.render) {
            var out = c.render(v, r);
            if (out instanceof Node) cell.appendChild(out);
            else cell.innerHTML = out;
          } else if (isAbsent(v)) {
            // An empty cell is written out, not left blank, so nobody reads a
            // gap as a zero.
            cell.textContent = '—';
            cell.className = 'muted';
            cell.setAttribute('aria-label', 'Not published');
          } else {
            cell.textContent = v;
          }
          if (c.num) cell.classList.add('num');
          if (c.name) cell.classList.add('name');
          if (c.wrap) cell.classList.add('wrap-cell');
          if (c.gutter) cell.classList.add('gutter');
          tr.appendChild(cell);
        });
        tbody.appendChild(tr);
      });

      var shown = Math.min(limit, data.length);
      count.textContent = shown === data.length
        ? data.length.toLocaleString('en-US') + ' rows'
        : shown.toLocaleString('en-US') + ' of ' + data.length.toLocaleString('en-US');

      if (more) {
        var hidden = data.length - shown;
        more.hidden = !(hidden > 0 || expanded);
        more.textContent = expanded ? 'Show first ' + cfg.limit
                                    : 'Show all ' + data.length.toLocaleString('en-US');
      }
    }

    draw();
    return { redraw: draw, setRows: function (r) { rows = r.slice(); draw(); } };
  }

  window.SFTable = { render: render };
})();
