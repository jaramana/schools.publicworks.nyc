/* A school profile.
   ------------------------------------------------------------------
   Loads one school file, the metric manifest and the peer histograms for the
   school's type, then renders what the sources publish for that school.

   The figures sit in topic tabs, one column of measures each. Every measure
   is a row: its value and year, the City's own comparison in words, and a
   small picture of where the value falls among schools of the same type.
   Opening a row shows that picture in full, the measure's history and its
   facts.

   Four rules decide what appears:
     a value is shown with the year it describes, never on its own;
     a value on a scale is shown with the maximum of that scale beside it;
     an absence says which kind of absence it is;
     a measure that does not apply to this type of school is not listed as
     missing, because it was never expected.

   Scores, ratings and comparisons are the City's. The peer pictures are this
   site's drawing of the City's published values, and carry no score. */

(function () {
  'use strict';

  var REPORT_LABEL = {
    EMS: 'elementary and middle grades',
    HS: 'high school grades',
    HST: 'transfer school report',
    EC: 'early childhood report',
    D75: 'District 75 report',
    YABC: 'Young Adult Borough Center report'
  };

  var state = { payload: null, metrics: null, sources: {}, periods: {}, peers: {} };

  // ---- Small pieces -------------------------------------------------

  // metrics.json used to carry a written description per measure, which was a
  // third of that file for a string the browser can compose. Built here instead.
  var REPORT_COVERS = {
    EMS: 'elementary, middle, and K-8 schools',
    HS: 'high schools',
    HST: 'high school transfer schools',
    EC: 'early childhood schools',
    D75: 'District 75 schools',
    YABC: 'Young Adult Borough Centers'
  };

  function describe(metric) {
    var covers = (metric.applies_to || [])
      .map(function (r) { return REPORT_COVERS[r] || r; }).join(', ');
    return (metric.source_label || metric.label) +
      (covers ? '. Published for ' + covers : '') +
      (metric.first_year ? '. School years ' + metric.first_year +
                           ' to ' + metric.last_year + '.' : '.');
  }

  function districtLabel(code) {
    var special = { '75': 'District 75, special education',
                    '79': 'District 79, alternative programs',
                    '84': 'District 84, charter' };
    var plain = String(parseInt(code, 10));
    return special[plain] || ('District ' + plain);
  }

  // The newest entry the source actually said something about. A published
  // bound counts: a school whose poverty figure is "Above 95%" in 2024-25 must
  // not fall back to a 2021-22 number just because that one was numeric.
  function latestIndex(series) {
    for (var i = series.y.length - 1; i >= 0; i--) {
      if (!SF.isBlank(series.v[i])) return i;
      if (series.bd && series.bd[i]) return i;
    }
    return -1;
  }

  // One reading of a series. With no year given, the newest that carries
  // something. With a year given, that year and no other.
  //
  // Forcing a year matters more than it sounds. Left to itself, every student
  // group in a measure falls back to its own most recent figure, and a card
  // ends up reading "All students 100%, English Language Learners 85.7%" with
  // the years eight apart and set in small grey type. That is not a hard
  // comparison to misread; it is an impossible one, and it looks like a defect
  // in the school rather than in the page.
  function reading(series, year) {
    if (!series) return null;
    var i = year === undefined ? latestIndex(series) : series.y.indexOf(year);
    if (i !== -1 && year !== undefined &&
        SF.isBlank(series.v[i]) && !(series.bd && series.bd[i])) {
      // The year exists in the series but holds nothing.
      return {
        absent: true,
        status: series.st ? series.st[i] : 'missing',
        bound: null,
        year: year
      };
    }
    if (i === -1 && year !== undefined) {
      // The source published no row at all for this group in this year.
      return { absent: true, status: 'missing', bound: null, year: year };
    }
    if (i === -1) {
      var last = series.y.length - 1;
      return {
        absent: true,
        status: series.st && series.st.length ? series.st[last] : 'missing',
        bound: null,
        year: series.y[last]
      };
    }
    // A bound is not a number, so it cannot be formatted or compared, but the
    // source did publish it and the page shows it in place of the value.
    if (SF.isBlank(series.v[i])) {
      return {
        absent: true,
        stated: true,
        status: series.st ? series.st[i] : 'censored',
        bound: series.bd ? series.bd[i] : null,
        year: series.y[i],
        n: series.n ? series.n[i] : null
      };
    }
    // A series with no status array carries nothing but reported values; the
    // build omits the array in that case, which is most of them.
    return {
      absent: false,
      value: series.v[i],
      year: series.y[i],
      n: series.n ? series.n[i] : null,
      comparison: series.c ? series.c[i] : null,
      score: series.s ? series.s[i] : null,
      band: series.b ? series.b[i] : null,
      text: series.t ? series.t[i] : null,
      report: series.rt ? series.rt[i] : null
    };
  }

  // A school with middle and high school grades files two quality reports and
  // publishes some measures in both, for different students. Split them so the
  // profile shows two labeled readings instead of silently picking one.
  function splitByReport(series) {
    if (!series) return [];
    if (!series.rt) return [{ scope: null, series: series }];
    var groups = {};
    var keys = ['v', 'st', 'n', 'c', 's', 'b', 'bd', 't'];
    series.y.forEach(function (year, i) {
      var key = series.rt[i] || '';
      var g = groups[key];
      if (!g) {
        g = groups[key] = { y: [] };
        keys.forEach(function (k) { if (series[k]) g[k] = []; });
      }
      g.y.push(year);
      keys.forEach(function (k) { if (series[k]) g[k].push(series[k][i]); });
    });
    return Object.keys(groups).sort().map(function (key) {
      return { scope: REPORT_LABEL[key] || key, report: key, series: groups[key] };
    });
  }

  function fact(term, value, options) {
    var o = options || {};
    var wrapper = SF.el('div', { class: 'fact' });
    wrapper.appendChild(SF.el('dt', { text: term }));
    var dd = SF.el('dd', { class: o.big ? 'big' : '' });
    if (o.href) {
      dd.appendChild(SF.el('a', { href: o.href, text: value,
                                  rel: o.external ? 'noopener' : null }));
    } else {
      dd.appendChild(document.createTextNode(value));
    }
    if (o.note) dd.appendChild(SF.el('span', { class: 'note', text: o.note }));
    wrapper.appendChild(dd);
    return wrapper;
  }

  // ---- Head and facts ------------------------------------------------

  // Back to Browse with the reader's filters. Browse records its address on
  // every change; without one, the link falls back to the full list.
  function renderBack() {
    var saved = null;
    try { saved = sessionStorage.getItem('sf-results'); } catch (e) {}
    if (!saved) return;
    var link = document.getElementById('back-link');
    link.href = saved.replace(/^.*\//, '');
    link.textContent = '← Back to browse';
  }

  function renderHead(school) {
    var host = document.getElementById('school-head');
    host.innerHTML = '';

    var kind = [school.school_type, school.status === 'former' ? 'closed' : null]
      .filter(Boolean).join(' · ') || 'New York City public school';
    host.appendChild(SF.el('p', { class: 'kind', text: kind }));
    host.appendChild(SF.el('h1', { text: school.name || school.dbn }));

    var rest = [
      school.boro, districtLabel(school.district),
      school.grades ? 'Grades ' + school.grades : null
    ].filter(Boolean).join(' · ');
    // The DBN carries its expansion, since it is the first piece of jargon
    // anyone meets here and it is never explained on the page otherwise.
    host.appendChild(SF.el('p', {
      class: 'where mono',
      html: '<abbr title="District, borough, and school number: the identifier ' +
            'New York City uses for this school">' + SF.escapeHtml(school.dbn) +
            '</abbr>' + (rest ? ' · ' + SF.escapeHtml(rest) : '')
    }));

    document.title = (school.name || school.dbn) + ' — Schools Finder';

    if (school.status === 'former') {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p><strong>This school is not in the current directory or the ' +
              'newest enrollment snapshot.</strong> Its published history is kept ' +
              'here in full. Nothing on this page describes a school you can ' +
              'currently apply to.</p>'
      }));
    }
  }

  // Directory addresses arrive in capitals. They are shown in title case,
  // with the state abbreviation kept.
  function tidyAddress(text) {
    return String(text).toLowerCase()
      .replace(/(^|[\s\-\/(.,])([a-z])/g, function (m, before, c) { return before + c.toUpperCase(); })
      .replace(/\bNy\b/g, 'NY');
  }

  function tidyWebsite(text) {
    return String(text).replace(/^https?:\/\//i, '').replace(/\/$/, '').toLowerCase();
  }

  function renderFacts(school) {
    var host = document.getElementById('school-facts');
    host.innerHTML = '';

    if (!SF.isBlank(school.enrollment)) {
      host.appendChild(fact('Students', SF.fmt.count(school.enrollment),
        { note: school.enrollment_year || null }));
    }
    if (school.grades) host.appendChild(fact('Grades', school.grades));
    if (school.address) {
      host.appendChild(fact('Address', tidyAddress(school.address), {
        href: 'https://www.openstreetmap.org/search?query=' +
              encodeURIComponent(school.address),
        external: true
      }));
    }
    if (school.phone) host.appendChild(fact('Telephone', school.phone, { href: 'tel:' + school.phone }));
    if (school.website) {
      var url = /^https?:/i.test(school.website) ? school.website : 'https://' + school.website;
      host.appendChild(fact('Website', tidyWebsite(school.website), { href: url, external: true }));
    }
    if (school.start_time || school.end_time) {
      host.appendChild(fact('School day',
        [school.start_time, school.end_time].filter(Boolean).join(' to ')));
    }
    if (school.accessibility) host.appendChild(fact('Building access', school.accessibility));
    // The directories write this as 1 or 0, which means nothing on a page.
    if (school.shared_building === '1' || school.shared_building === 1) {
      host.appendChild(fact('Building', 'Shared with at least one other school'));
    } else if (school.shared_building === '0' || school.shared_building === 0) {
      host.appendChild(fact('Building', 'Not shared with another school'));
    }
    if (school.languages) host.appendChild(fact('Languages taught', school.languages));
    if (school.neighborhood) host.appendChild(fact('Neighborhood', school.neighborhood));
    if (school.directory_url) {
      host.appendChild(fact('Directory', 'Open in MySchools',
        { href: school.directory_url, external: true }));
    }

    if (!host.children.length) {
      host.appendChild(SF.el('div', {
        class: 'fact',
        html: '<dt>Contact details</dt><dd>Not published for this school. ' +
              'Only schools in a current admissions directory have them.</dd>'
      }));
    }

    var ids = [];
    if (!SF.isBlank(school.enrollment)) ids.push('demographics');
    if (school.address || school.phone || school.grades) ids.push('directory_es');
    var cited = sourceLine(ids);
    var slot = document.getElementById('facts-source');
    if (slot && cited) { slot.replaceWith(cited); cited.id = 'facts-source'; }
  }

  var COORDINATE_ORIGIN = {
    points: 'Location from the NYC Public Schools school point file.',
    source: 'Location published in the high school directory.',
    geocoded: 'Location matched from the address by this site.'
  };

  // A small map under the facts. The map library loads only when the map
  // scrolls near the screen, so a reader who stays at the top never pays for it.
  function renderLocator(school) {
    var host = document.getElementById('school-locator');
    host.innerHTML = '';
    if (SF.isBlank(school.latitude) || SF.isBlank(school.longitude)) { host.hidden = true; return; }
    host.hidden = false;

    var frame = SF.el('div', { class: 'map-frame', role: 'region',
      'aria-label': 'Map of where ' + (school.name || school.dbn) + ' is' });
    host.appendChild(frame);
    var plain = parseInt(school.district, 10);
    var citywide = plain === 75 || plain === 79 || plain === 84;
    host.appendChild(SF.el('p', { class: 'map-note', text:
      (COORDINATE_ORIGIN[school.coordinate_source] || '') +
      (citywide ? ' This school’s district is citywide, so no area is outlined.'
                : ' The outlined area is ' + districtLabel(school.district) + '.') }));
    host.appendChild(SF.el('p', { class: 'map-note' }, [SF.el('a', {
      href: 'browse.html?view=map' +
            (citywide ? '' : '&district=' + encodeURIComponent(school.district)) +
            '&focus=' + encodeURIComponent(school.dbn),
      text: citywide ? 'See nearby schools on the map' : 'See this district’s schools on the map'
    })]));

    var point = [school.longitude, school.latitude];
    var drawn = false;
    function draw() {
      if (drawn) return;
      drawn = true;
      // On a touch screen one finger scrolls the page past the map, and two
      // fingers pinch it. There is no overlay telling anyone how to scroll.
      SFMap.create(frame, { center: point, zoom: 13, dragPan: !SFMap.touch })
        .then(function (map) {
          if (!map) return;
          SFMap.addDistricts(map, citywide ? '' : school.district).then(function () {
            SFMap.addSchools(map, { type: 'FeatureCollection', features: [{
              type: 'Feature', properties: { dbn: school.dbn },
              geometry: { type: 'Point', coordinates: point } }] });
            SFMap.focus(map, point);
          });
        });
    }
    if (!('IntersectionObserver' in window)) return draw();
    var watch = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { watch.disconnect(); draw(); }
    }, { rootMargin: '300px' });
    watch.observe(frame);
  }

  // The school's own description, set as a quotation: a serif voice apart
  // from the data, curly quotes hung in the margin, and an attribution line.
  // A long one opens at six lines.
  var QUOTE_CLAMP_CHARS = 640;

  function renderOverview(school) {
    var host = document.getElementById('school-overview');
    host.innerHTML = '';
    var text = (school.overview || '').trim();
    if (!text) { host.hidden = true; return; }
    host.hidden = false;

    host.appendChild(SF.el('h2', { class: 'eyebrow', id: 'own-words-title',
      text: 'In the school’s own words' }));
    var figure = SF.el('figure', { class: 'own-words' });
    var quoted = /^["“]/.test(text);
    var para = SF.el('p');
    if (!quoted) para.appendChild(SF.el('span', { class: 'q-open', 'aria-hidden': 'true', text: '“' }));
    para.appendChild(document.createTextNode(text));
    if (!quoted) para.appendChild(SF.el('span', { class: 'q-close', 'aria-hidden': 'true', text: '”' }));
    var quote = SF.el('blockquote', { id: 'own-words-text' }, [para]);
    figure.appendChild(quote);

    var caption = SF.el('figcaption');
    caption.appendChild(document.createTextNode('From the school’s entry in the '));
    var directory = state.sources.directory_es;
    caption.appendChild(SF.el('a', {
      href: school.directory_url || (directory && directory.url) || 'data.html#sources',
      text: 'NYC Public Schools directory'
    }));
    var period = state.periods.directory_es || state.periods.directory_hs;
    caption.appendChild(document.createTextNode(period ? ', ' + period : ''));
    figure.appendChild(caption);
    host.appendChild(figure);

    if (text.length > QUOTE_CLAMP_CHARS) {
      figure.classList.add('clamped');
      var more = SF.el('button', {
        type: 'button', class: 'text-button', 'aria-expanded': 'false',
        'aria-controls': 'own-words-text', text: 'Read the full description'
      });
      more.addEventListener('click', function () {
        var open = figure.classList.toggle('clamped') === false;
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'Show less' : 'Read the full description';
      });
      host.appendChild(more);
    }
  }

  // ---- Sources ------------------------------------------------------------

  // The full citation sits under each section heading. A card that mixes
  // sources names its own in the short form.
  var SOURCE_SHORT = {
    sqr: 'School Quality Reports',
    sqr_results: 'School Quality Report results',
    demographics: 'Demographic Snapshot',
    directory_es: 'School directory',
    directory_ms: 'School directory',
    directory_hs: 'School directory'
  };

  function sourceIdsOf(entries) {
    var ids = [];
    entries.forEach(function (e) {
      var id = e.metric && e.metric.source_id;
      if (id && ids.indexOf(id) === -1) ids.push(id);
    });
    return ids;
  }

  // Sources from the same publisher and outlet share one credit, so a line
  // reads "Demographic Snapshot and School directory, NYC Public Schools".
  // Open Data sources carry their dataset ID.
  function sourceLine(ids) {
    var groups = [];
    var seenTitle = {};
    ids.forEach(function (id) {
      var s = state.sources[id];
      if (!s) return;
      var title = SOURCE_SHORT[id] || s.title;
      if (seenTitle[title]) return;
      seenTitle[title] = true;
      var credit = String(s.agency).split(',')[0] +
        (/data\.cityofnewyork\.us/.test(s.url) ? ', NYC Open Data ' + s.dataset_id : '');
      var group = groups.filter(function (g) { return g.credit === credit; })[0];
      if (!group) groups.push(group = { credit: credit, links: [] });
      group.links.push({ href: s.url, text: title });
    });
    if (!groups.length) return null;

    var line = SF.el('p', { class: 'source-line' });
    var count = groups.reduce(function (n, g) { return n + g.links.length; }, 0);
    line.appendChild(SF.el('span', { class: 'source-tag', text: count > 1 ? 'Sources' : 'Source' }));
    groups.forEach(function (g, i) {
      if (i) line.appendChild(document.createTextNode('; '));
      g.links.forEach(function (link, j) {
        if (j) line.appendChild(document.createTextNode(j === g.links.length - 1 ? ' and ' : ', '));
        line.appendChild(SF.el('a', { href: link.href, text: link.text }));
      });
      line.appendChild(document.createTextNode(', ' + g.credit));
    });
    return line;
  }

  // ---- One reading, rendered ------------------------------------------

  function valueNode(read, metric) {
    var wrapper = SF.el('span', { class: 'm-figure' });
    if (read.absent) {
      // A published bound reads as the figure it is, not as an absence.
      wrapper.appendChild(SF.el('span', {
        class: read.bound ? 'm-value' : 'm-value absent',
        text: read.bound || SF.ABSENCE[read.status] || SF.ABSENCE.missing
      }));
      return wrapper;
    }
    var shown = SF.formatValue(read.value, metric.format);
    var scale = SF.scaleOf(metric.format);
    if (read.text) {
      // A framework rating leads with the City's word. The score it was set
      // from sits beside it, with no band of this site's own.
      wrapper.appendChild(SF.el('span', { class: 'm-value', text: read.text }));
      wrapper.appendChild(SF.el('span', { class: 'm-scale', text: shown + ' ' + scale }));
      wrapper.setAttribute('aria-label', read.text + ', ' + SF.scaleSpoken(shown, metric.format));
      return wrapper;
    }
    wrapper.appendChild(SF.el('span', { class: 'm-value', text: shown }));
    if (scale) {
      wrapper.appendChild(SF.el('span', { class: 'm-scale', text: scale }));
      // Read aloud as "out of", since a slash is spoken as "slash".
      wrapper.setAttribute('aria-label', SF.scaleSpoken(shown, metric.format));
    }
    // Deliberately nothing else here. A band and a score beside the number
    // asked a reader to interpret two scales at once while scanning a column
    // of measures. Where the school stands is in the panel below, where it can
    // be read rather than decoded.
    return wrapper;
  }

  function readingText(read, metric) {
    if (read.absent) return read.bound || SF.ABSENCE[read.status] || SF.ABSENCE.missing;
    return (read.text ? read.text + ' ' : '') + SF.formatValue(read.value, metric.format);
  }

  // The line under a measure's name: its year, how many students it covers,
  // and how it sits against the City's own comparison, said in words.
  function rowMeta(read, metric, extra) {
    var meta = SF.el('span', { class: 'm-meta' });
    var bits = [];
    if (read.absent && read.bound) {
      bits.push(read.year, SF.ABSENCE_DETAIL.censored);
    } else if (read.absent) {
      bits.push(SF.ABSENCE_DETAIL[read.status] || SF.ABSENCE_DETAIL.missing);
    } else {
      bits.push(read.year);
      if (!SF.isBlank(read.n) && metric.source_id !== 'demographics') {
        bits.push(SF.fmt.count(read.n) + ' students');
      }
    }
    bits.forEach(function (b, i) {
      if (i) meta.appendChild(SF.el('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }));
      meta.appendChild(SF.el('span', { text: b }));
    });
    var compare = comparisonParts(read, metric);
    if (compare) {
      meta.appendChild(SF.el('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }));
      meta.appendChild(compareNode(compare, metric));
    }
    if (extra) {
      meta.appendChild(SF.el('span', { class: 'sep', 'aria-hidden': 'true', text: '·' }));
      meta.appendChild(SF.el('span', { text: extra }));
    }
    return meta;
  }

  // How this school sits against the group the City compares it with, as two
  // short pieces rather than a sentence: the gap, and what it is a gap from.
  function comparisonParts(read, metric) {
    if (read.absent || SF.isBlank(read.comparison)) return null;
    var difference = read.value - read.comparison;
    var better = metric.lower_is_better ? difference < 0 : difference > 0;
    var size = Math.abs(difference);

    var gap;
    if (size < 0.0005) {
      gap = 'level with';
    } else if (metric.format === 'pct_unit') {
      var points = (size * 100).toFixed(1);
      gap = points + (points === '1.0' ? ' point ' : ' points ') +
            (difference > 0 ? 'above' : 'below');
    } else {
      gap = size.toFixed(2) + ' ' + (difference > 0 ? 'above' : 'below');
    }

    return {
      gap: gap,
      up: difference > 0,
      better: size < 0.0005 ? null : better,
      average: SF.formatValue(read.comparison, metric.format)
    };
  }

  // "5.7 points below similar schools (62.1%)". The arrow says which way, the
  // color says whether the City counts that direction as better.
  function compareNode(compare, metric) {
    var label = (metric.comparison_label || 'Similar schools').toLowerCase();
    var tone = compare.better === null ? 'level' : (compare.better ? 'better' : 'worse');
    var node = SF.el('span', { class: 'cmp ' + tone });
    if (compare.better !== null) {
      node.appendChild(SF.el('span', { class: 'cmp-mark', 'aria-hidden': 'true',
        text: compare.up ? '▲' : '▼' }));
    }
    node.appendChild(document.createTextNode(compare.gap + ' ' + label + ' (' + compare.average + ')'));
    return node;
  }

  // ---- Peers ----------------------------------------------------------------

  // Every school of the same type, binned by its published value for the same
  // year. The City publishes the values; the picture is this site's and
  // carries no score. A school files up to two reports, and each reading is
  // drawn against the type it has in that report.
  function peerSlugFor(entry) {
    var types = state.payload.peer_types || {};
    if (entry.metric.source_id === 'demographics') return types[''] || null;
    var report = entry.report;
    if (!report) {
      var school = state.payload.school;
      var mine = (school.report_types || school.report_type || '').split('|');
      report = mine.filter(function (r) {
        return (entry.metric.applies_to || []).indexOf(r) !== -1;
      })[0];
    }
    return types[report] || types[''] || null;
  }

  function peerOf(entry) {
    var slug = peerSlugFor(entry);
    var file = slug && state.peers[slug];
    var read = entry.read;
    var byYear = file && file.metrics && file.metrics[entry.metricId];
    var p = byYear && read && byYear[read.year];
    if (!p) return null;
    var onOver = read.absent && read.bound && p.over && read.bound === p.over.label;
    if (read.absent && !onOver) return null;
    return { p: p, type: file.school_type, over: !!onOver, value: onOver ? null : read.value };
  }

  function peerX(p, value, width) {
    var span = p.hi - p.lo;
    var t = span > 0 ? (value - p.lo) / span : 0.5;
    return Math.max(1, Math.min(width - 1, t * width));
  }

  function peerNoun(peer) {
    return TYPE_PLURAL[peer.type] || (String(peer.type || 'similar').toLowerCase() + ' schools');
  }

  // The small version, in the row. Its meaning is in the row's words, so it
  // is hidden from assistive technology.
  function peerStrip(peer) {
    var p = peer.p;
    var W = 132, H = 28;
    var gap = p.over ? 5 : 0, ow = p.over ? 6 : 0;
    var plot = W - gap - ow;
    var max = Math.max.apply(null, p.h.concat(p.over ? [p.over.n] : [1]));
    var bw = plot / p.h.length;
    var svg = svgEl('svg', { class: 'peer-strip', viewBox: '0 0 ' + W + ' ' + H,
      width: W, height: H, 'aria-hidden': 'true', focusable: 'false' });
    p.h.forEach(function (c, i) {
      if (!c) return;
      var h = Math.max(1.5, c / max * (H - 3));
      svg.appendChild(svgEl('rect', { x: (i * bw + 0.5).toFixed(1), y: (H - h).toFixed(1),
        width: Math.max(1, bw - 1).toFixed(1), height: h.toFixed(1) }));
    });
    if (p.over) {
      var oh = Math.max(1.5, p.over.n / max * (H - 3));
      svg.appendChild(svgEl('rect', { class: 'over', x: plot + gap, y: (H - oh).toFixed(1),
        width: ow, height: oh.toFixed(1) }));
    }
    var x = peer.over ? plot + gap + ow / 2 : peerX(p, peer.value, plot);
    svg.appendChild(svgEl('line', { class: 'here', x1: x, x2: x, y1: 0, y2: H }));
    return svg;
  }

  // The full version, in an opened row: counts by value, this school, the
  // City's comparison where there is one, and a reading on hover.
  function peerChart(peer, entry, width) {
    var p = peer.p, metric = entry.metric, read = entry.read;
    var bins = p.h.length;
    var W = Math.max(300, Math.min(720, width || 640));
    var H = 176, pad = { t: 34, r: 6, b: 46, l: 6 };
    var gap = p.over ? 12 : 0;
    var ow = p.over ? Math.max(12, (W - pad.l - pad.r) / (bins + 2)) : 0;
    var plot = W - pad.l - pad.r - gap - ow;
    var max = Math.max.apply(null, p.h.concat(p.over ? [p.over.n] : [1]));
    var bw = plot / bins;
    var base = H - pad.b, top = pad.t;
    var Y = function (c) { return base - c / max * (base - top); };
    var X = function (v) { return pad.l + peerX(p, v, plot); };
    var fmt = function (v) { return SF.formatValue(v, metric.format); };
    var total = p.n + (p.over ? p.over.n : 0);
    var noun = peerNoun(peer);

    var figure = SF.el('figure', { class: 'mx-chart' });
    figure.appendChild(SF.el('p', { class: 'mx-chart-title',
      text: 'Among ' + total.toLocaleString('en-US') + ' ' + noun + ', ' + p.y }));

    var svg = svgEl('svg', {
      class: 'peer-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Histogram of ' + total + ' ' + noun + ' by ' + (metric.base_label || metric.label) +
        ', ' + p.y + ', from ' + fmt(p.lo) + ' to ' + fmt(p.hi) +
        (p.over ? ', with ' + p.over.n + ' published as ' + p.over.label.toLowerCase() : '') +
        '. This school: ' + readingText(read, metric) + '.'
    });
    svg.appendChild(svgEl('line', { class: 'axis', x1: pad.l, x2: W - pad.r, y1: base, y2: base }));

    var bars = [];
    p.h.forEach(function (c, i) {
      var x = pad.l + i * bw;
      var from = p.lo + (p.hi - p.lo) * i / bins;
      var to = p.lo + (p.hi - p.lo) * (i + 1) / bins;
      var rect = null;
      if (c) {
        rect = svgEl('rect', { class: 'bar', x: (x + 1).toFixed(1), y: Y(c).toFixed(1),
          width: Math.max(1, bw - 2).toFixed(1), height: (base - Y(c)).toFixed(1), rx: 1.5 });
        svg.appendChild(rect);
      }
      bars.push({ x0: x, x1: x + bw, rect: rect,
        text: c + (c === 1 ? ' school, ' : ' schools, ') + fmt(from) + ' to ' + fmt(to) });
    });
    if (p.over) {
      var ox = pad.l + plot + gap;
      var orect = svgEl('rect', { class: 'bar over', x: ox.toFixed(1), y: Y(p.over.n).toFixed(1),
        width: ow.toFixed(1), height: (base - Y(p.over.n)).toFixed(1), rx: 1.5 });
      svg.appendChild(orect);
      svg.appendChild(svgEl('text', { class: 'tick', x: ox + ow / 2, y: base + 15,
        'text-anchor': 'middle' }, p.over.label.replace(/^Above /, '>')));
      bars.push({ x0: ox, x1: ox + ow, rect: orect,
        text: p.over.n + ' schools, published only as ' + p.over.label.toLowerCase() });
    }

    svg.appendChild(svgEl('text', { class: 'tick', x: pad.l, y: base + 15, 'text-anchor': 'start' }, fmt(p.lo)));
    svg.appendChild(svgEl('text', { class: 'tick', x: pad.l + plot, y: base + 15, 'text-anchor': 'end' }, fmt(p.hi)));

    if (!read.absent && !SF.isBlank(read.comparison)) {
      var cx = X(read.comparison);
      svg.appendChild(svgEl('line', { class: 'cmp', x1: cx, x2: cx, y1: top - 6, y2: base + 22 }));
      var cAnchor = cx > W * 0.72 ? 'end' : (cx < W * 0.28 ? 'start' : 'middle');
      svg.appendChild(svgEl('text', { class: 'cmp-label', x: cx, y: base + 36, 'text-anchor': cAnchor },
        (metric.comparison_label || 'Similar schools') + ' ' + fmt(read.comparison)));
    }

    var hx = peer.over ? pad.l + plot + gap + ow / 2 : X(read.value);
    svg.appendChild(svgEl('line', { class: 'here', x1: hx, x2: hx, y1: top - 12, y2: base }));
    svg.appendChild(svgEl('circle', { class: 'here-dot', cx: hx, cy: top - 12, r: 4.5 }));
    var hAnchor = hx > W * 0.66 ? 'end' : 'start';
    svg.appendChild(svgEl('text', { class: 'here-label', x: hx + (hAnchor === 'end' ? -9 : 9), y: top - 8,
      'text-anchor': hAnchor }, 'This school, ' + readingText(read, metric)));

    var wrap = SF.el('div', { class: 'chart-wrap' });
    var tip = SF.el('div', { class: 'chart-tip', hidden: '' });
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    figure.appendChild(wrap);

    var hot = null;
    svg.addEventListener('pointermove', function (ev) {
      var box = svg.getBoundingClientRect();
      var px = (ev.clientX - box.left) * (W / box.width);
      var bar = bars.filter(function (b) { return px >= b.x0 && px < b.x1; })[0];
      if (hot && hot !== bar && hot.rect) hot.rect.classList.remove('hot');
      if (!bar) { tip.hidden = true; hot = null; return; }
      hot = bar;
      if (bar.rect) bar.rect.classList.add('hot');
      tip.textContent = bar.text;
      tip.hidden = false;
      tip.style.left = ((bar.x0 + bar.x1) / 2 * box.width / W) + 'px';
      tip.style.top = (top * box.height / H) + 'px';
    });
    svg.addEventListener('pointerleave', function () {
      tip.hidden = true;
      if (hot && hot.rect) hot.rect.classList.remove('hot');
      hot = null;
    });

    var notes = ['Each bar counts schools by their published value.',
      'The green line is this school.'];
    if (!read.absent && !SF.isBlank(read.comparison)) {
      notes.push('The dashed line is the City’s ' +
        (metric.comparison_label || 'similar schools').toLowerCase() + ' figure for this school.');
    }
    if (!SF.isBlank(p.md)) notes.push('Half of these schools are above ' + fmt(p.md) + '.');
    if (metric.lower_is_better) notes.push('Lower is better for this measure.');
    figure.appendChild(SF.el('figcaption', { text: notes.join(' ') }));
    return figure;
  }

  // Round tick steps: 1, 2, 2.5 or 5 times a power of ten.
  function niceTicks(lo, hi, count) {
    var raw = (hi - lo) / Math.max(1, count);
    var power = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var step = [1, 2, 2.5, 5, 10].map(function (m) { return m * power; })
      .filter(function (s) { return s >= raw; })[0] || power * 10;
    var ticks = [];
    for (var t = Math.ceil(lo / step) * step; t <= hi + step * 1e-6; t += step) {
      ticks.push(Math.round(t / step) * step);
    }
    return { ticks: ticks, step: step };
  }

  function tickText(value, step, metric) {
    if (metric.format === 'pct_unit') {
      return (value * 100).toFixed(step * 100 < 1 ? 1 : 0) + '%';
    }
    var places = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    return Number(value).toFixed(places);
  }

  // The measure year by year, with the City's comparison where it publishes
  // one. A year with no figure breaks the line rather than bridging it.
  function trendChart(entry, width) {
    var s = entry.series, metric = entry.metric;
    if (!s) return null;
    var own = [], cmp = [];
    s.y.forEach(function (y, i) {
      own.push(SF.isBlank(s.v[i]) ? null : s.v[i]);
      cmp.push(s.c && !SF.isBlank(s.c[i]) && !SF.isBlank(s.v[i]) ? s.c[i] : null);
    });
    var points = own.filter(function (v) { return v !== null; });
    if (points.length < 2) return null;
    var hasCmp = cmp.filter(function (v) { return v !== null; }).length > 1;

    var all = points.concat(cmp.filter(function (v) { return v !== null; }));
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var padv = Math.max((hi - lo) * 0.15, metric.format === 'pct_unit' ? 0.02 : Math.abs(hi) * 0.02 || 0.1);
    lo -= padv; hi += padv;
    if (metric.format === 'pct_unit') {
      // A percentage axis spans at least 25 points, so a small change does
      // not read as a cliff.
      var mid = (lo + hi) / 2;
      if (hi - lo < 0.25) { lo = mid - 0.125; hi = mid + 0.125; }
      if (lo < 0) { hi -= lo; lo = 0; }
      if (hi > 1 && Math.max.apply(null, all) <= 1) { lo = Math.max(0, lo - (hi - 1)); hi = 1; }
    }
    var scale = niceTicks(lo, hi, 4);
    lo = Math.min(lo, scale.ticks[0]); hi = Math.max(hi, scale.ticks[scale.ticks.length - 1]);

    var W = Math.max(300, Math.min(720, width || 640)), H = 190;
    var pad = { t: 14, r: 14, b: 28, l: 48 };
    var n = Math.max(1, s.y.length - 1);
    var X = function (i) { return pad.l + i / n * (W - pad.l - pad.r); };
    var Y = function (v) { return H - pad.b - (v - lo) / (hi - lo) * (H - pad.t - pad.b); };

    var figure = SF.el('figure', { class: 'mx-chart' });
    figure.appendChild(SF.el('p', { class: 'mx-chart-title', text: 'Over time' }));
    var svg = svgEl('svg', {
      class: 'trend-chart', viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Line chart of this school’s figure by school year, ' + s.y[0] + ' to ' +
        s.y[s.y.length - 1] + (hasCmp ? ', with the City’s comparison figure' : '') +
        '. The values are listed under Every year.'
    });
    scale.ticks.forEach(function (t) {
      if (t < lo - 1e-9 || t > hi + 1e-9) return;
      svg.appendChild(svgEl('line', { class: 'grid', x1: pad.l, x2: W - pad.r, y1: Y(t), y2: Y(t) }));
      svg.appendChild(svgEl('text', { class: 'tick', x: pad.l - 8, y: Y(t) + 4, 'text-anchor': 'end' },
        tickText(t, scale.step, metric)));
    });
    var every = s.y.length > 8 ? 3 : s.y.length > 5 ? 2 : 1;
    s.y.forEach(function (y, i) {
      if ((s.y.length - 1 - i) % every) return;
      svg.appendChild(svgEl('text', { class: 'tick', x: X(i), y: H - 8, 'text-anchor': 'middle' }, y));
    });

    function path(values) {
      var d = '', pen = false;
      values.forEach(function (v, i) {
        if (v === null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1);
        pen = true;
      });
      return d;
    }
    if (hasCmp) svg.appendChild(svgEl('path', { class: 'cmp-line', d: path(cmp) }));
    svg.appendChild(svgEl('path', { class: 'own-line', d: path(own) }));
    own.forEach(function (v, i) {
      if (v !== null) svg.appendChild(svgEl('circle', { class: 'pt', cx: X(i), cy: Y(v), r: 4 }));
    });
    var cross = svgEl('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, visibility: 'hidden' });
    svg.appendChild(cross);

    var wrap = SF.el('div', { class: 'chart-wrap' });
    var tip = SF.el('div', { class: 'chart-tip', hidden: '' });
    wrap.appendChild(svg);
    wrap.appendChild(tip);
    figure.appendChild(wrap);

    svg.addEventListener('pointermove', function (ev) {
      var box = svg.getBoundingClientRect();
      var px = (ev.clientX - box.left) * (W / box.width);
      var i = Math.max(0, Math.min(n, Math.round((px - pad.l) / (W - pad.l - pad.r) * n)));
      var parts = [s.y[i], 'This school ' + (own[i] === null
        ? (SF.ABSENCE[s.st ? s.st[i] : 'missing'] || SF.ABSENCE.missing)
        : SF.formatValue(own[i], metric.format))];
      if (hasCmp && cmp[i] !== null) {
        parts.push((metric.comparison_label || 'Similar schools') + ' ' + SF.formatValue(cmp[i], metric.format));
      }
      tip.textContent = parts.join(' · ');
      tip.hidden = false;
      cross.setAttribute('x1', X(i));
      cross.setAttribute('x2', X(i));
      cross.setAttribute('visibility', 'visible');
      tip.style.left = (X(i) * box.width / W) + 'px';
      tip.style.top = (pad.t * box.height / H) + 'px';
    });
    svg.addEventListener('pointerleave', function () {
      tip.hidden = true;
      cross.setAttribute('visibility', 'hidden');
    });

    var legend = SF.el('p', { class: 'legend' });
    legend.appendChild(SF.el('span', { class: 'key' }, [SF.el('span', { class: 'sw-line' }),
      document.createTextNode('This school')]));
    if (hasCmp) {
      legend.appendChild(SF.el('span', { class: 'key' }, [SF.el('span', { class: 'sw-dash' }),
        document.createTextNode('City’s ' + (metric.comparison_label || 'similar schools').toLowerCase() + ' figure')]));
    }
    figure.appendChild(legend);
    return figure;
  }

  // ---- An opened measure ----------------------------------------------------

  function explorePanel(entry, base, primary, width) {
    var metric = entry.metric, read = entry.read;
    var box = SF.el('div', { class: 'mx' });

    var peer = peerOf(entry);
    if (peer) box.appendChild(peerChart(peer, entry, width));
    var trend = trendChart(entry, width);
    if (trend) box.appendChild(trend);

    var rows = SF.el('dl', { class: 'm-facts' });
    function row(term, value, cls) {
      var wrap = SF.el('div', { class: cls || '' });
      wrap.appendChild(SF.el('dt', { text: term }));
      var dd = SF.el('dd');
      if (value instanceof Node) dd.appendChild(value); else dd.textContent = value;
      wrap.appendChild(dd);
      rows.appendChild(wrap);
    }

    if (!read.absent && read.band && !SF.isBlank(read.score)) {
      var standing = SF.el('span', { class: 'standing' });
      var chip = SF.el('span', { class: 'band band-' + read.band });
      chip.appendChild(SF.el('span', { text: SF.BAND_SHORT[read.band] }));
      chip.appendChild(SF.el('span', { class: 'score', text: Number(read.score).toFixed(1) + ' of 5' }));
      standing.appendChild(chip);
      standing.appendChild(document.createTextNode(' The City scores each measure from 1 to 5 ' +
        'against schools it considers similar to this one.'));
      row('City’s score', standing);
    }
    row('City’s name', metric.source_label || metric.label);
    row('Published for', reportCoverage(metric));
    if (metric.first_year || metric.last_year) {
      row('Years', (metric.first_year || '') + ' to ' + (metric.last_year || ''));
    }
    row('Unit', metric.unit + (metric.format_source === 'inferred'
      ? ' (inferred from the values, not stated by the source)' : ''));
    if (metric.lower_is_better) row('Direction', 'Lower is better');
    var src = state.sources[metric.source_id];
    if (src) {
      var cite = SF.el('span');
      cite.appendChild(SF.el('a', { href: src.url, text: SOURCE_SHORT[metric.source_id] || src.title }));
      cite.appendChild(document.createTextNode(', ' + String(src.agency).split(',')[0] + ' '));
      cite.appendChild(SF.el('code', { class: 'src-col', text: entry.metricId }));
      row('Source', cite);
    } else {
      row('Source', metric.source_id + ' · ' + entry.metricId, 'mono-row');
    }
    if (metric.comparability_note) row('Careful', metric.comparability_note, 'careful');
    box.appendChild(rows);

    var series = entry.series;
    if (series && series.y.length) {
      var years = SF.el('div', { class: 'mx-years' });
      years.appendChild(SF.el('p', { class: 'm-facts-label', text: 'Every year' }));
      var strip = SF.el('div', { class: 'history' });
      series.y.forEach(function (year, i) {
        var chip = SF.el('span', { class: 'h-year' });
        chip.appendChild(document.createTextNode(year + ' '));
        chip.appendChild(SF.el('b', {
          text: SF.isBlank(series.v[i])
            ? (series.bd && series.bd[i] ? series.bd[i]
               : (SF.ABSENCE[series.st ? series.st[i] : 'missing'] || SF.ABSENCE.missing))
            : (series.t && series.t[i] ? series.t[i] + ' ' : '') +
              SF.formatValue(series.v[i], metric.format)
        }));
        strip.appendChild(chip);
      });
      years.appendChild(strip);
      box.appendChild(years);
    }

    if (primary && base.groups.length) {
      var groups = SF.el('div', { class: 'mx-groups' });
      groups.appendChild(SF.el('p', { class: 'm-facts-label',
        text: 'By student group' + (base.year ? ', ' + base.year : '') }));
      groups.appendChild(groupsNode(base.groups, { yearStatedAbove: true, explainAbsences: true }));
      box.appendChild(groups);
    }
    return box;
  }

  function reportCoverage(metric) {
    return (metric.applies_to || [])
      .map(function (r) { return REPORT_COVERS[r] || r; }).join(', ');
  }

  // ---- Groups under a measure ------------------------------------------

  function groupRow(member, options) {
    var o = options || {};
    var read = member.read;
    var row = SF.el('li', { class: 'group-row' });
    // A school with two reports lists a group once per report, so each row
    // names its report.
    row.appendChild(SF.el('span', { class: 'g-name', text: member.metric.subgroup +
      (member.scope ? ', ' + member.scope : '') }));

    if (read.absent) {
      row.appendChild(SF.el('span', {
        class: 'g-meta',
        text: (read.bound && !o.sharedYear) ? read.year : ''
      }));
      row.appendChild(SF.el('span', {
        class: read.bound ? 'g-value' : 'g-value absent',
        text: read.bound || SF.ABSENCE[read.status] || SF.ABSENCE.missing
      }));
      return row;
    }

    var meta = [];
    // The year is dropped from the rows when every row shares it, and stated
    // once for the whole card instead.
    if (!o.sharedYear) meta.push(read.year);
    // The demographic snapshot reports each share against the school's whole
    // enrollment, which is already its own row. Repeating it on every line is
    // noise, not provenance.
    if (!SF.isBlank(read.n) && member.metric.source_id !== 'demographics') {
      meta.push(SF.fmt.count(read.n) + ' students');
    }
    row.appendChild(SF.el('span', {
      class: 'g-meta', text: meta.length ? meta.join(' · ') : ''
    }));
    row.appendChild(SF.el('span', {
      class: 'g-value', text: SF.formatValue(read.value, member.metric.format)
    }));
    return row;
  }

  // Themes in a stated order, and alphabetical within a theme. Any other order
  // inside a race or ethnicity list is a judgment nobody asked for.
  function groupsNode(members, options) {
    var o = options || {};
    var byTheme = {};
    members.forEach(function (m) {
      var theme = m.metric.theme || 'other';
      (byTheme[theme] = byTheme[theme] || []).push(m);
    });

    var order = SF.display.theme_order && SF.display.theme_order.length
      ? SF.display.theme_order
      : ['all', 'race', 'gender', 'groups', 'setting', 'achievement', 'grade'];
    var themes = Object.keys(byTheme).sort(function (a, b) {
      var ai = order.indexOf(a), bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.localeCompare(b);
    });

    // When every reading in the card is from the same year, say so once at the
    // top rather than on each line.
    var years = {};
    members.forEach(function (m) { if (!m.read.absent) years[m.read.year] = true; });
    var yearList = Object.keys(years);
    var sharedYear = yearList.length === 1 ? yearList[0] : null;

    var body = SF.el('div');
    themes.forEach(function (theme) {
      var rows = byTheme[theme].sort(function (a, b) {
        return String(a.metric.subgroup).localeCompare(String(b.metric.subgroup),
                                                       'en', { numeric: true });
      });
      var label = (SF.display.themes && SF.display.themes[theme]) ||
                  (SF.display.demographic_themes && SF.display.demographic_themes[theme]) ||
                  theme;
      if (!o.hideThemeLabel || themes.length > 1) {
        body.appendChild(SF.el('p', { class: 'group-theme', text: label }));
      }
      var list = SF.el('ul', { class: 'group-list' });
      rows.forEach(function (m) { list.appendChild(groupRow(m, { sharedYear: sharedYear })); });
      body.appendChild(list);
    });
    if (sharedYear && !o.yearStatedAbove) {
      var from = sourceIdsOf(members).map(function (id) { return SOURCE_SHORT[id]; })
        .filter(Boolean);
      body.appendChild(SF.el('p', { class: 'm-meta',
        text: 'All from ' + sharedYear + (from.length === 1 ? ' · ' + from[0] : '') }));
    }
    if (o.explainAbsences) {
      body.appendChild(SF.el('p', {
        class: 'm-meta',
        text: 'Every group this measure covers is listed. Withheld means the ' +
              'City calculated a figure and held it back because too few ' +
              'students are in the group. Not reported means it published none.'
      }));
    }
    return body;
  }

  // ---- Measure rows -------------------------------------------------------

  // One measure, one row: name, year and comparison on the left, the value,
  // then where it falls among schools of the same type. The row is a button;
  // opening it builds the panel the first time.
  var rowCount = 0;

  function measureRow(entry, base, options) {
    var o = options || {};
    var id = 'measure-' + (++rowCount);
    var item = SF.el('li', { class: 'mrow', 'data-metric': entry.metricId });
    var button = SF.el('button', {
      type: 'button', class: 'mrow-btn', 'aria-expanded': 'false', 'aria-controls': id
    });
    var label = o.label || base.label;
    if (o.scope) label += ', ' + o.scope;
    button.appendChild(SF.el('span', { class: 'mrow-label', text: label }));
    var groups = o.primary && base.groups.length
      ? base.groups.length + (base.groups.length === 1 ? ' student group' : ' student groups')
      : null;
    button.appendChild(rowMeta(entry.read, entry.metric, groups));
    var value = valueNode(entry.read, entry.metric);
    value.classList.add('mrow-value');
    button.appendChild(value);
    var slot = SF.el('span', { class: 'mrow-peer' });
    var peer = o.older ? null : peerOf(entry);
    if (peer) slot.appendChild(peerStrip(peer));
    button.appendChild(slot);
    button.appendChild(SF.el('span', { class: 'mrow-chev', 'aria-hidden': 'true' }));
    item.appendChild(button);

    var definition = definitionOf(entry.metricId);
    if (definition) item.appendChild(SF.el('p', { class: 'm-def', text: definition }));
    if (entry.read.text && !entry.read.absent) item.appendChild(ratingScale(entry.read));

    var panel = SF.el('div', { class: 'mrow-panel', id: id, hidden: '' });
    item.appendChild(panel);
    var built = false;
    button.addEventListener('click', function () {
      var open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (open && !built) {
        built = true;
        panel.appendChild(explorePanel(entry, base, o.primary, panel.clientWidth));
      }
      if (open) setHash(view.current, entry.metricId);
    });
    return item;
  }

  // Shares that make up a whole, such as race and ethnicity, read as one
  // block of bars rather than as separate measures.
  var COMPOSITION_THEMES = ['race', 'gender'];

  function isComposition(base) {
    return !base.primaries.length && base.groups.length > 1 &&
      base.groups.every(function (g) { return COMPOSITION_THEMES.indexOf(g.metric.theme) !== -1; });
  }

  function compositionBlock(base) {
    var item = SF.el('li', { class: 'mblock', 'data-metric': base.groups[0].metricId });
    var head = SF.el('div', { class: 'mblock-head' });
    head.appendChild(SF.el('h4', { class: 'mrow-label', text: base.label }));
    var year = base.year;
    if (!year) {
      var said = base.groups.filter(function (g) { return !g.read.absent; })[0];
      year = said ? said.read.year : null;
    }
    var from = sourceIdsOf(base.groups).map(function (id) { return SOURCE_SHORT[id]; }).filter(Boolean);
    head.appendChild(SF.el('span', { class: 'm-meta',
      text: [year, from.length === 1 ? from[0] : null].filter(Boolean).join(' · ') }));
    item.appendChild(head);

    var list = SF.el('ul', { class: 'comp-list' });
    base.groups.slice().sort(function (a, b) {
      return String(a.metric.subgroup).localeCompare(String(b.metric.subgroup), 'en', { numeric: true }) ||
             String(a.scope || '').localeCompare(String(b.scope || ''));
    }).forEach(function (g) {
      var row = SF.el('li', { class: 'comp-row' });
      row.appendChild(SF.el('span', { class: 'comp-name',
        text: g.metric.subgroup + (g.scope ? ', ' + g.scope : '') }));
      var bar = SF.el('span', { class: 'comp-bar', 'aria-hidden': 'true' });
      if (!g.read.absent && g.metric.format === 'pct_unit') {
        bar.appendChild(SF.el('span', {
          style: 'width:' + Math.min(100, Math.max(0, g.read.value * 100)).toFixed(1) + '%'
        }));
      }
      row.appendChild(bar);
      row.appendChild(SF.el('span', {
        class: 'comp-value' + (g.read.absent && !g.read.bound ? ' absent' : ''),
        text: readingText(g.read, g.metric)
      }));
      list.appendChild(row);
    });
    item.appendChild(list);
    var note = base.groups.map(function (g) { return g.metric.card_note; }).filter(Boolean)[0];
    if (note) item.appendChild(SF.el('p', { class: 'card-note', text: note }));
    return item;
  }

  // ---- Compared with nearby students --------------------------------------

  // The City publishes the school's own race and ethnicity shares beside those
  // of public school students living nearby and of its district or borough.
  // Stacked bars show the comparison at a glance; the table under them holds
  // the exact shares and is what a screen reader reads.
  var PIVOT_COLUMNS = [
    ['school', 'This school'],
    ['nearby', 'Living nearby'],
    ['district', 'District'],
    ['borough', 'Borough']
  ];

  function nearbyCard(base, item) {
    // A school with two reports gets one table per report. A column published
    // in only one of them, such as District for the middle grades, carries no
    // report of its own, so it joins the report its metric applies to.
    var reports = [];
    base.groups.forEach(function (g) {
      if (g.report && reports.indexOf(g.report) === -1) reports.push(g.report);
    });
    base.groups.forEach(function (g) {
      if (g.report || reports.length < 2) return;
      var fits = reports.filter(function (r) { return (g.metric.applies_to || []).indexOf(r) !== -1; });
      if (fits.length === 1) { g.report = fits[0]; g.scope = REPORT_LABEL[fits[0]] || fits[0]; }
    });
    var scopes = [];
    base.groups.forEach(function (g) {
      if (scopes.indexOf(g.scope) === -1) scopes.push(g.scope);
    });
    scopes.sort(function (a, b) { return String(a || '').localeCompare(String(b || '')); });
    var hasNearby = base.groups.some(function (g) {
      return g.metric.pivot === 'nearby' && !g.read.absent;
    });
    item.setAttribute('data-metric', base.groups[0].metricId);
    var head = SF.el('div', { class: 'mblock-head' });
    head.appendChild(SF.el('h4', { class: 'mrow-label',
      text: hasNearby ? 'Compared with students living nearby' : 'Compared with the borough' }));
    item.appendChild(head);

    scopes.forEach(function (scope) {
      var mine = base.groups.filter(function (g) { return g.scope === scope; });
      var cells = {}, races = [], distance = null, year = null;
      mine.forEach(function (g) {
        if (g.metric.pivot === 'distance') { if (!g.read.absent) distance = g.read; return; }
        if (!g.read.absent && !year) year = g.read.year;
        if (races.indexOf(g.metric.subgroup) === -1) races.push(g.metric.subgroup);
        cells[g.metric.pivot + '|' + g.metric.subgroup] = g;
      });
      races.sort();
      var columns = PIVOT_COLUMNS.filter(function (c) {
        return races.some(function (r) {
          var g = cells[c[0] + '|' + r];
          return g && !g.read.absent;
        });
      });
      if (!columns.length) return;

      if (scope) item.appendChild(SF.el('p', { class: 'group-theme', text: scope }));
      item.appendChild(stackedBars(columns, races, cells));

      var table = SF.el('table', { class: 'pivot' });
      table.appendChild(SF.el('caption', { class: 'sr-only',
        text: 'Race and ethnicity at this school and among comparison groups' + (year ? ', ' + year : '') }));
      var headRow = SF.el('tr', {}, [SF.el('th', { scope: 'col', text: 'Race and ethnicity' })]);
      columns.forEach(function (c) {
        headRow.appendChild(SF.el('th', { scope: 'col', text: c[1] }));
      });
      table.appendChild(SF.el('thead', {}, [headRow]));
      var body = SF.el('tbody');
      races.forEach(function (race, i) {
        var name = SF.el('th', { scope: 'row' }, [
          SF.el('span', { class: 'sw s' + i, 'aria-hidden': 'true' }),
          document.createTextNode(race)
        ]);
        var tr = SF.el('tr', {}, [name]);
        columns.forEach(function (c) {
          var g = cells[c[0] + '|' + race];
          var read = g ? g.read : { absent: true, status: 'missing' };
          tr.appendChild(SF.el('td', {
            class: read.absent ? 'absent' : '',
            text: read.absent
              ? (SF.ABSENCE[read.status] || SF.ABSENCE.missing)
              : SF.formatValue(read.value, g.metric.format)
          }));
        });
        body.appendChild(tr);
      });
      table.appendChild(body);
      item.appendChild(SF.el('div', { class: 'pivot-wrap' }, [table]));

      var from = sourceIdsOf(mine).map(function (id) { return SOURCE_SHORT[id]; }).filter(Boolean);
      var note = year ? 'All from ' + year + (from.length === 1 ? ' · ' + from[0] : '') + '. ' : '';
      if (distance) {
        note += 'Living nearby counts public school students in the same grades who ' +
          'live within ' + SF.formatValue(distance.value, 'miles') + ' of the school, ' +
          'the median distance its own students live from it. The City says a ' +
          'large gap between this school and nearby students may point to school ' +
          'factors, such as admissions, more than to housing.';
      }
      item.appendChild(SF.el('p', { class: 'card-note', text: note }));
    });
    return item;
  }

  // One bar per group, one segment per race in a fixed order and color, so a
  // race keeps its color from bar to bar.
  function stackedBars(columns, races, cells) {
    var box = SF.el('div', { class: 'stack', 'aria-hidden': 'true' });
    columns.forEach(function (c) {
      var row = SF.el('div', { class: 'stack-row' });
      row.appendChild(SF.el('span', { class: 'stack-name', text: c[1] }));
      var bar = SF.el('span', { class: 'stack-bar' });
      races.forEach(function (race, i) {
        var g = cells[c[0] + '|' + race];
        if (!g || g.read.absent || !(g.read.value > 0)) return;
        bar.appendChild(SF.el('span', {
          class: 'seg s' + i, style: 'flex-basis:' + (g.read.value * 100).toFixed(2) + '%',
          title: race + ' ' + SF.formatValue(g.read.value, g.metric.format)
        }));
      });
      row.appendChild(bar);
      box.appendChild(row);
    });
    return box;
  }

  // ---- Assembling the sections ------------------------------------------

  function appliesToSchool(metric, school) {
    var mine = (school.report_types || school.report_type || '').split('|');
    if (!mine.length || !mine[0]) return true;
    return (metric.applies_to || []).some(function (r) { return mine.indexOf(r) !== -1; });
  }

  function metric_base(metric, metricId) {
    return metric.base_id || (metric.category + ':' + metricId);
  }

  function newBase(key, metric) {
    return {
      key: key,
      label: metric.base_label || metric.label,
      category: metric.category,
      themeRank: metric.theme_rank,
      headline: false,
      primaries: [],
      groups: []
    };
  }

  function collectBases(payload, metrics) {
    var series = payload.series || {};
    var bases = {};
    var absent = {};
    var notApplicable = {};

    // First pass: every measure the source said anything about for this school.
    //
    // "Said anything" includes a withheld value. A group the City suppressed
    // because too few students are in it is a published fact, and one this
    // whole site is built around keeping. Dropping those rows made a race
    // breakdown show Black and Hispanic and silently omit Asian and White,
    // leaving a reader to guess whether the school has no such students, or
    // the page has a hole in it. Neither guess was right.
    Object.keys(metrics).forEach(function (metricId) {
      var raw = series[metricId];
      if (!raw) return;                     // nothing at all: handled below
      var parts = splitByReport(raw);

      var key = metric_base(metrics[metricId], metricId);
      var base = bases[key] || (bases[key] = newBase(key, metrics[metricId]));
      if (metrics[metricId].headline) base.headline = true;
      base.themeRank = Math.min(base.themeRank, metrics[metricId].theme_rank);

      parts.forEach(function (p) {
        var entry = {
          metricId: metricId, metric: metrics[metricId],
          series: p.series, read: reading(p.series), scope: p.scope, report: p.report
        };
        if (metrics[metricId].subgroup && metrics[metricId].theme !== 'all') {
          base.groups.push(entry);
        } else {
          base.primaries.push(entry);
        }
      });
    });

    // Second pass: the measures with nothing at all.
    //
    // A student group that belongs to a card already on the page is listed
    // there as not reported, so the list of groups is the same list for every
    // school and a gap is never left to inference. Anything else goes to the
    // collapsed note at the end of its section.
    Object.keys(metrics).forEach(function (metricId) {
      var metric = metrics[metricId];
      if (series[metricId]) return;
      if (!appliesToSchool(metric, payload.school)) return;

      // A City file that covers district-run schools only does not apply to
      // a charter school, which is different from not reporting.
      if (metric.charters === false && isCharter(payload.school)) {
        (notApplicable[metric.category] = notApplicable[metric.category] || [])
          .push(metric.label || metricId);
        return;
      }

      var key = metric_base(metric, metricId);
      if (metric.subgroup && metric.theme !== 'all' && bases[key]) {
        bases[key].groups.push({
          metricId: metricId, metric: metric, series: null,
          read: { absent: true, status: 'missing', bound: null, year: null },
          scope: null
        });
        return;
      }
      (absent[metric.category] = absent[metric.category] || [])
        .push(metric.label || metricId);
    });

    Object.keys(bases).forEach(function (key) { alignToOneYear(bases[key]); });
    return { bases: bases, absent: absent, notApplicable: notApplicable };
  }

  function isCharter(school) {
    return parseInt(school.district, 10) === 84;
  }

  // Put every reading in a card on the same school year.
  //
  // The year is taken from the all-students figure, because that is the line
  // the card leads with and the one a reader anchors to. A group with nothing
  // that year reads as not reported, which is what it is. Its earlier figures
  // are not lost: they are in the year-by-year strip in the panel, which is
  // where someone deliberately looking for history will go.
  function alignToOneYear(base) {
    var anchor = base.primaries.length ? base.primaries[0] : null;
    if (!anchor) {
      anchor = base.groups.filter(function (g) { return g.metric.theme === 'all'; })[0] || null;
    }
    var year = anchor && anchor.read && !anchor.read.absent
      ? anchor.read.year
      : latestYearAcross(base);
    if (!year) return;

    base.year = year;
    base.primaries.concat(base.groups).forEach(function (entry) {
      // A group with no series at all keeps its not-reported reading, and
      // takes the card's year so the row is not the one line without one.
      if (!entry.series) { entry.read.year = year; return; }
      entry.read = reading(entry.series, year);
    });
    // A card where nothing at all lands on the anchor year would be worse than
    // a mixed one, so fall back rather than blank the whole thing.
    var anySaid = base.primaries.concat(base.groups).some(function (e) {
      return !e.read.absent || e.read.stated || e.read.bound;
    });
    if (!anySaid) {
      base.year = null;
      base.primaries.concat(base.groups).forEach(function (entry) {
        if (entry.series) entry.read = reading(entry.series);
      });
    }
  }

  function latestYearAcross(base) {
    var best = null;
    base.primaries.concat(base.groups).forEach(function (entry) {
      var read = entry.read;
      if (read && read.year && (!best || String(read.year) > String(best))) {
        best = read.year;
      }
    });
    return best;
  }

  // The measures worth showing first. Each slot names the metrics that can
  // fill it, and the first one this school reports is used. Nothing here is
  // summarized or scored: they are the same rows the topic tabs hold.
  function glanceEntries(bases) {
    var found = {};
    Object.keys(bases).forEach(function (key) {
      var base = bases[key];
      base.primaries.forEach(function (entry) {
        (found[entry.metricId] = found[entry.metricId] || [])
          .push({ entry: entry, base: base, label: base.label, primary: true,
                  scope: base.primaries.length > 1 ? entry.scope : null });
      });
      base.groups.forEach(function (entry) {
        (found[entry.metricId] = found[entry.metricId] || [])
          .push({ entry: entry, base: base, label: entry.metric.label || entry.metric.subgroup,
                  primary: false, scope: entry.scope });
      });
    });

    var picked = [];
    (SF.display.glance || []).forEach(function (slot) {
      for (var i = 0; i < slot.length; i++) {
        var hits = (found[slot[i]] || []).filter(function (f) {
          return !f.entry.read.absent || f.entry.read.bound;
        });
        if (hits.length) { picked.push(hits[0]); return; }
      }
    });
    return picked;
  }

  // ---- Quality report ratings -------------------------------------------

  function ratingsNote() {
    return SF.el('p', {
      class: 'section-note',
      text: 'The City’s own scores and ratings, as published. This site adds no ' +
            'score or rating of its own.'
    });
  }

  // Impact and Performance are read against a midpoint the reader cannot
  // guess, so each says what it compares beside the number.
  function definitionOf(metricId) {
    var type = state.payload && TYPE_PLURAL[state.payload.school.school_type];
    var forType = type ? ' for ' + type : ' for its type of school';
    if (metricId === 'qr_performance') {
      return 'Student results against the citywide average' + forType + '. 0.50 is the middle.';
    }
    if (metricId === 'qr_impact') {
      return 'Student results against how similar students do across the city. ' +
             '0.50 is the middle' + forType + '.';
    }
    return null;
  }

  // The City's four steps. The first digit of the score sets the word, so the
  // scale is drawn with the school's score marked on it.
  var RATING_STEPS = [
    [1, 'Needs Improvement'], [2, 'Fair'], [3, 'Good'], [4, 'Excellent']
  ];

  function ratingScale(read) {
    var score = Number(read.value);
    var scale = SF.el('div', {
      class: 'rating-scale', role: 'img',
      'aria-label': 'The City’s scale runs from 1.00 to 4.99. 1 is Needs Improvement, ' +
                    '2 Fair, 3 Good and 4 Excellent. This school: ' +
                    score.toFixed(2) + ', ' + read.text + '.'
    });
    RATING_STEPS.forEach(function (step) {
      var on = Math.floor(score) === step[0];
      var cell = SF.el('span', { class: 'rs-step' + (on ? ' on' : '') });
      var bar = SF.el('span', { class: 'rs-bar' });
      if (on) {
        var at = Math.max(0, Math.min(100, (score - step[0]) / 0.99 * 100));
        bar.appendChild(SF.el('span', { class: 'rs-mark', style: 'left:' + at.toFixed(1) + '%' }));
      }
      cell.appendChild(bar);
      var word = SF.el('span', { class: 'rs-word' });
      word.appendChild(SF.el('span', { class: 'rs-digit', text: String(step[0]) }));
      word.appendChild(document.createTextNode(' ' + step[1]));
      cell.appendChild(word);
      scale.appendChild(cell);
    });
    return scale;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs, text) {
    var node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }

  var TYPE_PLURAL = {
    'Elementary': 'elementary schools',
    'Middle': 'middle schools',
    'K-8': 'K-8 schools',
    'High School': 'high schools',
    'High School Transfer': 'transfer high schools'
  };

  // One chart per report the school files. Every school of the same type is a
  // grey dot and this school is the green one. The points load only when the
  // chart nears the screen, as the map does.
  function renderImpactCharts(payload, host) {
    (payload.impact_chart || []).forEach(function (point) {
      // Its own heading, so the chart is not read as part of the row above it.
      host.appendChild(SF.el('h4', { class: 'chart-title',
        text: 'Impact and Performance across ' +
              (TYPE_PLURAL[point.school_type] || 'schools of this type') + ', ' + point.year }));
      var figure = SF.el('figure', { class: 'impact-chart' });
      host.appendChild(figure);
      whenNear(figure, function () {
        SF.load('impact.json').then(function (data) {
          var group = (data.groups || []).filter(function (g) {
            return g.report_type === point.report_type && g.school_type === point.school_type;
          })[0];
          if (!group) { figure.hidden = true; return; }
          drawImpact(figure, data, group, point);
          // Drawn in screen pixels so the labels keep their size on a phone,
          // so a change of width redraws it.
          var width = figure.clientWidth, pending = null;
          window.addEventListener('resize', function () {
            clearTimeout(pending);
            pending = setTimeout(function () {
              if (figure.clientWidth === width) return;
              width = figure.clientWidth;
              drawImpact(figure, data, group, point);
            }, 150);
          });
        }).catch(function () { figure.hidden = true; });
      });
    });
  }

  function whenNear(node, run) {
    if (!('IntersectionObserver' in window)) return run();
    var watch = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { watch.disconnect(); run(); }
    }, { rootMargin: '300px' });
    watch.observe(node);
  }

  function drawImpact(figure, data, group, point) {
    figure.innerHTML = '';
    var W = Math.max(280, Math.min(640, figure.clientWidth || 560));
    var H = Math.round(Math.max(250, Math.min(380, W * 0.66)));
    var pad = { top: 14, right: 18, bottom: 46, left: 54 };
    var all = group.performance.concat(group.impact, [point.performance, point.impact]);
    var top = Math.max(1, Math.ceil(Math.max.apply(null, all) * 4) / 4);
    var x = function (v) { return pad.left + v / top * (W - pad.left - pad.right); };
    var y = function (v) { return H - pad.bottom - v / top * (H - pad.top - pad.bottom); };
    var kind = TYPE_PLURAL[group.school_type] || (group.school_type + ' schools');
    var count = group.performance.length;
    var fmt = function (v) { return Number(v).toFixed(2); };

    var chart = svgEl('svg', {
      viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'Impact Score against Performance Score for ' + count + ' ' + kind +
        ', ' + data.year + '. This school: Performance ' + fmt(point.performance) +
        ', Impact ' + fmt(point.impact) + '.'
    });

    // Hairline grid every quarter. The City's 0.50 midpoint is a darker line.
    for (var t = 0; t <= top + 1e-9; t += 0.25) {
      var mid = Math.abs(t - data.median) < 1e-9;
      chart.appendChild(svgEl('line', { class: mid ? 'mid' : 'grid',
        x1: x(t), x2: x(t), y1: y(0), y2: y(top) }));
      chart.appendChild(svgEl('line', { class: mid ? 'mid' : 'grid',
        x1: x(0), x2: x(top), y1: y(t), y2: y(t) }));
      chart.appendChild(svgEl('text', { class: 'tick', x: x(t), y: y(0) + 16,
        'text-anchor': 'middle' }, t.toFixed(2)));
      chart.appendChild(svgEl('text', { class: 'tick', x: x(0) - 8, y: y(t) + 4,
        'text-anchor': 'end' }, t.toFixed(2)));
    }
    chart.appendChild(svgEl('text', { class: 'axis-title', x: x(top / 2), y: H - 6,
      'text-anchor': 'middle' }, 'Performance Score'));
    chart.appendChild(svgEl('text', { class: 'axis-title', 'text-anchor': 'middle',
      transform: 'translate(14 ' + y(top / 2) + ') rotate(-90)' }, 'Impact Score'));

    var dots = svgEl('g', { class: 'dots', 'aria-hidden': 'true' });
    for (var i = 0; i < count; i++) {
      dots.appendChild(svgEl('circle', { cx: x(group.performance[i]),
        cy: y(group.impact[i]), r: 2.6 }));
    }
    chart.appendChild(dots);

    var hx = x(point.performance), hy = y(point.impact);
    chart.appendChild(svgEl('circle', { class: 'here', cx: hx, cy: hy, r: 5.5 }));
    var right = hx < W - pad.right - 90;
    chart.appendChild(svgEl('text', { class: 'here-label', x: hx + (right ? 10 : -10),
      y: hy + 4, 'text-anchor': right ? 'start' : 'end' }, 'This school'));

    var ring = svgEl('circle', { class: 'hover-ring', r: 7, visibility: 'hidden' });
    chart.appendChild(ring);

    var wrap = SF.el('div', { class: 'chart-wrap' });
    var tip = SF.el('div', { class: 'chart-tip', hidden: '' });
    wrap.appendChild(chart);
    wrap.appendChild(tip);
    figure.appendChild(wrap);

    // Nearest point within about 24 screen pixels. Many schools share a pair
    // of scores to two decimals, so the tip says how many sit on that spot.
    chart.addEventListener('pointermove', function (ev) {
      var box = chart.getBoundingClientRect();
      var scale = W / box.width;
      var px = (ev.clientX - box.left) * scale, py = (ev.clientY - box.top) * scale;
      var best = null, bestD = 24 * scale;
      var consider = function (p, imp, isHere) {
        var d = Math.hypot(x(p) - px, y(imp) - py);
        if (d < bestD || (isHere && d <= bestD)) { best = { p: p, i: imp, here: isHere }; bestD = d; }
      };
      for (var k = 0; k < count; k++) consider(group.performance[k], group.impact[k], false);
      consider(point.performance, point.impact, true);
      if (!best) { tip.hidden = true; ring.setAttribute('visibility', 'hidden'); return; }
      var same = 0;
      for (var j = 0; j < count; j++) {
        if (group.performance[j] === best.p && group.impact[j] === best.i) same++;
      }
      tip.textContent = (best.here ? 'This school · ' :
                         (same > 1 ? same + ' schools · ' : '')) +
        'Performance ' + fmt(best.p) + ' · Impact ' + fmt(best.i);
      tip.hidden = false;
      tip.style.left = (x(best.p) / scale) + 'px';
      tip.style.top = (y(best.i) / scale) + 'px';
      ring.setAttribute('cx', x(best.p));
      ring.setAttribute('cy', y(best.i));
      ring.setAttribute('visibility', 'visible');
    });
    chart.addEventListener('pointerleave', function () {
      tip.hidden = true;
      ring.setAttribute('visibility', 'hidden');
    });

    figure.appendChild(SF.el('figcaption', {
      text: 'Each grey dot is one of ' + count.toLocaleString('en-US') + ' ' + kind +
        ' with both scores in ' + data.year + '. Performance compares a school’s ' +
        'results with the citywide average for its type. Impact compares them with ' +
        'how similar students do across the city. The City scales both within each ' +
        'school type and centers them on 0.50, the darker lines.'
    }));
  }

  // ---- Topic tabs ---------------------------------------------------------

  // Each tab holds one or more of the build's categories. A tab shows only
  // when this school has something in it.
  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'ratings', label: 'Ratings', cats: ['ratings'] },
    { id: 'students', label: 'Students', cats: ['demographics'] },
    { id: 'attendance', label: 'Attendance', cats: ['attendance'] },
    { id: 'surveys', label: 'Surveys', cats: ['climate'] },
    { id: 'staff', label: 'Staff', cats: ['staff'] },
    { id: 'tests', label: 'Tests', cats: ['state_tests', 'alt_assessments', 'regents', 'growth'] },
    { id: 'courses', label: 'Courses', cats: ['coursework'] },
    { id: 'graduation', label: 'Graduation', cats: ['graduation', 'college'] },
    { id: 'support', label: 'Support', cats: ['student_support', 'other'] },
    { id: 'admissions', label: 'Admissions' }
  ];

  var view = { tabs: [], current: null, panels: {}, buttons: {}, rendered: {}, home: {}, model: null };

  // A measure the City has not published for two school years folds under
  // "Older measures". The cut follows the newest quality report period.
  function prevYear(year) {
    var m = /^(\d{4})-\d{2}$/.exec(year || '');
    if (!m) return null;
    var start = parseInt(m[1], 10) - 1;
    return start + '-' + String((start + 1) % 100).padStart(2, '0');
  }

  function currentFrom() {
    var years = ['sqr', 'sqr_results'].map(function (k) { return state.periods[k]; })
      .filter(Boolean).sort();
    return prevYear(years[years.length - 1]) || '0000-00';
  }

  function lastPublished(base) {
    var anchor = base.primaries[0] || base.groups[0];
    return anchor ? anchor.metric.last_year : null;
  }

  function isOlder(base, from) {
    var last = lastPublished(base);
    return !!last && last < from;
  }

  function baseOrder(a, b) {
    // Demographics arrive already themed, so theme order leads there.
    // Everywhere else the headline measures come first, then alphabetical.
    return (a.themeRank - b.themeRank) ||
           (a.headline === b.headline ? 0 : a.headline ? -1 : 1) ||
           a.label.localeCompare(b.label);
  }

  function entriesOf(bases) {
    return [].concat.apply([], bases.map(function (b) { return b.primaries.concat(b.groups); }));
  }

  function buildModel(payload, metrics) {
    var collected = collectBases(payload, metrics);
    var labels = {};
    Object.keys(metrics).forEach(function (id) {
      labels[metrics[id].category] = metrics[id].category_label;
    });
    var byCategory = {};
    Object.keys(collected.bases).forEach(function (key) {
      var base = collected.bases[key];
      (byCategory[base.category] = byCategory[base.category] || []).push(base);
    });
    Object.keys(byCategory).forEach(function (c) { byCategory[c].sort(baseOrder); });
    return {
      collected: collected, byCategory: byCategory, labels: labels,
      from: currentFrom(), glance: glanceEntries(collected.bases)
    };
  }

  function hasContent(model, category) {
    return (model.byCategory[category] || []).length ||
           (model.collected.absent[category] || []).length ||
           (model.collected.notApplicable[category] || []).length;
  }

  function tabCount(model, tab) {
    if (tab.id === 'admissions') return (state.payload.programs || []).length;
    if (!tab.cats) return 0;
    return tab.cats.reduce(function (n, c) {
      return n + (model.byCategory[c] || []).filter(function (b) { return !isOlder(b, model.from); }).length;
    }, 0);
  }

  function renderData(payload, metrics) {
    var host = document.getElementById('school-metrics');
    host.innerHTML = '';
    var model = view.model = buildModel(payload, metrics);

    // A topic with nothing published gets no tab. It is named once instead,
    // with the measures that were expected.
    var tabs = TABS.filter(function (t) {
      if (t.id === 'overview') return model.glance.length >= 2;
      if (t.id === 'admissions') return (payload.programs || []).length > 0;
      return t.cats.some(function (c) { return (model.byCategory[c] || []).length; });
    });
    var unpublished = TABS.filter(function (t) {
      return t.cats && tabs.indexOf(t) === -1 && t.cats.some(function (c) { return hasContent(model, c); });
    });
    if (!tabs.some(function (t) { return t.cats; })) {
      host.appendChild(SF.el('div', { class: 'wrap' }, [SF.el('div', {
        class: 'note-box',
        html: '<p><strong>No published statistics for this school.</strong> ' +
              'It is in the school directory but has no quality report or ' +
              'enrollment snapshot yet. This is common for a school that has ' +
              'just opened.</p>'
      })]));
      if (!(payload.programs || []).length) return;
      tabs = TABS.filter(function (t) { return t.id === 'admissions'; });
    }

    var head = SF.el('div', { class: 'wrap data-head' });
    var titles = SF.el('div', { class: 'data-titles' });
    titles.appendChild(SF.el('h2', { class: 'data-title', id: 'data-title', text: 'Published statistics' }));
    titles.appendChild(SF.el('p', { class: 'data-intro',
      text: 'Every figure the City publishes for this school, by topic. Open a ' +
            'measure to see its history and where it falls among schools of the same type.' }));
    if (unpublished.length) titles.appendChild(unpublishedNote(model, unpublished));
    head.appendChild(titles);
    head.appendChild(finder(model, tabs));
    host.appendChild(head);

    var bar = SF.el('div', { class: 'tabbar' });
    var list = SF.el('div', { class: 'wrap tablist', role: 'tablist', 'aria-labelledby': 'data-title' });
    bar.appendChild(list);
    host.appendChild(bar);
    var panels = SF.el('div', { class: 'wrap tabpanels' });
    host.appendChild(panels);

    view.tabs = tabs; view.panels = {}; view.buttons = {}; view.rendered = {};
    tabs.forEach(function (t) {
      var button = SF.el('button', {
        type: 'button', role: 'tab', class: 'tab', id: 'tab-' + t.id,
        'aria-controls': 'panel-' + t.id, 'aria-selected': 'false', tabindex: '-1'
      });
      button.appendChild(SF.el('span', { text: t.label }));
      var count = tabCount(model, t);
      if (count) {
        var unit = t.id === 'admissions' ? (count === 1 ? ' program' : ' programs')
                                         : (count === 1 ? ' measure' : ' measures');
        button.appendChild(document.createTextNode(' '));
        button.appendChild(SF.el('span', { class: 'tab-count' }, [
          document.createTextNode(String(count)),
          SF.el('span', { class: 'sr-only', text: unit })
        ]));
      }
      button.addEventListener('click', function () { selectTab(t.id, { scroll: true }); });
      button.addEventListener('keydown', tabKeys);
      list.appendChild(button);
      view.buttons[t.id] = button;

      var panel = SF.el('div', {
        role: 'tabpanel', class: 'tabpanel', id: 'panel-' + t.id,
        'aria-labelledby': 'tab-' + t.id, tabindex: '0', hidden: ''
      });
      panels.appendChild(panel);
      view.panels[t.id] = panel;
    });

    var wanted = parseHash();
    selectTab(view.panels[wanted.tab] ? wanted.tab : tabs[0].id, { keepHash: true });
    // After the first layout, so the scroll lands where the row ends up.
    if (wanted.metric) {
      setTimeout(function () { openMeasure(wanted.metric, { scroll: true, instant: true }); }, 60);
    }

    window.addEventListener('hashchange', function () {
      var next = parseHash();
      if (next.tab && view.panels[next.tab] && next.tab !== view.current) {
        selectTab(next.tab, { keepHash: true });
      }
      if (next.metric) openMeasure(next.metric, { scroll: true });
    });
    // Print shows every tab, built in full.
    window.addEventListener('beforeprint', function () {
      view.tabs.forEach(function (t) { renderTab(t.id); });
    });
  }

  function unpublishedNote(model, topics) {
    var note = SF.el('details', { class: 'section-note data-missing' });
    note.appendChild(SF.el('summary', { text: 'Nothing published for this school on ' +
      topics.map(function (t) { return t.label.toLowerCase(); }).join(', ') }));
    var list = SF.el('ul');
    topics.forEach(function (t) {
      t.cats.forEach(function (c) {
        (model.collected.absent[c] || []).concat(model.collected.notApplicable[c] || [])
          .sort().forEach(function (name) { list.appendChild(SF.el('li', { text: name })); });
      });
    });
    note.appendChild(list);
    return note;
  }

  function stickyTop() {
    var masthead = document.querySelector('.masthead');
    return masthead && getComputedStyle(masthead).position === 'sticky' ? masthead.offsetHeight : 0;
  }

  function barHeight() {
    var bar = document.querySelector('.tabbar');
    return bar && getComputedStyle(bar).position === 'sticky' ? bar.offsetHeight : 0;
  }

  function selectTab(id, options) {
    var o = options || {};
    view.current = id;
    view.tabs.forEach(function (t) {
      var on = t.id === id;
      view.buttons[t.id].setAttribute('aria-selected', String(on));
      view.buttons[t.id].tabIndex = on ? 0 : -1;
      view.panels[t.id].hidden = !on;
    });
    renderTab(id);
    if (!o.keepHash) setHash(id);
    if (o.focus) view.buttons[id].focus();

    // Keep the chosen tab in view along a bar that scrolls sideways.
    var button = view.buttons[id], strip = button.parentNode;
    if (button.offsetLeft < strip.scrollLeft ||
        button.offsetLeft + button.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = button.offsetLeft - 24;
    }
    // Once the bar has stuck, a new tab opens at its top rather than midway.
    if (o.scroll) {
      var panel = view.panels[id];
      var offset = stickyTop() + barHeight();
      if (panel.getBoundingClientRect().top < offset) {
        window.scrollTo({ top: window.scrollY + panel.getBoundingClientRect().top - offset - 8 });
      }
    }
  }

  function tabKeys(ev) {
    var ids = view.tabs.map(function (t) { return t.id; });
    var at = ids.indexOf(view.current), next = null;
    if (ev.key === 'ArrowRight') next = ids[(at + 1) % ids.length];
    else if (ev.key === 'ArrowLeft') next = ids[(at - 1 + ids.length) % ids.length];
    else if (ev.key === 'Home') next = ids[0];
    else if (ev.key === 'End') next = ids[ids.length - 1];
    if (!next) return;
    ev.preventDefault();
    selectTab(next, { focus: true });
  }

  // The address carries the tab and an opened measure, so a link can point at
  // either: #attendance or #attendance:chronic_absent_ems_all. The old
  // #section-attendance anchors still land on the right tab.
  function parseHash() {
    var hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!hash) return {};
    var old = /^section-(.+)$/.exec(hash);
    if (old) {
      var tab = TABS.filter(function (t) { return t.cats && t.cats.indexOf(old[1]) !== -1; })[0];
      return { tab: tab ? tab.id : null };
    }
    var parts = hash.split(':');
    return { tab: parts[0], metric: parts[1] || null };
  }

  function setHash(tab, metricId) {
    var hash = '#' + tab + (metricId ? ':' + metricId : '');
    if (window.location.hash !== hash) history.replaceState(history.state, '', hash);
  }

  function renderTab(id) {
    if (view.rendered[id]) return;
    view.rendered[id] = true;
    var panel = view.panels[id];
    var tab = view.tabs.filter(function (t) { return t.id === id; })[0];
    if (id === 'overview') { renderGlanceTab(panel); return; }
    if (id === 'admissions') { renderPrograms(state.payload, panel); return; }
    tab.cats.filter(function (c) { return hasContent(view.model, c); })
      .forEach(function (c) { renderCategory(c, panel); });
  }

  function renderGlanceTab(panel) {
    var glance = view.model.glance;
    panel.appendChild(SF.el('h3', { class: 'panel-title', text: 'At a glance' }));
    var cited = sourceLine(sourceIdsOf(glance.map(function (g) { return g.entry; })));
    if (cited) panel.appendChild(cited);
    panel.appendChild(SF.el('p', { class: 'panel-note',
      text: 'The measures asked about most, each with its own school year. Every ' +
            'other measure is in the topic tabs.' }));
    var list = SF.el('ul', { class: 'mlist' });
    glance.forEach(function (g) {
      list.appendChild(measureRow(g.entry, g.base, { label: g.label, scope: g.scope, primary: g.primary }));
    });
    panel.appendChild(list);
  }

  function appendBase(base, list, older) {
    if (base.key === 'demographics:nearby') {
      list.appendChild(nearbyCard(base, SF.el('li', { class: 'mblock' })));
      return;
    }
    if (isComposition(base)) { list.appendChild(compositionBlock(base)); return; }
    if (!base.primaries.length) {
      base.groups.forEach(function (g) {
        list.appendChild(measureRow(g, base,
          { label: g.metric.label || g.metric.subgroup, scope: g.scope, older: older }));
      });
      return;
    }
    base.primaries.forEach(function (p) {
      list.appendChild(measureRow(p, base, {
        primary: true, older: older, scope: base.primaries.length > 1 ? p.scope : null
      }));
    });
  }

  function renderCategory(category, host) {
    var model = view.model;
    var bases = model.byCategory[category] || [];
    var current = bases.filter(function (b) { return !isOlder(b, model.from); });
    var older = bases.filter(function (b) { return isOlder(b, model.from); });
    var missing = model.collected.absent[category] || [];
    var notApplicable = model.collected.notApplicable[category] || [];

    var section = SF.el('section', { class: 'panel-section', 'aria-labelledby': 'h-' + category });
    section.appendChild(SF.el('h3', { class: 'panel-title', id: 'h-' + category,
      text: model.labels[category] || category }));
    var cited = sourceLine(sourceIdsOf(entriesOf(bases)));
    if (cited) section.appendChild(cited);
    if (category === 'ratings' && bases.length) section.appendChild(ratingsNote());

    if (current.length) {
      var list = SF.el('ul', { class: 'mlist' });
      current.forEach(function (b) { appendBase(b, list, false); });
      section.appendChild(list);
    }
    if (category === 'ratings') renderImpactCharts(state.payload, section);

    if (older.length) {
      var years = older.map(lastPublished).filter(Boolean).sort();
      var span = years[0] === years[years.length - 1]
        ? 'in ' + years[0] : 'between ' + years[0] + ' and ' + years[years.length - 1];
      var fold = SF.el('details', { class: 'older' });
      fold.appendChild(SF.el('summary', {
        text: older.length + (older.length === 1 ? ' older measure, last published ' : ' older measures, last published ') + span
      }));
      var oldList = SF.el('ul', { class: 'mlist' });
      older.forEach(function (b) { appendBase(b, oldList, true); });
      fold.appendChild(oldList);
      section.appendChild(fold);
    }

    if (missing.length) {
      var note = SF.el('details', { class: 'section-note' });
      note.appendChild(SF.el('summary', {
        text: missing.length + ' further ' +
              (missing.length === 1 ? 'measure applies' : 'measures apply') +
              ' to this type of school but were not published for it'
      }));
      var ul = SF.el('ul');
      missing.sort().forEach(function (name) { ul.appendChild(SF.el('li', { text: name })); });
      note.appendChild(ul);
      section.appendChild(note);
    }
    if (notApplicable.length) {
      var none = SF.el('details', { class: 'section-note' });
      none.appendChild(SF.el('summary', {
        text: notApplicable.length + ' further ' +
              (notApplicable.length === 1 ? 'measure does' : 'measures do') +
              ' not apply to charter schools'
      }));
      var items = SF.el('ul');
      notApplicable.sort().forEach(function (name) { items.appendChild(SF.el('li', { text: name })); });
      none.appendChild(items);
      section.appendChild(none);
    }
    host.appendChild(section);
  }

  // Opens a measure wherever it lives: the current tab first, then the tab it
  // belongs to. An older measure's fold opens with it.
  function openMeasure(metricId, options) {
    var o = options || {};
    var selector = '[data-metric="' + metricId.replace(/[^\w-]/g, '') + '"]';
    var item = view.panels[view.current] && view.panels[view.current].querySelector(selector);
    if (!item && view.home[metricId]) {
      selectTab(view.home[metricId], { keepHash: true });
      item = view.panels[view.current].querySelector(selector);
    }
    if (!item) return;
    var fold = item.closest('details');
    if (fold) fold.open = true;
    var button = item.querySelector('.mrow-btn');
    if (button && button.getAttribute('aria-expanded') !== 'true') button.click();
    if (o.scroll) {
      var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var top = item.getBoundingClientRect().top + window.scrollY - stickyTop() - barHeight() - 12;
      window.scrollTo({ top: top, behavior: reduce || o.instant ? 'auto' : 'smooth' });
    }
    if (o.focus && button) button.focus({ preventScroll: true });
  }

  // ---- Find a measure ------------------------------------------------------

  // Tabs hide what is not on screen from the browser's own find, so the
  // profile has its own. It searches every measure in every tab.
  function measureIndex(model, tabs) {
    var index = [];
    tabs.forEach(function (tab) {
      (tab.cats || []).forEach(function (c) {
        (model.byCategory[c] || []).forEach(function (base) {
          var add = function (label, metricId) {
            view.home[metricId] = tab.id;
            index.push({ label: label, metricId: metricId, tab: tab.id, tabLabel: tab.label,
              text: (label + ' ' + tab.label + ' ' + (model.labels[c] || '')).toLowerCase() });
          };
          if (base.key === 'demographics:nearby') {
            add('Compared with students living nearby', base.groups[0].metricId);
          } else if (isComposition(base)) {
            add(base.label, base.groups[0].metricId);
          } else if (!base.primaries.length) {
            base.groups.forEach(function (g) { add(g.metric.label || g.metric.subgroup, g.metricId); });
          } else {
            base.primaries.forEach(function (p) {
              add(base.label + (base.primaries.length > 1 && p.scope ? ', ' + p.scope : ''), p.metricId);
            });
          }
        });
      });
    });
    return index;
  }

  function finder(model, tabs) {
    var index = measureIndex(model, tabs);
    var box = SF.el('div', { class: 'mfind', role: 'search' });
    box.appendChild(SF.el('label', { class: 'sr-only', for: 'mfind-input', text: 'Find a measure' }));
    var input = SF.el('input', {
      type: 'search', id: 'mfind-input', class: 'mfind-input', autocomplete: 'off',
      placeholder: 'Find a measure', 'aria-controls': 'mfind-results', 'aria-describedby': 'mfind-status'
    });
    var results = SF.el('ul', { class: 'mfind-results', id: 'mfind-results', hidden: '' });
    var status = SF.el('p', { class: 'sr-only', id: 'mfind-status', role: 'status' });
    box.appendChild(input);
    box.appendChild(results);
    box.appendChild(status);

    function close() { results.hidden = true; }
    function update() {
      var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
      results.innerHTML = '';
      if (!words.length) { close(); status.textContent = ''; return; }
      // Matches in the measure's own name rank above matches on its tab.
      var hits = index.filter(function (r) {
        return words.every(function (w) { return r.text.indexOf(w) !== -1; });
      }).map(function (r, i) {
        var name = r.label.toLowerCase();
        var inName = words.filter(function (w) { return name.indexOf(w) !== -1; }).length;
        return { r: r, rank: -inName * 1000 + i };
      }).sort(function (a, b) { return a.rank - b.rank; })
        .map(function (x) { return x.r; });
      hits.slice(0, 8).forEach(function (hit) {
        var button = SF.el('button', { type: 'button' }, [
          SF.el('span', { class: 'r-label', text: hit.label }),
          SF.el('span', { class: 'r-tab', text: hit.tabLabel })
        ]);
        button.addEventListener('click', function () {
          input.value = '';
          close();
          status.textContent = '';
          selectTab(hit.tab, { keepHash: true });
          openMeasure(hit.metricId, { scroll: true, focus: true });
        });
        results.appendChild(SF.el('li', {}, [button]));
      });
      if (!hits.length) results.appendChild(SF.el('li', { class: 'r-none', text: 'No measure matches.' }));
      results.hidden = false;
      status.textContent = hits.length
        ? hits.length + (hits.length === 1 ? ' measure matches' : ' measures match') +
          (hits.length > 8 ? '. The first 8 are listed.' : '.')
        : 'No measure matches.';
    }
    input.addEventListener('input', update);
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { input.value = ''; update(); }
      if (ev.key === 'ArrowDown') {
        var first = results.querySelector('button');
        if (first) { ev.preventDefault(); first.focus(); }
      }
    });
    results.addEventListener('keydown', function (ev) {
      var buttons = Array.prototype.slice.call(results.querySelectorAll('button'));
      var at = buttons.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown' && at < buttons.length - 1) { ev.preventDefault(); buttons[at + 1].focus(); }
      if (ev.key === 'ArrowUp') { ev.preventDefault(); (at > 0 ? buttons[at - 1] : input).focus(); }
      if (ev.key === 'Escape') { input.value = ''; update(); input.focus(); }
    });
    document.addEventListener('click', function (ev) { if (!box.contains(ev.target)) close(); });
    return box;
  }

  // ---- Programs ----------------------------------------------------------

  function programCard(program) {
    var item = SF.el('li', { class: 'program' });
    item.appendChild(SF.el('h4', { text: program.name || program.code || 'Program' }));
    if (program.code) item.appendChild(SF.el('span', { class: 'p-code', text: program.code }));
    if (program.method) {
      item.appendChild(SF.el('span', { class: 'p-method', text: program.method }));
    }

    var numbers = [
      ['Seats', program.seats_ge, program.seats_swd],
      ['Applicants', program.applicants_ge, program.applicants_swd],
      ['Applicants per seat', program.per_seat_ge, program.per_seat_swd]
    ].filter(function (row) {
      return !SF.isBlank(row[1]) || !SF.isBlank(row[2]);
    });

    if (numbers.length) {
      var grid = SF.el('dl', { class: 'p-numbers' });
      numbers.forEach(function (row) {
        var cell = SF.el('div');
        cell.appendChild(SF.el('dt', { text: row[0] }));
        // Both audiences every time. Showing only the side that has a number
        // left a reader unable to tell a program with no set-aside seats from
        // one the directory simply did not publish.
        var parts = [
          'GE ' + (SF.isBlank(row[1]) ? 'not published' : format(row[1], row[0])),
          'SWD ' + (SF.isBlank(row[2]) ? 'not published' : format(row[2], row[0]))
        ];
        cell.appendChild(SF.el('dd', { text: parts.join(' · ') }));
        grid.appendChild(cell);
      });
      item.appendChild(grid);
    }

    if (program.eligibility) {
      item.appendChild(SF.el('p', {
        class: 'p-eligibility',
        html: '<strong>Eligibility:</strong> ' + SF.escapeHtml(program.eligibility)
      }));
    }
    if (program.priorities && program.priorities.length) {
      var list = SF.el('ol', { class: 'p-priorities' });
      program.priorities.forEach(function (p) { list.appendChild(SF.el('li', { text: p })); });
      item.appendChild(list);
    }
    return item;

    function format(value, kind) {
      return kind === 'Applicants per seat'
        ? Number(value).toFixed(2)
        : SF.fmt.count(value);
    }
  }

  function renderPrograms(payload, host) {
    var programs = payload.programs || [];
    if (!programs.length) return;

    host.appendChild(SF.el('h3', { class: 'panel-title', text: 'Programs and admissions' }));
    var cited = sourceLine(['directory_es']);
    if (cited) host.appendChild(cited);
    host.appendChild(SF.el('p', {
      class: 'panel-note',
      text: 'Admissions are set per program, not per school, so one school can ' +
            'run an open program and a screened one side by side. Seats and ' +
            'applicants describe the ' + (state.periods.directory_es || 'current') +
            ' admissions season only. A numbered list is the order applicants were ranked in.'
    }));

    var list = SF.el('ul', { class: 'program-list' });
    programs.forEach(function (p) { list.appendChild(programCard(p)); });
    host.appendChild(list);
  }

  // ---- Comparison basket ------------------------------------------------

  // The same basket as Browse's tray. Beside the add button, "Comparing 3
  // of 12" opens a list of the schools already chosen, so a reader always
  // sees what is on the list. Names come from the search index, fetched on
  // first opening to keep it off the profile's critical path.
  var basketOpen = false;
  var basketNames = null;

  function renderCompareButton(school) {
    var host = document.getElementById('compare-action');
    host.innerHTML = '';
    var basket = SF.store.get('compare', []);
    var inBasket = basket.indexOf(school.dbn) !== -1;
    var limit = SF.display.max_compare || 12;

    var message = SF.el('span', { class: 'count', role: 'status' });

    var button = SF.el('button', {
      class: 'pill pill-check', type: 'button',
      'aria-pressed': inBasket ? 'true' : 'false',
      text: inBasket ? '✓ In comparison' : 'Add to comparison'
    });
    button.addEventListener('click', function () {
      var current = SF.store.get('compare', []);
      var at = current.indexOf(school.dbn);
      if (at === -1) {
        if (current.length >= limit) {
          message.textContent = 'A comparison holds ' + limit + ' schools. Remove one first.';
          return;
        }
        current.push(school.dbn);
      } else {
        current.splice(at, 1);
      }
      SF.store.set('compare', current);
    });
    host.appendChild(button);

    if (!basket.length) basketOpen = false;
    if (basket.length) {
      var pop = SF.el('div', { class: 'basket-pop' });
      var toggle = SF.el('button', {
        type: 'button', class: 'tray-toggle', id: 'basket-toggle',
        'aria-expanded': String(basketOpen), 'aria-controls': 'basket-menu'
      }, [document.createTextNode('Comparing '),
          SF.el('b', { text: String(basket.length) }),
          document.createTextNode(' of ' + limit + ' '),
          SF.el('span', { class: 'chev', 'aria-hidden': 'true', text: '▼' })]);
      toggle.addEventListener('click', function () {
        basketOpen = !basketOpen;
        renderCompareButton(school);
        if (basketOpen) document.getElementById('basket-toggle').focus();
      });
      pop.appendChild(toggle);

      if (basketOpen) {
        var menu = SF.el('div', { class: 'basket-menu tray-list', id: 'basket-menu' });
        if (!basketNames) {
          menu.appendChild(SF.el('p', { class: 'count', text: 'Loading names…' }));
          SFSearch.data().then(function (rows) {
            basketNames = {};
            rows.forEach(function (r) { basketNames[r.dbn] = r.name; });
            renderCompareButton(school);
          });
        } else {
          // This school is marked rather than linked; the others open their
          // own profiles.
          menu.appendChild(SF.basketList(basketNames, function (dbn, label) {
            if (dbn === school.dbn) {
              return SF.el('span', { class: 'tray-name is-here' }, [
                document.createTextNode(label),
                SF.el('span', { class: 'here-tag', text: 'This school' })
              ]);
            }
            return SF.el('a', { class: 'tray-name', href: 'school.html?dbn=' + encodeURIComponent(dbn),
                                text: label });
          }));
        }
        pop.appendChild(menu);
      }
      host.appendChild(pop);

      host.appendChild(SF.el('a', { class: 'pill pill-go', href: SF.compareHref(), text: 'Compare →' }));
    }
    host.appendChild(message);
  }

  // The list closes on Escape or a click elsewhere, and follows changes made
  // in the list itself or in another tab.
  function watchBasket(school) {
    document.addEventListener('sf-store', function (ev) {
      if (ev.detail.key === 'compare') renderCompareButton(school);
    });
    document.addEventListener('mousedown', function (ev) {
      if (basketOpen && !ev.target.closest('.basket-pop')) {
        basketOpen = false;
        renderCompareButton(school);
      }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && basketOpen) {
        basketOpen = false;
        renderCompareButton(school);
        document.getElementById('basket-toggle').focus();
      }
    });
  }

  // ---- Entry point --------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    var dbn = (SF.param('dbn') || '').toUpperCase();

    if (!/^\d{2}[MXKQR]\d{3}$/.test(dbn)) {
      SF.fail(document.getElementById('school-head'),
        new Error('No school was named in the address. Search for one instead.'));
      return;
    }

    // The search index is the largest shared file, and a profile only needs it
    // if the reader actually reaches for the box at the foot of the page.
    // Mounting on first focus keeps it off the critical path.
    var profileSearch = document.getElementById('profile-search');
    var mounted = false;
    var mount = function () {
      if (mounted) return;
      mounted = true;
      var typed = (profileSearch.querySelector('input') || {}).value || '';
      var box = SFSearch.mount(profileSearch, {});
      if (box) { box.focus(); if (typed) box.setValue(typed); }
    };
    profileSearch.addEventListener('focusin', mount);
    profileSearch.addEventListener('click', mount);


    Promise.all([
      SF.load('schools/' + dbn + '.json'),
      SF.load('metrics.json'),
      SF.loadDisplay(),
      // A missing source list costs the citations, not the profile.
      SF.load('sources.json').catch(function () { return []; }),
      SF.load('status.json').catch(function () { return {}; })
    ]).then(function (loaded) {
      var payload = loaded[0], metrics = loaded[1];
      state.payload = payload; state.metrics = metrics;
      (loaded[3] || []).forEach(function (s) { state.sources[s.source_id] = s; });
      state.periods = (loaded[4] && loaded[4].periods) || {};
      renderHead(payload.school);
      renderBack();
      renderFacts(payload.school);
      renderLocator(payload.school);
      renderOverview(payload.school);
      renderCompareButton(payload.school);
      watchBasket(payload.school);

      // The peer files for this school's types, one or two small files. A
      // failure costs the peer pictures, not the profile.
      var slugs = [];
      Object.keys(payload.peer_types || {}).forEach(function (k) {
        var slug = payload.peer_types[k];
        if (slug && slugs.indexOf(slug) === -1) slugs.push(slug);
      });
      return Promise.all(slugs.map(function (slug) {
        return SF.load('peers/' + slug + '.json')
          .then(function (file) { state.peers[slug] = file; })
          .catch(function () {});
      })).then(function () {
        renderData(payload, metrics);
        document.getElementById('main').classList.remove('is-loading');
      });
    }).catch(function (err) {
      document.getElementById('main').classList.remove('is-loading');
      var head = document.getElementById('school-head');
      if (String(err.message || '').indexOf('404') !== -1) {
        head.innerHTML = '<h1>No school with that number</h1>' +
          '<p>Nothing is published under <code>' + SF.escapeHtml(dbn) +
          '</code>. Search by name below.</p>';
      } else {
        SF.fail(head, err);
      }
    });
  });
})();
