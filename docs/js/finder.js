/* Schools Finder / the search box that finds a school or an address
   ------------------------------------------------------------------
   SFFinder.mount(host, { onSchool, onAddress, onClear, autofocus,
                          schoolPlaceholder, addressPlaceholder })
   SFFinder.pin    get(zone), set(zone, point, kind), clear()

   A School/Address switch at the box's left edge swaps the box. The school
   box is the site's school search (search.js). The address box asks
   GeoSearch, through zones.js, once the text starts with a house number.

   An address goes only to GeoSearch. The point it returns is kept in this
   tab's session storage, so the pin can follow the reader from the home
   page to Browse, with the address as the reader picked it so the box can
   show it again. Neither enters the address bar or leaves the browser, and
   both are gone when the tab closes. */

(function () {
  'use strict';

  var PIN_KEY = 'sf-zone-pin';

  // The pin belongs to one zone. A different zone in the address bar, such
  // as a shared link, shows no pin.
  var pin = {
    get: function (zone) {
      try {
        var p = JSON.parse(sessionStorage.getItem(PIN_KEY) || 'null');
        return p && p.zone === zone ? p : null;
      } catch (e) { return null; }
    },
    set: function (zone, point, kind) {
      try {
        sessionStorage.setItem(PIN_KEY, JSON.stringify({
          zone: zone, lon: point.lon, lat: point.lat, kind: kind,
          label: point.street ? point.street + ', ' + point.borough : null
        }));
      } catch (e) { /* no storage: the pin shows on this page only */ }
    },
    clear: function () {
      try { sessionStorage.removeItem(PIN_KEY); } catch (e) {}
    }
  };

  // ---- The address box ----------------------------------------------

  // The same combobox the school search uses, answered by GeoSearch. A pick
  // is required: a typed address that matched nothing exactly would
  // otherwise be swapped for a nearby house number without a word.
  function mountAddress(host, opts) {
    var o = opts || {};
    var id = 'za-' + Math.random().toString(36).slice(2, 8);
    host.classList.add('search-shell', 'address-box');
    host.innerHTML =
      '<div class="search-row">' +
        '<label class="sr-only" for="' + id + '-input">Address</label>' +
        '<input id="' + id + '-input" type="search" autocomplete="street-address" ' +
               'spellcheck="false" role="combobox" aria-expanded="false" ' +
               'aria-autocomplete="list" aria-controls="' + id + '" ' +
               'placeholder="' + SF.escapeHtml(o.placeholder || 'House number and street') + '">' +
      '</div>' +
      '<ul class="results" role="listbox" id="' + id + '" aria-label="Addresses"></ul>' +
      '<p class="address-status" role="status" aria-live="polite"></p>';

    var input = host.querySelector('input');
    var list = host.querySelector('.results');
    var status = host.querySelector('.address-status');
    var active = -1, timer = null, items = [];

    function say(text) { status.textContent = text || ''; }

    function draw(found) {
      items = found;
      list.innerHTML = '';
      active = -1;
      input.setAttribute('aria-expanded', found.length ? 'true' : 'false');
      input.removeAttribute('aria-activedescendant');
      found.forEach(function (a, i) {
        var li = SF.el('li', { role: 'option', 'aria-selected': 'false', id: id + '-opt-' + i });
        var button = SF.el('button', { type: 'button' }, [
          SF.el('span', { class: 'r-name', text: a.street }),
          SF.el('span', { class: 'meta', text: a.place })
        ]);
        button.addEventListener('click', function () { pick(a); });
        li.appendChild(button);
        list.appendChild(li);
      });
    }

    // The text of the address last picked. Emptying the box after a pick
    // calls `onClear`; typing over it does not.
    var picked = '';

    function pick(a) {
      picked = input.value = a.street + ', ' + a.borough;
      draw([]);
      say('');
      if (o.onPick) o.onPick(a);
    }

    function run() {
      var text = input.value;
      if (!SFZones.looksLikeAddress(text)) {
        draw([]);
        say(text.trim() && !/^\d/.test(text.trim()) ? 'Start with the house number.' : '');
        return;
      }
      SFZones.suggest(text).then(function (found) {
        if (found === null) return;
        draw(found.slice(0, 8));
        say(found.length ? found.length + ' addresses found' : 'No address matches. Check the house number and street.');
      }).catch(function () {
        draw([]);
        say('The City’s address service is not answering. Try again in a moment.');
      });
    }

    function move(step) {
      var lis = list.querySelectorAll('li');
      if (!lis.length) return;
      if (active >= 0) { lis[active].classList.remove('active'); lis[active].setAttribute('aria-selected', 'false'); }
      active = (active + step + lis.length) % lis.length;
      lis[active].classList.add('active');
      lis[active].setAttribute('aria-selected', 'true');
      input.setAttribute('aria-activedescendant', lis[active].id);
    }

    // Addresses wait for a short pause in typing, so GeoSearch is asked about
    // the address rather than every keystroke of it.
    input.addEventListener('input', function () {
      clearTimeout(timer);
      if (picked && !input.value.trim()) {
        picked = '';
        draw([]);
        say('');
        if (o.onClear) o.onClear();
        return;
      }
      timer = setTimeout(run, 220);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0 && items[active]) pick(items[active]);
        else if (items.length === 1) pick(items[0]);
        else if (items.length) say('Choose an address from the list.');
      } else if (e.key === 'Escape') { draw([]); }
    });
    document.addEventListener('click', function (e) { if (!host.contains(e.target)) draw([]); });
    return {
      focus: function () { input.focus(); },
      clear: function () { picked = input.value = ''; draw([]); say(''); },
      show: function (text) { picked = input.value = text; }
    };
  }

  // ---- The switch ---------------------------------------------------

  function mount(host, opts) {
    host = typeof host === 'string' ? document.querySelector(host) : host;
    var o = opts || {};

    host.classList.add('search-mode');
    var modes = SF.el('div', { class: 'mode-switch', role: 'radiogroup', 'aria-label': 'Search for' });
    var school = SF.el('div', { class: 'mode-box' });
    var address = SF.el('div', { class: 'mode-box', hidden: '' });
    host.appendChild(modes);
    host.appendChild(school);
    host.appendChild(address);
    var boxes = {
      school: SFSearch.mount(school, { placeholder: o.schoolPlaceholder, onPick: o.onSchool,
                                       autofocus: o.autofocus }),
      address: mountAddress(address, {
        onPick: o.onAddress, onClear: o.onClear, placeholder: o.addressPlaceholder
      })
    };

    var buttons = {};
    function choose(which, focus) {
      Object.keys(buttons).forEach(function (m) {
        buttons[m].setAttribute('aria-checked', String(m === which));
        buttons[m].tabIndex = m === which ? 0 : -1;
      });
      school.hidden = which !== 'school';
      address.hidden = which !== 'address';
      if (focus) boxes[which].focus();
    }
    [['school', 'School'], ['address', 'Address']].forEach(function (m) {
      var b = buttons[m[0]] = SF.el('button', { type: 'button', role: 'radio', text: m[1] });
      b.addEventListener('click', function () { choose(m[0], true); });
      b.addEventListener('keydown', function (ev) {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        var next = m[0] === 'school' ? 'address' : 'school';
        choose(next, false);
        buttons[next].focus();
      });
      modes.appendChild(b);
    });
    choose('school', false);

    return {
      clearAddress: boxes.address.clear,
      // Puts a picked address back in its box, as when a reader arrives with
      // one from the home page.
      showAddress: function (text) { choose('address', false); boxes.address.show(text); }
    };
  }

  window.SFFinder = { mount: mount, pin: pin };
})();
