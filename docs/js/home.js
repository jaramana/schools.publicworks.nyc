/* The landing page.
   ------------------------------------------------------------------
   A search box and a way in, and nothing else. There are deliberately no
   citywide statistics here: a figure about all of New York answers a question
   nobody arrives with, and it would be the one number on the site with no
   school attached to it.

   The borough links carry a school count, which is a fact about the directory
   rather than a statistic about education. */

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

  document.addEventListener('DOMContentLoaded', function () {
    SFSearch.mount('#finder-search', { autofocus: true });
    SFSearch.data()
      .then(render)
      .catch(function (err) { SF.fail(document.getElementById('boroughs'), err); });
  });
})();
