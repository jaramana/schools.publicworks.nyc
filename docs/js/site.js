/* Schools Finder (schools.publicworks.nyc) / shared behavior
   ------------------------------------------------------------------
   Formatting, data loading, page chrome and URL parameters. Every page
   loads this first. No dependencies, no build step.

   One rule runs through the formatting: an absent value is never drawn as
   a number. Missing, withheld and not applicable each say what they are. */

(function () {
  'use strict';

  // ---- Formatting -------------------------------------------------

  function isBlank(v) {
    return v === null || v === undefined || v === '' ||
           (typeof v === 'number' && isNaN(v));
  }

  var fmt = {
    // Proportions arrive as 0 to 1 and are shown as percentages. They are
    // never multiplied twice: an index already out of 100 uses index100.
    pct: function (v, places) {
      if (isBlank(v)) return null;
      return (v * 100).toFixed(places === undefined ? 1 : places) + '%';
    },
    index100: function (v) { return isBlank(v) ? null : Number(v).toFixed(1); },
    scale: function (v) { return isBlank(v) ? null : Number(v).toFixed(2); },
    percentile: function (v) { return isBlank(v) ? null : Math.round(v) + 'th'; },
    number: function (v) {
      if (isBlank(v)) return null;
      var n = Number(v);
      return (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10)
        .toLocaleString('en-US');
    },
    count: function (v) {
      return isBlank(v) ? null : Math.round(Number(v)).toLocaleString('en-US');
    },
    // Impact and Performance, and the City's 1.00 to 4.99 rating scores.
    twoPlaces: function (v) { return isBlank(v) ? null : Number(v).toFixed(2); },
    years: function (v) {
      if (isBlank(v)) return null;
      var n = Math.round(Number(v));
      return n + (n === 1 ? ' year' : ' years');
    },
    miles: function (v) { return isBlank(v) ? null : Number(v).toFixed(1) + ' mi'; },
    // A school year is stored as "2024-25" and shown that way. Spelling it
    // out as a single year is how a reporting period gets misread.
    year: function (v) { return isBlank(v) ? null : String(v); }
  };

  // metrics.json says format:"pct_unit" and the browser resolves it here, so
  // adding a metric in the pipeline needs no change in this file.
  var FORMATTERS = {
    pct_unit: fmt.pct,
    scale: fmt.scale,
    percentile: fmt.percentile,
    index_100: fmt.index100,
    number: fmt.number,
    count: fmt.count,
    index_unit: fmt.twoPlaces,
    rating_score: fmt.twoPlaces,
    years: fmt.years,
    miles: fmt.miles
  };

  function formatValue(value, format) {
    var f = FORMATTERS[format] || fmt.number;
    var out = f(value);
    return out === null ? null : out;
  }

  // Display constants come from the build rather than being written in here,
  // so changing a scale maximum in the pipeline reaches the page.
  var display = {
    scale_max: 4.5, index_max: 100,
    score_bands: [], themes: {}, demographic_themes: {},
    category_order: [], theme_order: [], max_compare: 12,
    glance: [], rating_max: 4.99
  };

  function loadDisplay() {
    return load('status.json').then(function (status) {
      if (status && status.display) {
        Object.keys(status.display).forEach(function (k) {
          display[k] = status.display[k];
        });
      }
      return display;
    });
  }

  // What a value is out of. Shown beside the number so a reader never has to
  // open a definition to learn that 3.35 is on a scale ending at 4.5.
  function scaleOf(format) {
    if (format === 'scale') return '/ ' + display.scale_max;
    if (format === 'index_100') return '/ ' + display.index_max;
    if (format === 'rating_score') return '/ ' + display.rating_max;
    return null;
  }

  // A slash scans faster than the word, but a screen reader says "slash", so
  // the spoken version is spelled out on the figure instead.
  function scaleSpoken(value, format) {
    if (format === 'scale') return value + ' out of ' + display.scale_max;
    if (format === 'index_100') return value + ' out of ' + display.index_max;
    if (format === 'rating_score') return value + ' on a scale from 1 to ' + display.rating_max;
    return null;
  }

  // How the City's own 1 to 5 score is described in words. The label matters
  // more than the color: color alone is not an accessible signal, and a band
  // without an explanation is just a verdict.
  var BAND_LABEL = {
    high: 'Among the strongest of its comparison group',
    above: 'Above the middle of its comparison group',
    below: 'Below the middle of its comparison group',
    low: 'Among the weakest of its comparison group'
  };
  var BAND_SHORT = {
    high: 'Strongest', above: 'Above middle',
    below: 'Below middle', low: 'Weakest'
  };

  function bandElement(band, score, options) {
    if (!band) return null;
    var o = options || {};
    var node = el('span', {
      class: 'band band-' + band,
      title: BAND_LABEL[band] + '. New York City scores this measure from 1 to 5 ' +
             'against a group of schools it considers similar.'
    });
    if (!o.scoreOnly) {
      node.appendChild(el('span', { text: BAND_SHORT[band] }));
    }
    if (score !== null && score !== undefined) {
      node.appendChild(el('span', { class: 'score', text: Number(score).toFixed(1) + '/5' }));
    }
    return node;
  }

  // How each kind of absence is written. These strings appear on screen, so
  // they say what happened rather than showing a dash and leaving the reader
  // to guess.
  var ABSENCE = {
    missing: 'Not reported',
    suppressed: 'Withheld',
    censored: 'Above or below a bound',   // replaced by the source's own text
    not_applicable: 'Does not apply',
    unknown: 'Not reported'
  };

  var ABSENCE_DETAIL = {
    missing: 'The source published no value for this school and year.',
    suppressed: 'The source withheld this value because too few students are in the group. It is not a zero.',
    censored: 'The source published a bound rather than an exact figure, to avoid identifying students at the extremes.',
    not_applicable: 'This measure is not published for this type of school.'
  };

  // ---- Data -------------------------------------------------------

  var cache = {};

  function load(path) {
    if (cache[path]) return cache[path];
    // Relative, so the site works at a subpath as readily as at a bare domain.
    cache[path] = fetch('data/' + path).then(function (r) {
      if (!r.ok) throw new Error('Could not load ' + path + ' (HTTP ' + r.status + ')');
      return r.json();
    });
    return cache[path];
  }

  function fail(el, err) {
    if (!el) return;
    var message = (err && err.message) ? err.message : String(err);
    el.innerHTML = '<div class="note-box caution" role="alert"><p><strong>' +
      'Could not load the data.</strong> ' + escapeHtml(message) +
      ' Try reloading. If it keeps happening, the build may be mid-publish.</p></div>';
    if (window.console) console.error(err);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ---- URL parameters ---------------------------------------------

  function param(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function setParam(name, value, replace) {
    var u = new URL(window.location);
    if (value === null || value === undefined || value === '') u.searchParams.delete(name);
    else u.searchParams.set(name, value);
    history[replace ? 'replaceState' : 'pushState']({}, '', u);
  }

  // Small, explicit local storage. Only the compare basket is remembered, and
  // it is cleared by the user emptying it.
  var store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('sf-' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('sf-' + key, JSON.stringify(value)); } catch (e) {}
      announce(key);
    }
  };

  // Anything showing the basket listens for `sf-store`. A change made in
  // another tab arrives as a `storage` event and is passed on the same way.
  function announce(key) {
    document.dispatchEvent(new CustomEvent('sf-store', { detail: { key: key } }));
  }
  window.addEventListener('storage', function (ev) {
    if (ev.key && ev.key.indexOf('sf-') === 0) announce(ev.key.slice(3));
  });

  // ---- Comparison basket --------------------------------------------

  // The schools in the comparison, drawn the same way on Browse and on a
  // profile: a name, a remove button, and a way to empty the list.
  // `names` maps a DBN to a school name. `nameFor(dbn, label)` returns the
  // element that shows one name, so each page decides what a name does.
  function basketList(names, nameFor) {
    var ul = el('ul');
    store.get('compare', []).forEach(function (dbn) {
      var label = names[dbn] || dbn;
      var remove = el('button', { type: 'button', class: 'tray-remove',
        'aria-label': 'Remove ' + label + ' from the comparison', text: '×' });
      remove.addEventListener('click', function () {
        store.set('compare', store.get('compare', []).filter(function (d) { return d !== dbn; }));
      });
      ul.appendChild(el('li', { class: 'tray-item' }, [nameFor(dbn, label), remove]));
    });
    var clear = el('button', { type: 'button', class: 'text-button', text: 'Clear comparison' });
    clear.addEventListener('click', function () { store.set('compare', []); });
    return el('div', {}, [ul, el('div', { class: 'tray-foot' }, [clear])]);
  }

  function compareHref() {
    return 'compare.html?schools=' + store.get('compare', []).join(',');
  }

  // ---- Chrome -----------------------------------------------------

  var PAGES = [
    { href: 'index.html',   nav: 'Find a school' },
    { href: 'browse.html',  nav: 'Browse' },
    { href: 'compare.html', nav: 'Compare' },
    { href: 'data.html',    nav: 'Data' },
    { href: 'about.html',   nav: 'About' }
  ];

  function buildChrome() {
    var here = location.pathname.split('/').pop() || 'index.html';
    if (here === 'school.html') here = 'index.html';   // a profile belongs to the finder

    var head = document.querySelector('[data-chrome="masthead"]');
    if (head) {
      var links = PAGES.map(function (p) {
        return '<a href="' + p.href + '"' +
          (p.href === here ? ' aria-current="page"' : '') + '>' + p.nav + '</a>';
      }).join('');
      head.className = 'masthead';
      head.innerHTML =
        '<div class="wrap masthead-inner">' +
          '<a class="wordmark" href="index.html">Schools Finder</a>' +
          '<nav class="nav" aria-label="Sections">' + links + '</nav>' +
        '</div>';
    }

    // The disclaimer, word for word as it appears in the home page banner.
    // One sentence, in one place in the source of each project, so the two
    // can never drift apart. Only the agency changes between projects.
    var colophon =
      '<p class="colophon"><strong>This is not an official product.</strong> ' +
        'It is an independent initiative, not affiliated with, endorsed by, ' +
        'or produced by <a href="https://www.schools.nyc.gov/">New York City ' +
        'Public Schools</a> or the City of New York. Please refer to them ' +
        'for authoritative information.</p>';
    // The portfolio mark, below everything and outside the columns. It is
    // a filing cabinet, not a section of this site, so it is announced
    // once at the foot rather than filed among the site's own pages.
    var portfolio =
      '<p class="portfolio">A <a href="https://publicworks.nyc/">publicworks.nyc</a> project.</p>';

    var foot = document.querySelector('[data-chrome="footer"]');
    // Browse keeps its footer at the end of the list rail, where the four
    // link columns do not fit. The masthead covers the site's own pages.
    if (foot && foot.hasAttribute('data-compact')) {
      foot.className = 'footer footer-compact';
      foot.innerHTML =
        '<p class="footer-links">' +
          '<a href="data.html">Data</a> · <a href="about.html">About</a> · ' +
          '<a href="https://github.com/jaramana/schools.publicworks.nyc">Source on GitHub</a> · ' +
          '<a href="https://github.com/jaramana/schools.publicworks.nyc/issues">Report an error</a>' +
        '</p>' + colophon + portfolio;
    } else if (foot) {
      foot.className = 'footer';
      foot.innerHTML =
        '<div class="wrap"><div class="footer-grid">' +
          '<div><h2 class="footer-head">Views</h2><ul>' +
            '<li><a href="index.html">Search by name or DBN</a></li>' +
            '<li><a href="browse.html">Browse by borough and district</a></li>' +
            '<li><a href="compare.html">Compare schools</a></li>' +
          '</ul></div>' +
          // Pages, not sections. Four entries that all opened one page at
          // a different anchor read as four destinations and were one.
          '<div><h2 class="footer-head">Reference</h2><ul>' +
            '<li><a href="data.html">Data</a></li>' +
            '<li><a href="about.html">About</a></li>' +
          '</ul></div>' +
          '<div><h2 class="footer-head">Sources</h2><ul>' +
            '<li><a href="https://data.cityofnewyork.us/d/dnpx-dfnc">School Quality Reports</a></li>' +
            '<li><a href="https://infohub.nyced.org/reports/school-quality/information-and-data-overview">Demographic Snapshot</a></li>' +
            '<li><a href="https://infohub.nyced.org/reports/admissions-and-enrollment/directory-data">Directory data</a></li>' +
            '<li><a href="https://www.myschools.nyc/">MySchools</a></li>' +
          '</ul></div>' +
          // Code, not pages. About lives in Reference and was listed twice.
          '<div><h2 class="footer-head">Project</h2><ul>' +
            '<li><a href="https://github.com/jaramana/schools.publicworks.nyc">Source on GitHub</a></li>' +
            '<li><a href="https://github.com/jaramana/schools.publicworks.nyc/issues">Report an error</a></li>' +
          '</ul></div>' +
        '</div>' +
        colophon + portfolio +
        '</div>';
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---- Status line -------------------------------------------------
  // The instrument reports what it is showing: how many schools, from which
  // reporting periods, and whether any source has gone stale.

  function stampStatus() {
    var nodes = document.querySelectorAll('[data-status]');
    if (!nodes.length) return;
    load('status.json').then(function (s) {
      var periods = s.periods || {};
      var text = s.counts.schools.toLocaleString('en-US') + ' schools · ' +
        'quality reports ' + (periods.sqr || 'unknown') + ' · ' +
        'demographics ' + (periods.demographics || 'unknown') + ' · ' +
        'directories ' + (periods.directory_hs || 'unknown') + ' · ' +
        'built ' + s.generated;
      nodes.forEach(function (n) { n.textContent = text; });
      if (s.stale_sources && s.stale_sources.length) showStaleWarning(s);
    }).catch(function () {
      nodes.forEach(function (n) { n.textContent = 'Data status unavailable.'; });
    });
  }

  // Silent staleness is a release failure, so it is shown on the page and not
  // only recorded in a file.
  function showStaleWarning(status) {
    var main = document.querySelector('main .wrap');
    if (!main) return;
    var names = status.stale_sources.map(function (s) {
      return s.source_id + ' (' + s.days + ' days old)';
    }).join(', ');
    var box = el('div', {
      class: 'note-box caution',
      role: 'status',
      html: '<p><strong>Some sources have not been refreshed.</strong> ' +
            escapeHtml(names) + '. The values shown are still the ones last ' +
            'published, but they may no longer be current. ' +
            '<a href="data.html#sources">See source freshness</a>.</p>'
    });
    main.parentNode.insertBefore(box, main.nextSibling);
  }

  document.addEventListener('DOMContentLoaded', function () {
    buildChrome();
    stampStatus();
  });

  window.SF = {
    fmt: fmt, formatValue: formatValue, isBlank: isBlank,
    display: display, loadDisplay: loadDisplay, scaleOf: scaleOf,
    scaleSpoken: scaleSpoken,
    bandElement: bandElement, BAND_LABEL: BAND_LABEL, BAND_SHORT: BAND_SHORT,
    ABSENCE: ABSENCE, ABSENCE_DETAIL: ABSENCE_DETAIL,
    load: load, fail: fail, escapeHtml: escapeHtml,
    param: param, setParam: setParam, store: store, el: el,
    basketList: basketList, compareHref: compareHref
  };
})();
