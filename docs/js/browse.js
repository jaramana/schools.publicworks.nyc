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
    // A typed link may say district=2; the data says "02".
    if (/^\d$/.test(state.district)) state.district = '0' + state.district;
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
      href: 'school.html?dbn=' + encodeURIComponent(row.dbn),
      'data-dbn': row.dbn
    });
    link.appendChild(SF.el('span', { class: 'name', text: row.name || row.dbn }));
    var where = [row.boro, districtLabel(row.district)].filter(Boolean).join(' · ');
    link.appendChild(SF.el('span', { class: 'where', text: where }));
    var ident = [row.dbn, row.grades, row.type].filter(Boolean).join(' · ');
    if (row.status === 'former') ident += ' · closed';
    link.appendChild(SF.el('span', { class: 'ident', text: ident }));
    return link;
  }

  function mapView() { return SF.param('view') === 'map'; }

  function panes() {
    if (wide.matches) return { map: true, list: true };
    return { map: mapView(), list: !mapView() };
  }

  function countText(list) {
    if (list.length === 0) return 'No schools match these filters.';
    var total = list.length.toLocaleString('en-US');
    if (shown < list.length) {
      return 'Showing ' + shown.toLocaleString('en-US') + ' of ' + total +
             ' schools, in alphabetical order.';
    }
    return total + (list.length === 1 ? ' school.' : ' schools, in alphabetical order.');
  }

  // "54 schools · District 15 · Middle", for the bar over a full-screen map.
  function summary(state, list) {
    var bits = [list.length.toLocaleString('en-US') + (list.length === 1 ? ' school' : ' schools')];
    if (state.boro) bits.push(state.boro);
    if (state.district) bits.push(districtLabel(state.district));
    if (state.type) bits.push(state.type);
    if (state.grade) bits.push(state.grade);
    return bits.join(' · ');
  }

  // `animate` is set when a filter changes, so the list fades between
  // results. Paging with "Show more" and switching views do not animate.
  function draw(animate) {
    var state = currentFilters();
    var list = apply(state);
    var p = panes();

    var float = document.getElementById('float-toggle');
    float.hidden = wide.matches;
    float.textContent = mapView() ? 'Show list' : 'Show map';
    document.body.classList.toggle('map-full', !wide.matches && mapView());

    document.getElementById('list-panel').hidden = !p.list;
    document.getElementById('map-panel').hidden = !p.map;
    document.getElementById('school-count').textContent = countText(list);
    document.getElementById('map-bar-summary').textContent = summary(state, list);

    if (p.list) drawList(list, animate);
    if (p.map) drawMap(state, list, animate);

    // The profile's back link returns to exactly this view.
    try { sessionStorage.setItem('sf-results', location.pathname + location.search); } catch (e) {}

    // A jump, not a glide: the map has just closed over this spot.
    if (scrollAfterDraw) {
      scrollAfterDraw.scrollIntoView({ block: 'start' });
      scrollAfterDraw = null;
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
    list.slice(from, shown).forEach(function (row, i) {
      var item = SF.el('li', { class: animate ? 'enter' : '' }, [card(row)]);
      // Only the first dozen stagger, so a long list does not trickle in.
      if (animate) item.style.setProperty('--i', Math.min(i, 12));
      grid.appendChild(item);
    });
    more.hidden = shown >= list.length;
    more.textContent = 'Show ' + Math.min(PAGE_SIZE, list.length - shown) + ' more';
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

  // One school in focus at a time: its card lights up in the list and its
  // point grows on the map.
  function setHover(map, dbn) {
    if (hovered === dbn) return;
    hovered = dbn;
    var row = dbn && byDbn[dbn];
    SFMap.focus(map, row && row.lat != null ? [row.lon, row.lat] : null);
    document.querySelectorAll('.school-card.is-hover').forEach(function (c) {
      c.classList.remove('is-hover');
    });
    if (dbn) {
      var match = document.querySelector('#school-list .school-card[data-dbn="' + dbn + '"]');
      if (match) match.classList.add('is-hover');
    }
  }

  // The same basket the profile page fills, so a shortlist can start here.
  function compareButton(dbn) {
    var limit = (SF.display && SF.display.max_compare) || 12;
    var button = SF.el('button', { class: 'pill', type: 'button' });
    function paint() {
      var inBasket = SF.store.get('compare', []).indexOf(dbn) !== -1;
      button.setAttribute('aria-pressed', String(inBasket));
      button.textContent = inBasket ? 'In your comparison' : 'Add to comparison';
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

  function popupBody(hits) {
    return SF.el('div', { class: 'map-popup' }, hits.map(function (row) {
      return SF.el('div', { class: 'map-popup-item' }, [card(row), compareButton(row.dbn)]);
    }));
  }

  function ensureMap(state) {
    if (mapReady) return mapReady;
    var frame = document.getElementById('school-map');

    // The wide map is pinned to the screen height, so it takes the wheel.
    mapReady = SFMap.create(frame, { scrollZoom: wide.matches }).then(function (map) {
      if (!map) return null;
      return SFMap.addDistricts(map, state.district).then(function () {
        SFMap.addSchools(map, geojson([]));

        popup = new maplibregl.Popup({ closeButton: true, maxWidth: '20rem', offset: 12 });
        map.on('click', 'schools', function (ev) {
          // Schools that share a building sit on one point, so every school
          // under the click is listed.
          var hits = ev.features.map(function (f) { return byDbn[f.properties.dbn]; })
            .filter(Boolean);
          popup.setLngLat(ev.features[0].geometry.coordinates)
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
          var c = ev.target.closest('.school-card');
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
    var missing = list.length - placed.length;
    var note = document.getElementById('map-note');
    note.hidden = missing === 0;
    note.textContent = missing.toLocaleString('en-US') + ' of ' +
      list.length.toLocaleString('en-US') + ' schools ' +
      (missing === 1 ? 'has' : 'have') + ' no published location and ' +
      (missing === 1 ? 'appears' : 'appear') + ' only in the list.';

    ensureMap(state).then(function (map) {
      if (!map) return;
      var data = geojson(list);
      if (animate) SFMap.setSchools(map, data);
      else map.getSource('schools').setData(data);
      SFMap.chooseDistrict(map, state.district);
      if (popup) popup.remove();
      hovered = null;

      var focus = SF.param('focus');
      var target = focus && placed.filter(function (r) { return r.dbn === focus; })[0];
      if (target) {
        map.jumpTo({ center: [target.lon, target.lat], zoom: 14.5 });
        setHover(map, target.dbn);
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
      var controls = document.getElementById('filters');
      buildControls(controls, currentFilters(), function () {
        shown = PAGE_SIZE;
        SF.setParam('focus', '', true);
        draw(true);
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
