/* Browse: filters for finding a school when you do not have a name.
   ------------------------------------------------------------------
   Filter state lives in the URL, so a narrowed list is a link someone can
   send. Nothing here ranks: the list is alphabetical, always. The map shows
   the same filtered list, and every point is drawn alike. */

(function () {
  'use strict';

  var PAGE_SIZE = 60;
  var shown = PAGE_SIZE;
  var rows = [];

  // The map is built on first use and kept, so switching views is instant
  // after that. `mapReady` resolves with the map, or null if it cannot draw.
  var mapReady = null;
  var popup = null;
  var hovered = null;
  var selected = null;
  var current = [];
  var byDbn = {};
  var scrollAfterDraw = null;

  // A wide screen shows the list beside a pinned map. A narrow one shows
  // one at a time and swaps them with a floating button.
  var wide = window.matchMedia('(min-width: 60rem)');

  var FILTERS = [
    { key: 'boro',     label: 'Borough',  all: 'Every borough' },
    { key: 'district', label: 'District', all: 'Every district' },
    { key: 'type',     label: 'Type',     all: 'Every type' },
    { key: 'grade',    label: 'Grade',    all: 'Any grade' },
    { key: 'status',   label: 'Open schools' }
  ];

  // Status has no "every" choice. Open schools is the default, and the chip
  // is tinted only when a reader asks for closed schools too.
  var STATUS = [['', 'Open schools'], ['all', 'Open and closed'], ['former', 'Closed only']];

  // Grade values stay short in the address. The chip and the menu say more.
  var GRADE_NAMES = {
    '3K': ['3-K', '3-K'],
    'PK': ['Pre-K', 'Pre-K'],
    'K': ['Kindergarten', 'Kindergarten'],
    'Elementary': ['Grades 1–5', 'Elementary, grades 1–5'],
    'Middle': ['Grades 6–8', 'Middle, grades 6–8'],
    'High': ['Grades 9–12', 'High school, grades 9–12']
  };

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
    // A typed link may say district=2; the data says "02".
    if (/^\d$/.test(state.district)) state.district = '0' + state.district;
    return state;
  }

  // `skip` leaves one filter out, which is how each menu counts its choices:
  // every other filter applies, and the count shows what picking one gives.
  function apply(state, skip) {
    return rows.filter(function (r) {
      // Closed schools keep their profiles and stay findable by search, but a
      // browse list is about schools a family could attend, so open is the
      // default and including the rest is a deliberate choice.
      if (skip !== 'status') {
        if (state.status === 'all') { /* keep everything */ }
        else if (state.status === 'former') { if (r.status !== 'former') return false; }
        else if (r.status !== 'open') return false;
      }
      if (skip !== 'boro' && state.boro && r.boro !== state.boro) return false;
      if (skip !== 'district' && state.district && r.district !== state.district) return false;
      if (skip !== 'type' && state.type && r.type !== state.type) return false;
      if (skip !== 'grade' && state.grade && !gradeMatches(r.grades, state.grade)) return false;
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

  // Districts 1 to 32 each sit in one borough. The citywide districts, 75
  // and up, get a group of their own.
  var districtBoro = {};

  function mapDistricts() {
    var tally = {};
    rows.forEach(function (r) {
      if (!r.district || !r.boro) return;
      var t = tally[r.district] = tally[r.district] || {};
      t[r.boro] = (t[r.boro] || 0) + 1;
    });
    Object.keys(tally).forEach(function (d) {
      var t = tally[d];
      districtBoro[d] = parseInt(d, 10) >= 75 ? 'Citywide'
        : Object.keys(t).sort(function (a, b) { return t[b] - t[a]; })[0];
    });
  }

  function isSet(key, state) { return !!state[key]; }

  // The value a set chip shows.
  function chipText(f, state) {
    var v = state[f.key];
    if (!v) return f.label;
    if (f.key === 'district') return 'District ' + parseInt(v, 10);
    if (f.key === 'grade') return (GRADE_NAMES[v] || [v])[0];
    if (f.key === 'status') return STATUS.filter(function (p) { return p[0] === v; })[0][1];
    return v;
  }

  // Each choice in a menu, with its label, count and group.
  function choicesFor(f, state) {
    var pool = apply(state, f.key);
    if (f.key === 'status') {
      var probe = Object.assign({}, state);
      return STATUS.map(function (p) {
        probe.status = p[0];
        return { value: p[0], label: p[1], n: apply(probe).length };
      });
    }
    var values = f.key === 'grade' ? Object.keys(GRADE_TESTS) : optionsFor(f.key);
    var counts = {};
    if (f.key === 'grade') {
      values.forEach(function (g) {
        counts[g] = pool.filter(function (r) { return gradeMatches(r.grades, g); }).length;
      });
    } else {
      pool.forEach(function (r) { counts[r[f.key]] = (counts[r[f.key]] || 0) + 1; });
    }
    var list = values.map(function (v) {
      return {
        value: v, n: counts[v] || 0,
        label: f.key === 'district' ? districtLabel(v)
             : f.key === 'grade' ? GRADE_NAMES[v][1] : v,
        group: f.key === 'district' ? districtBoro[v] : null
      };
    });
    if (f.key === 'district') {
      // A long menu with a borough set shows only that borough's districts.
      list = list.filter(function (c) { return c.n > 0 || c.value === state.district; });
      var order = optionsFor('boro').concat('Citywide');
      list.sort(function (a, b) {
        return order.indexOf(a.group) - order.indexOf(b.group) ||
               parseInt(a.value, 10) - parseInt(b.value, 10);
      });
    }
    return [{ value: '', label: f.all, n: pool.length, all: true }].concat(list);
  }

  // ---- Filter chips ----------------------------------------------------

  var openMenu = null;

  function closeMenu(refocus) {
    if (!openMenu) return;
    var chip = openMenu.chip;
    openMenu.menu.remove();
    openMenu.button.setAttribute('aria-expanded', 'false');
    // The menu is gone, so the button no longer points at it.
    openMenu.button.removeAttribute('aria-controls');
    openMenu = null;
    if (refocus) chip.querySelector('.chip-main').focus();
  }

  function pick(key, value, onChange) {
    closeMenu(false);
    SF.setParam(key, value, true);
    onChange();
    var again = document.getElementById('chip-' + key);
    if (again) again.focus();
  }

  function openFor(f, chip, button, state, onChange) {
    closeMenu(false);
    var menu = SF.el('div', { class: 'chip-menu', role: 'listbox', id: 'menu-' + f.key,
                              'aria-label': f.key === 'status' ? 'Status' : f.label });
    var lastGroup = null;
    choicesFor(f, state).forEach(function (c) {
      if (c.all && f.key === 'status') return;
      if (c.group && c.group !== lastGroup) {
        menu.appendChild(SF.el('div', { class: 'opt-group', role: 'presentation', text: c.group }));
        lastGroup = c.group;
      }
      var selected = (state[f.key] || '') === c.value;
      var opt = SF.el('button', {
        type: 'button', role: 'option', 'aria-selected': String(selected),
        class: 'opt' + (c.all ? ' opt-all' : '') + (c.n === 0 ? ' is-empty' : '')
      }, [SF.el('span', { text: c.label }),
          SF.el('span', { class: 'n', text: c.n.toLocaleString('en-US') })]);
      opt.addEventListener('click', function () { pick(f.key, c.value, onChange); });
      menu.appendChild(opt);
    });

    chip.appendChild(menu);
    button.setAttribute('aria-expanded', 'true');
    button.setAttribute('aria-controls', menu.id);
    openMenu = { chip: chip, button: button, menu: menu };

    // A menu near the rail's right edge opens leftward, so the rail's own
    // scroll never clips it.
    var bound = chip.closest('.rail') || document.body;
    if (menu.getBoundingClientRect().right > bound.getBoundingClientRect().right - 8) {
      menu.classList.add('to-left');
    }
    var start = menu.querySelector('[aria-selected="true"]') || menu.querySelector('.opt');
    if (start) {
      start.focus();
      start.scrollIntoView({ block: 'nearest' });
    }
  }

  function menuKeys(ev) {
    if (!openMenu) return;
    var opts = Array.prototype.slice.call(openMenu.menu.querySelectorAll('.opt'));
    var at = opts.indexOf(document.activeElement);
    var to = null;
    if (ev.key === 'ArrowDown') to = Math.min(at + 1, opts.length - 1);
    else if (ev.key === 'ArrowUp') to = Math.max(at - 1, 0);
    else if (ev.key === 'Home') to = 0;
    else if (ev.key === 'End') to = opts.length - 1;
    else if (ev.key === 'Escape') { ev.preventDefault(); closeMenu(true); return; }
    else if (ev.key === 'Tab') { closeMenu(false); return; }
    if (to !== null) { ev.preventDefault(); opts[to].focus(); }
  }

  function buildChips(host, state, onChange) {
    closeMenu(false);
    host.innerHTML = '';
    FILTERS.forEach(function (f) {
      var set = isSet(f.key, state);
      var chip = SF.el('div', { class: 'chip' + (set ? ' is-set' : '') });
      var button = SF.el('button', {
        type: 'button', class: 'chip-main', id: 'chip-' + f.key,
        'aria-haspopup': 'listbox', 'aria-expanded': 'false',
        'aria-label': (f.key === 'status' ? 'Status' : f.label) + ': ' +
                      (set ? chipText(f, state) : (f.all || 'Open schools'))
      }, [SF.el('span', { text: chipText(f, state) }),
          SF.el('span', { class: 'chev', 'aria-hidden': 'true', text: '▼' })]);
      button.addEventListener('click', function () {
        if (openMenu && openMenu.chip === chip) closeMenu(false);
        else openFor(f, chip, button, currentFilters(), onChange);
      });
      button.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' && !openMenu) {
          ev.preventDefault();
          openFor(f, chip, button, currentFilters(), onChange);
        }
      });
      chip.appendChild(button);

      if (set) {
        var clear = SF.el('button', { type: 'button', class: 'chip-clear',
          'aria-label': 'Clear ' + (f.key === 'status' ? 'status' : f.label.toLowerCase()), text: '×' });
        clear.addEventListener('click', function () { pick(f.key, '', onChange); });
        chip.appendChild(clear);
      }
      host.appendChild(chip);
    });

    var clearAll = document.getElementById('clear-filters');
    clearAll.hidden = !FILTERS.some(function (f) { return isSet(f.key, state); });
  }

  function districtLabel(code) {
    var special = { '75': 'District 75, special education', '79': 'District 79, alternative',
                    '84': 'District 84, charter' };
    var plain = String(parseInt(code, 10));
    return special[plain] || ('District ' + plain);
  }

  // A row selects its school rather than leaving the page. The selected row
  // opens in place with the profile link and the comparison button, and the
  // map moves to the school.
  function row(r) {
    var host = SF.el('div', { class: 'school-row', 'data-dbn': r.dbn });
    var main = SF.el('button', { type: 'button', class: 'row-main', 'aria-expanded': 'false' });
    main.appendChild(SF.el('span', { class: 'name', text: r.name || r.dbn }));
    var dbn = SF.el('span', { class: 'dbn' }, [
      SF.el('span', { class: 'comparing', title: 'In your comparison', 'aria-hidden': 'true', text: '✓ ' }),
      SF.el('span', { class: 'sr-only comparing', text: 'In your comparison. ' }),
      document.createTextNode(r.dbn)
    ]);
    main.appendChild(dbn);
    var meta = SF.el('span', { class: 'meta',
      text: [r.boro, districtLabel(r.district), r.grades, r.type].filter(Boolean).join(' · ') });
    if (r.status === 'former') meta.appendChild(SF.el('span', { class: 'closed', text: ' · Closed' }));
    main.appendChild(meta);
    main.addEventListener('click', function () {
      select(selected === r.dbn ? null : r.dbn, 'list');
    });
    host.appendChild(main);
    markComparing(host);
    return host;
  }

  function markComparing(host) {
    host.classList.toggle('is-comparing',
      SF.store.get('compare', []).indexOf(host.dataset.dbn) !== -1);
  }

  // The profile link, the comparison button and, on a phone, a way to the map.
  function actions(r, withMap) {
    var box = SF.el('div', { class: 'row-actions' });
    box.appendChild(SF.el('a', { class: 'pill pill-go',
      href: 'school.html?dbn=' + encodeURIComponent(r.dbn), text: 'View profile →' }));
    box.appendChild(compareButton(r.dbn));
    if (withMap && r.lat != null) {
      var show = SF.el('button', { type: 'button', class: 'pill', text: 'Show on map' });
      show.addEventListener('click', function () { setView('map'); });
      box.appendChild(show);
    }
    if (r.lat == null) {
      box.appendChild(SF.el('span', { class: 'row-note', text: 'No published location, so not on the map.' }));
    }
    return box;
  }

  function mapView() { return SF.param('view') === 'map'; }

  function panes() {
    if (wide.matches) return { map: true, list: true };
    return { map: mapView(), list: !mapView() };
  }

  function countText(list) {
    if (list.length === 0) return 'No schools match these filters.';
    var total = list.length.toLocaleString('en-US');
    var text = shown < list.length
      ? 'Showing ' + shown.toLocaleString('en-US') + ' of ' + total + ' schools'
      : total + (list.length === 1 ? ' school' : ' schools');
    var missing = list.filter(function (r) { return r.lat == null; }).length;
    if (missing) text += ' · ' + missing.toLocaleString('en-US') + ' not on the map';
    return text;
  }

  // "54 schools · District 15 · Middle", for the bar over a full-screen map.
  function summary(state, list) {
    var bits = [list.length.toLocaleString('en-US') + (list.length === 1 ? ' school' : ' schools')];
    if (state.boro) bits.push(state.boro);
    if (state.district) bits.push(districtLabel(state.district));
    if (state.type) bits.push(state.type);
    if (state.grade) bits.push(GRADE_NAMES[state.grade] ? GRADE_NAMES[state.grade][0] : state.grade);
    return bits.join(' · ');
  }

  // `animate` is set when a filter changes, so the list fades between
  // results. Paging with "Show more" and switching views do not animate.
  function draw(animate) {
    var state = currentFilters();
    var list = apply(state);
    var p = panes();

    // A selection outside the filtered list is dropped. One inside it past
    // the first page brings in enough rows to show it.
    selected = SF.param('focus') || null;
    var at = selected ? list.map(function (r) { return r.dbn; }).indexOf(selected) : -1;
    if (selected && at === -1) { selected = null; SF.setParam('focus', '', true); }
    if (at >= shown) shown = Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE;
    current = list;

    var float = document.getElementById('float-toggle');
    float.hidden = wide.matches;
    float.textContent = mapView() ? 'Show list' : 'Show map';
    var full = !wide.matches && mapView();
    document.body.classList.toggle('map-full', full);
    // The full-screen map covers the page, so the page behind it leaves the
    // tab order until the map closes.
    document.querySelectorAll('[data-chrome="masthead"], .rail, .skip').forEach(function (el) {
      if (full) el.setAttribute('inert', ''); else el.removeAttribute('inert');
    });

    document.getElementById('list-panel').hidden = !p.list;
    document.getElementById('map-panel').hidden = !p.map;
    document.getElementById('school-count').textContent = countText(list);
    buildChips(document.getElementById('filters'), state, onFilter);

    // A row scrolled into view clears the pinned tools above the list.
    var rail = document.querySelector('.rail');
    rail.style.scrollPaddingTop = document.querySelector('.rail-tools').offsetHeight + 'px';
    document.getElementById('map-bar-summary').textContent = summary(state, list);

    if (p.list) {
      drawList(list, animate);
      paintSelection('jump');
    }
    if (p.map) drawMap(state, list, animate);

    renderTray();

    // The profile's back link returns to exactly this view.
    try { sessionStorage.setItem('sf-results', location.pathname + location.search); } catch (e) {}

    // A jump, not a glide: the map has just closed over this spot.
    // It waits a tick, because closing the map goes back in history and the
    // browser restores the old scroll position after this runs.
    if (scrollAfterDraw) {
      var target = scrollAfterDraw;
      scrollAfterDraw = null;
      setTimeout(function () { target.scrollIntoView({ block: 'start' }); }, 0);
    }
  }

  function drawList(list, animate) {
    var grid = document.getElementById('school-list');
    var more = document.getElementById('show-more');
    var from = animate ? 0 : grid.children.length;
    if (animate || shown <= grid.children.length) {
      grid.innerHTML = '';
      from = 0;
    }
    list.slice(from, shown).forEach(function (r, i) {
      var item = SF.el('li', { class: animate ? 'enter' : '' }, [row(r)]);
      // Only the first dozen stagger, so a long list does not trickle in.
      if (animate) item.style.setProperty('--i', Math.min(i, 12));
      grid.appendChild(item);
    });
    more.hidden = shown >= list.length;
    more.textContent = 'Show ' + Math.min(PAGE_SIZE, list.length - shown) + ' more';
  }

  function onFilter() {
    shown = PAGE_SIZE;
    SF.setParam('focus', '', true);
    draw(true);
  }

  // ---- Comparison tray ------------------------------------------------

  // The basket the profile and comparison pages share. The tray shows what
  // is in it from the moment a school is added.
  var trayOpen = false;
  var trayCount = null;

  function renderTray() {
    var basket = SF.store.get('compare', []);
    var limit = (SF.display && SF.display.max_compare) || 12;
    var tray = document.getElementById('compare-tray');
    var toggle = document.getElementById('tray-toggle');
    var list = document.getElementById('tray-list');

    tray.hidden = basket.length === 0;
    document.body.classList.toggle('has-tray', basket.length > 0);
    if (!basket.length) { trayOpen = false; trayCount = 0; return; }

    toggle.innerHTML = '';
    var count = SF.el('b', { text: String(basket.length) });
    toggle.appendChild(document.createTextNode('Comparing '));
    toggle.appendChild(count);
    toggle.appendChild(document.createTextNode(' of ' + limit + ' '));
    toggle.appendChild(SF.el('span', { class: 'chev', 'aria-hidden': 'true', text: '▲' }));
    toggle.setAttribute('aria-expanded', String(trayOpen));
    // A reflow between the class changes restarts the bump.
    if (trayCount !== null && trayCount !== basket.length) {
      void count.offsetWidth;
      count.classList.add('bump');
    }
    trayCount = basket.length;
    document.getElementById('tray-compare').href = SF.compareHref();

    list.hidden = !trayOpen;
    list.innerHTML = '';
    if (!trayOpen) return;
    var inList = {}, names = {};
    current.forEach(function (r) { inList[r.dbn] = true; });
    basket.forEach(function (dbn) { if (byDbn[dbn]) names[dbn] = byDbn[dbn].name; });
    // A school in the current results is selected in place. One the filters
    // leave out opens its profile instead.
    list.appendChild(SF.basketList(names, function (dbn, label) {
      if (!inList[dbn]) {
        return SF.el('a', { class: 'tray-name', href: 'school.html?dbn=' + encodeURIComponent(dbn),
                            text: label });
      }
      var name = SF.el('button', { type: 'button', class: 'tray-name', text: label });
      name.addEventListener('click', function () { select(dbn, 'list'); });
      return name;
    }));
  }

  // Rows, the open row's button and the tray all follow the basket.
  function onBasket() {
    document.querySelectorAll('#school-list .school-row').forEach(markComparing);
    var open = document.querySelector('.school-row.is-selected .row-actions');
    if (open) open.replaceWith(actions(byDbn[selected], !wide.matches));
    renderTray();
  }

  // ---- Selection ------------------------------------------------------

  // One selected school, shared by the list and the map, and kept in the
  // address as `focus` so a link can carry it.
  function select(dbn, from) {
    selected = dbn || null;
    SF.setParam('focus', selected || '', true);
    try { sessionStorage.setItem('sf-results', location.pathname + location.search); } catch (e) {}

    var at = selected ? current.map(function (r) { return r.dbn; }).indexOf(selected) : -1;
    if (at >= shown) {
      shown = Math.ceil((at + 1) / PAGE_SIZE) * PAGE_SIZE;
      drawList(current, false);
      document.getElementById('school-count').textContent = countText(current);
    }
    paintSelection(from === 'list' ? 'nearest' : 'glide');

    // The marker always follows the selection. The camera moves only for a
    // pick in the list, since a pick on the map is already in view.
    if (mapReady) {
      mapReady.then(function (map) { if (map) showOnMap(map, selected, from === 'list'); });
    }
  }

  // Opens the selected row and closes the rest, then scrolls the rail to it.
  // 'glide' centers it for a pick on the map, 'jump' centers it at once for a
  // link, and 'nearest' only nudges a row the reader just clicked.
  function paintSelection(reveal) {
    document.querySelectorAll('.school-row.is-selected').forEach(function (el) {
      if (el.dataset.dbn === selected) return;
      el.classList.remove('is-selected');
      el.querySelector('.row-main').setAttribute('aria-expanded', 'false');
      var old = el.querySelector('.row-actions');
      if (old) old.remove();
    });
    if (!selected) return;
    var el = document.querySelector('#school-list .school-row[data-dbn="' + selected + '"]');
    if (!el) return;
    if (!el.classList.contains('is-selected')) {
      el.classList.add('is-selected');
      el.querySelector('.row-main').setAttribute('aria-expanded', 'true');
      el.appendChild(actions(byDbn[selected], !wide.matches));
    }
    if (reveal === 'nearest') {
      el.scrollIntoView({ block: 'nearest' });
    } else {
      el.scrollIntoView({ block: 'center',
        behavior: reveal === 'glide' && !SFMap.reduced ? 'smooth' : 'auto' });
    }
  }

  // ---- Map ----------------------------------------------------------

  function geojson(list) {
    return {
      type: 'FeatureCollection',
      features: list.filter(function (r) { return r.lat != null; }).map(function (r) {
        return { type: 'Feature', properties: { dbn: r.dbn },
                 geometry: { type: 'Point', coordinates: [r.lon, r.lat] } };
      })
    };
  }

  // Hover previews a school in both panes: its row lights up and a ring
  // marks its point. The selected school keeps its own marker.
  function setHover(map, dbn) {
    if (hovered === dbn) return;
    hovered = dbn;
    var r = dbn && dbn !== selected && byDbn[dbn];
    SFMap.focus(map, r && r.lat != null ? [r.lon, r.lat] : null, 'hover');
    document.querySelectorAll('.school-row.is-hover').forEach(function (c) {
      c.classList.remove('is-hover');
    });
    if (dbn) {
      var match = document.querySelector('#school-list .school-row[data-dbn="' + dbn + '"]');
      if (match) match.classList.add('is-hover');
    }
  }

  // Marks the selected school, and moves the camera when asked. A school
  // already in view is left where it is; one off screen or too small to
  // pick out is brought to the middle.
  function showOnMap(map, dbn, move) {
    var r = dbn && byDbn[dbn];
    var at = r && r.lat != null ? [r.lon, r.lat] : null;
    SFMap.focus(map, at, 'select');
    SFMap.focus(map, null, 'hover');
    hovered = null;
    if (!at || !move) return;
    var inView = map.getBounds().contains(at);
    if (map.getZoom() < 12.5) {
      map.flyTo({ center: at, zoom: 14, duration: SFMap.reduced ? 0 : 700, essential: false });
    } else if (!inView) {
      map.easeTo({ center: at, duration: SFMap.reduced ? 0 : 450 });
    }
  }

  // The same basket the profile page fills, so a shortlist can start here.
  function compareButton(dbn) {
    var limit = (SF.display && SF.display.max_compare) || 12;
    var button = SF.el('button', { class: 'pill pill-check', type: 'button' });
    function paint() {
      var inBasket = SF.store.get('compare', []).indexOf(dbn) !== -1;
      button.setAttribute('aria-pressed', String(inBasket));
      button.textContent = inBasket ? '✓ In comparison' : 'Add to comparison';
    }
    button.addEventListener('click', function () {
      var current = SF.store.get('compare', []);
      var at = current.indexOf(dbn);
      if (at > -1) current.splice(at, 1);
      else if (current.length < limit) current.push(dbn);
      else { button.textContent = 'Comparison is full'; return; }
      SF.store.set('compare', current);
      paint();
    });
    paint();
    return button;
  }

  // Schools that share a building sit on one point. On a wide screen the
  // popup names them and picking one selects it in the list. On a phone the
  // list is out of sight, so the popup carries each school's actions.
  function popupBody(hits) {
    if (wide.matches) {
      var box = SF.el('div', { class: 'map-popup' }, [
        SF.el('p', { class: 'map-popup-head', text: hits.length + ' schools share this location' })
      ]);
      hits.forEach(function (r) {
        var pick = SF.el('button', { type: 'button', class: 'map-pick', text: r.name || r.dbn });
        pick.addEventListener('click', function () { popup.remove(); select(r.dbn, 'map'); });
        box.appendChild(pick);
      });
      return box;
    }
    return SF.el('div', { class: 'map-popup' }, hits.map(function (r) {
      return SF.el('div', { class: 'map-popup-item' }, [
        SF.el('p', { class: 'map-popup-name', text: r.name || r.dbn }),
        SF.el('p', { class: 'map-popup-meta',
          text: [r.dbn, districtLabel(r.district), r.grades, r.type].filter(Boolean).join(' · ') }),
        actions(r, false)
      ]);
    }));
  }

  function ensureMap(state) {
    if (mapReady) return mapReady;
    var frame = document.getElementById('school-map');

    // The wide map is pinned to the screen height, so it takes the wheel.
    mapReady = SFMap.create(frame, { scrollZoom: wide.matches },
                            { note: 'Lines are districts, not zones' }).then(function (map) {
      if (!map) return null;
      return SFMap.addDistricts(map, state.district).then(function () {
        SFMap.addSchools(map, geojson([]));

        popup = new maplibregl.Popup({ closeButton: true, maxWidth: '20rem', offset: 12 });
        map.on('click', function (ev) {
          var features = map.queryRenderedFeatures(ev.point, { layers: ['schools'] });
          if (!features.length) {
            if (wide.matches && selected) select(null, 'map');
            return;
          }
          var hits = features.map(function (f) { return byDbn[f.properties.dbn]; })
            .filter(Boolean);
          if (wide.matches && hits.length === 1) {
            popup.remove();
            select(hits[0].dbn, 'map');
            return;
          }
          popup.setLngLat(features[0].geometry.coordinates)
            .setDOMContent(popupBody(hits)).addTo(map);
        });
        map.on('mousemove', 'schools', function (ev) {
          map.getCanvas().style.cursor = 'pointer';
          setHover(map, ev.features[0].properties.dbn);
        });
        map.on('mouseleave', 'schools', function () {
          map.getCanvas().style.cursor = '';
          setHover(map, null);
        });

        var list = document.getElementById('school-list');
        list.addEventListener('mouseover', function (ev) {
          var c = ev.target.closest('.school-row');
          setHover(map, c ? c.dataset.dbn : null);
        });
        list.addEventListener('mouseleave', function () { setHover(map, null); });
        return map;
      });
    });
    return mapReady;
  }

  function drawMap(state, list, animate) {
    var placed = list.filter(function (r) { return r.lat != null; });

    ensureMap(state).then(function (map) {
      if (!map) return;
      var data = geojson(list);
      if (animate) SFMap.setSchools(map, data);
      else map.getSource('schools').setData(data);
      SFMap.chooseDistrict(map, state.district);
      if (popup) popup.remove();
      setHover(map, null);

      var target = selected && placed.filter(function (r) { return r.dbn === selected; })[0];
      showOnMap(map, selected, false);
      if (target) {
        map.jumpTo({ center: [target.lon, target.lat], zoom: Math.max(map.getZoom(), 14) });
      } else if (placed.length) {
        var bounds = new maplibregl.LngLatBounds();
        placed.forEach(function (r) { bounds.extend([r.lon, r.lat]); });
        SFMap.frame(map, bounds, animate ? {} : { duration: 0 });
      }
    });
  }

  // On a narrow screen, opening the map adds a history entry, so the
  // phone's back gesture closes the map instead of leaving the page.
  function setView(view) {
    if (view === 'map') {
      var u = new URL(window.location);
      u.searchParams.set('view', 'map');
      history.pushState({ map: true }, '', u);
    } else if (history.state && history.state.map) {
      history.back();
      return;
    } else {
      SF.setParam('view', '', true);
    }
    var toTop = !scrollAfterDraw;
    draw();
    if (toTop) window.scrollTo(0, 0);
  }

  document.addEventListener('DOMContentLoaded', function () {
    SFSearch.mount('#browse-search', {});

    var listHost = document.getElementById('school-list');
    SFSearch.data().then(function (data) {
      rows = data;
      rows.forEach(function (r) { byDbn[r.dbn] = r; });
      mapDistricts();

      document.getElementById('clear-filters').addEventListener('click', function () {
        FILTERS.forEach(function (f) { SF.setParam(f.key, '', true); });
        onFilter();
      });
      document.getElementById('tray-toggle').addEventListener('click', function () {
        trayOpen = !trayOpen;
        renderTray();
      });
      document.addEventListener('sf-store', function (ev) {
        if (ev.detail.key === 'compare') onBasket();
      });
            document.addEventListener('keydown', menuKeys);
      document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape' || openMenu) return;
        if (trayOpen) { trayOpen = false; renderTray(); document.getElementById('tray-toggle').focus(); }
        else if (selected && wide.matches) select(null, 'key');
      });
      document.addEventListener('mousedown', function (ev) {
        if (openMenu && !openMenu.chip.contains(ev.target)) closeMenu(false);
      });

      document.getElementById('float-toggle').addEventListener('click', function () {
        setView(mapView() ? 'list' : 'map');
      });
      document.getElementById('map-filters').addEventListener('click', function () {
        scrollAfterDraw = document.getElementById('filters');
        setView('list');
      });
      window.addEventListener('popstate', function () { draw(); });
      if (wide.addEventListener) wide.addEventListener('change', function () { draw(); });

      document.getElementById('show-more').addEventListener('click', function () {
        shown += PAGE_SIZE;
        draw();
      });

      draw();
    }).catch(function (err) { SF.fail(listHost, err); });
  });
})();
