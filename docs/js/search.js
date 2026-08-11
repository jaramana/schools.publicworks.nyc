/* School search, shared by the finder and the comparison page.
   ------------------------------------------------------------------
   SFSearch.mount(host, { onPick, autofocus, placeholder, label, exclude })

   `exclude` is called with a row and drops it from the results when it returns
   true, so a caller can leave out schools it would only refuse.

   Matches a school name or a DBN against the search index. The index is one
   small file, so the whole thing is held in memory and every keystroke is
   answered locally. */

(function () {
  'use strict';

  var MAX_RESULTS = 10;
  var MIN_QUERY = 2;
  var index = null;

  function data() {
    if (!index) index = SF.load('search-index.json');
    return index;
  }

  // A DBN is exact and unambiguous, so a query that looks like one is treated
  // as an identifier rather than as text to match loosely.
  var DBN_RE = /^\d{2}[mxkqrMXKQR]\d{3}$/;

  function score(rows, query) {
    if (DBN_RE.test(query)) {
      var wanted = query.toUpperCase();
      return rows.filter(function (r) { return r.dbn === wanted; });
    }

    // Every word must appear somewhere, in any order. Official school names
    // are long and formal, so "bronx science" has to find "The Bronx High
    // School of Science" and "ps 15" has to find "P.S. 015 Roberto Clemente".
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];

    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var hit = matchRow(rows[i], terms);
      if (hit) out.push(hit);
    }

    out.sort(function (a, b) {
      return a.open - b.open ||            // open schools before closed ones
             a.loose - b.loose ||          // whole words before parts of words
             a.lead - b.lead ||            // matches nearer the start of the name
             // Then the shortest name. Among schools that all match every word,
             // the one with least other wording is usually the one meant: for
             // "bronx science", the Bronx High School of Science rather than
             // the Bronx Arts and Science Charter School.
             a.length - b.length ||
             a.at - b.at ||
             (a.row.name || '').localeCompare(b.row.name || '');
    });
    return out.slice(0, MAX_RESULTS).map(function (x) { return x.row; });
  }

  function matchRow(row, terms) {
    var name = (row.name || '').toLowerCase();
    // Two normal forms. `spaced` turns punctuation into gaps so "015" is its
    // own word; `tight` removes it so a typed "ps" reaches a written "P.S.".
    var spaced = name.replace(/[.,'()\-\/:&]/g, ' ').replace(/\s+/g, ' ').trim();
    var tight = name.replace(/[^a-z0-9]/g, '');
    var dbn = row.dbn.toLowerCase();

    var positions = [];
    // How loosely each term matched, summed. A whole word is worth most: for
    // "ps 15", P.S. 15 should come before P.S. 150, and for "bronx science"
    // the school called Science should come before one called Sciences.
    var EXACT = 0, PREFIX = 1, INSIDE = 3;
    var loose = 0;

    for (var t = 0; t < terms.length; t++) {
      var term = terms[t].replace(/[^a-z0-9]/g, '');
      if (!term) continue;
      var at = -1;
      var quality = INSIDE;

      // A number matches ignoring leading zeros in either direction, so "15"
      // reaches "P.S. 015" and "015" reaches "P.S. 15".
      if (/^\d+$/.test(term)) {
        var padded = spaced.search(new RegExp('\\b0*' + term + '\\b'));
        if (padded !== -1) { at = padded; quality = EXACT; }
      }
      if (at === -1) {
        var whole = spaced.search(new RegExp('\\b' + escapeRe(term) + '\\b'));
        if (whole !== -1) { at = whole; quality = EXACT; }
      }
      if (at === -1) {
        var start = spaced.search(new RegExp('\\b' + escapeRe(term)));
        if (start !== -1) { at = start; quality = PREFIX; }
      }
      if (at === -1) at = spaced.indexOf(term);
      if (at === -1) at = tight.indexOf(term);
      if (at === -1) {
        // Falling back to the DBN only helps for a distinctive fragment. A
        // bare two-digit number is a district, so "ps 15" would otherwise
        // return every school in District 15 rather than the P.S. 15s.
        var inDbn = term.length >= 3 ? dbn.indexOf(term) : -1;
        if (inDbn === -1) return null;    // this term is nowhere, so no match
        at = inDbn;
        quality = EXACT;
      }
      loose += quality;
      positions.push(at);
    }
    if (!positions.length) return null;

    return {
      row: row,
      loose: loose,
      lead: positions[0],
      at: Math.max.apply(null, positions),
      length: name.length,
      open: row.status === 'open' ? 0 : 1
    };
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function mount(host, opts) {
    host = typeof host === 'string' ? document.querySelector(host) : host;
    if (!host) return null;
    var o = opts || {};
    var active = -1;
    var listId = 'sf-results-' + Math.random().toString(36).slice(2, 8);

    host.classList.add('search-shell');
    host.innerHTML =
      '<div class="search-row">' +
        '<label class="sr-only" for="' + listId + '-input">' +
          (o.label || 'Search for a school by name or DBN') + '</label>' +
        '<input id="' + listId + '-input" type="search" autocomplete="off" ' +
               'spellcheck="false" role="combobox" aria-expanded="false" ' +
               'aria-autocomplete="list" aria-controls="' + listId + '" ' +
               'placeholder="' + (o.placeholder || 'Loading schools…') + '">' +
      '</div>' +
      '<ul class="results" role="listbox" id="' + listId + '" ' +
          'aria-label="Search results"></ul>' +
      '<p class="sr-only" role="status" aria-live="polite"></p>';

    var input = host.querySelector('input');
    var results = host.querySelector('.results');
    var announce = host.querySelector('[role="status"]');

    data().then(function (rows) {
      input.placeholder = o.placeholder ||
        ('Search ' + rows.length.toLocaleString('en-US') + ' schools by name or DBN…');
    }).catch(function (err) { SF.fail(host, err); });

    function render(list) {
      results.innerHTML = '';
      active = -1;
      input.setAttribute('aria-expanded', list.length ? 'true' : 'false');
      input.removeAttribute('aria-activedescendant');
      list.forEach(function (row, i) {
        var li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', 'false');
        li.id = listId + '-opt-' + i;
        var button = document.createElement('button');
        button.type = 'button';
        var where = [row.boro, row.grades].filter(Boolean).join(' · ');
        button.innerHTML =
          '<span class="r-name">' + SF.escapeHtml(row.name || row.dbn) +
            (row.status === 'former' ? ' <span class="muted">(closed)</span>' : '') +
          '</span>' +
          '<span class="meta mono">' + SF.escapeHtml(row.dbn) +
            (where ? ' · ' + SF.escapeHtml(where) : '') + '</span>';
        button.addEventListener('click', function () { pick(row); });
        li.appendChild(button);
        results.appendChild(li);
      });
      if (announce) {
        announce.textContent = list.length
          ? list.length + ' schools found'
          : (input.value.trim().length >= MIN_QUERY ? emptyNote : '');
      }
    }

    // What an empty result list means. Normally there was no match; when every
    // match was excluded, saying "No schools found" about a school the reader
    // can see on their own shortlist would be a small lie.
    var emptyNote = 'No schools found';

    function pick(row) {
      render([]);
      if (o.onPick) o.onPick(row);
      else location.href = 'school.html?dbn=' + encodeURIComponent(row.dbn);
    }

    function run() {
      var query = input.value.trim();
      if (query.length < MIN_QUERY) { render([]); return; }
      data().then(function (rows) {
        var hits = score(rows, query);
        // A caller can drop rows that would be refused anyway. Offering a
        // school the comparison already holds, and answering the click with a
        // message, makes the reader do the work of noticing; leaving it out of
        // the list says the same thing without being told.
        if (o.exclude) {
          var kept = hits.filter(function (r) { return !o.exclude(r); });
          emptyNote = (!kept.length && hits.length)
            ? (o.excludedNote || 'Already chosen')
            : 'No schools found';
          hits = kept;
        }
        render(hits);
      });
    }

    function move(step) {
      var items = results.querySelectorAll('li');
      if (!items.length) return;
      if (active >= 0) {
        items[active].classList.remove('active');
        items[active].setAttribute('aria-selected', 'false');
      }
      active = (active + step + items.length) % items.length;
      items[active].classList.add('active');
      items[active].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', items[active].id);
      items[active].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      var items = results.querySelectorAll('li');
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0 && items[active]) items[active].querySelector('button').click();
        else {
          var query = input.value.trim();
          if (query.length >= MIN_QUERY) data().then(function (rows) {
            var hits = score(rows, query);
            if (hits.length) pick(hits[0]);
          });
        }
      } else if (e.key === 'Escape') { render([]); }
    });

    document.addEventListener('click', function (e) {
      if (!host.contains(e.target)) render([]);
    });

    if (o.autofocus && window.matchMedia('(hover: hover)').matches) input.focus();

    return {
      focus: function () { input.focus(); },
      clear: function () { input.value = ''; render([]); },
      // Used when a page swaps a placeholder box for the real one and needs to
      // carry across whatever had already been typed.
      setValue: function (value) {
        input.value = value;
        if (value) run();
      }
    };
  }

  window.SFSearch = { mount: mount, data: data };
})();
