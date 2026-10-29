/* The landing page.
   ------------------------------------------------------------------
   A search box and a way in, and nothing else. There are deliberately no
   citywide statistics here: a figure about all of New York answers a question
   nobody arrives with, and it would be the one number on the site with no
   school attached to it.

   The borough links carry a school count, which is a fact about the directory
   rather than a statistic about education.

   The search box finds a school or an address (finder.js). A school opens
   its profile. An address opens Browse on its zone, with the pin waiting
   there. */

(function () {
  'use strict';

  var BOROUGHS = ['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'];

  function render(rows) {
    var host = document.getElementById('boroughs');
    host.innerHTML = '';

    var counts = {};
    rows.forEach(function (r) {
      if (r.status !== 'open' || !r.boro) return;
      counts[r.boro] = (counts[r.boro] || 0) + 1;
    });

    BOROUGHS.forEach(function (boro) {
      if (!counts[boro]) return;
      var item = SF.el('li');
      var link = SF.el('a', {
        class: 'entry',
        href: 'browse.html?boro=' + encodeURIComponent(boro)
      });
      link.appendChild(SF.el('span', { class: 'e-name', text: boro }));
      link.appendChild(SF.el('span', {
        class: 'e-count',
        text: counts[boro].toLocaleString('en-US') + ' schools'
      }));
      item.appendChild(link);
      host.appendChild(item);
    });

    var all = SF.el('li');
    var allLink = SF.el('a', { class: 'entry', href: 'browse.html' });
    allLink.appendChild(SF.el('span', { class: 'e-name', text: 'All filters' }));
    allLink.appendChild(SF.el('span', {
      class: 'e-count', text: 'district, type and grade'
    }));
    all.appendChild(allLink);
    host.appendChild(all);
  }

  function openAddress(a) {
    SFZones.answer(a.lon, a.lat).then(function (result) {
      var key = SFZones.keyString(result.keys);
      SFFinder.pin.set(key, a, 'address');
      location.href = 'browse.html?district=' + encodeURIComponent(result.district || '') +
        '&zone=' + key;
    }).catch(function (err) { SF.fail(document.getElementById('finder-search'), err); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Beside the School/Address switch, a phone has room for short words only.
    var narrow = window.matchMedia('(max-width: 40rem)').matches;
    SFFinder.mount('#finder-search', {
      autofocus: true,
      schoolPlaceholder: narrow ? 'Name or DBN' : null,
      addressPlaceholder: narrow ? 'House number and street' : 'House number and street, such as 619 72 St',
      onSchool: function (r) { location.href = 'school.html?dbn=' + encodeURIComponent(r.dbn); },
      onAddress: openAddress
    });
    SFSearch.data()
      .then(render)
      .catch(function (err) { SF.fail(document.getElementById('boroughs'), err); });
  });
})();
