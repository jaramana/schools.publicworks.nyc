/* A school profile.
   ------------------------------------------------------------------
   Loads one school file and the metric manifest, then renders what the
   sources publish for that school, grouped by category and by measure.

   Four rules decide what appears:
     a value is shown with the year it describes, never on its own;
     a value on a scale is shown with the maximum of that scale beside it;
     an absence says which kind of absence it is;
     a measure that does not apply to this type of school is not listed as
     missing, because it was never expected.

   Where New York City publishes its own 1 to 5 score against a comparison
   group, the value carries a colored band. The score is theirs. The banding is
   ours, and both the number and a written label sit next to the color. */

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

  var state = { payload: null, metrics: null };

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

  // One reading of a series: the newest year that carries a value, with
  // everything published alongside it.
  function reading(series) {
    if (!series) return null;
    var i = latestIndex(series);
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
    var keys = ['v', 'st', 'n', 'c', 's', 'b', 'bd'];
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
      return { scope: REPORT_LABEL[key] || key, series: groups[key] };
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

    document.title = (school.name || school.dbn) + ' — schoolsfinder.nyc';

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

  function renderFacts(school) {
    var host = document.getElementById('school-facts');
    host.innerHTML = '';

    if (!SF.isBlank(school.enrollment)) {
      host.appendChild(fact('Students', SF.fmt.count(school.enrollment),
        { big: true, note: school.enrollment_year || null }));
    }
    if (school.grades) host.appendChild(fact('Grades served', school.grades));
    if (school.address) {
      // An external map link rather than an embedded map: this version of the
      // site does not load a mapping library.
      host.appendChild(fact('Address', school.address, {
        href: 'https://www.openstreetmap.org/search?query=' +
              encodeURIComponent(school.address),
        external: true,
        note: school.latitude
          ? (school.coordinate_source === 'source'
              ? 'Coordinates published by the source'
              : 'Coordinates matched from this address')
          : null
      }));
    }
    if (school.phone) host.appendChild(fact('Telephone', school.phone, { href: 'tel:' + school.phone }));
    if (school.website) {
      var url = /^https?:/i.test(school.website) ? school.website : 'https://' + school.website;
      host.appendChild(fact('School website', school.website, { href: url, external: true }));
    }
    if (school.start_time || school.end_time) {
      host.appendChild(fact('School day',
        [school.start_time, school.end_time].filter(Boolean).join(' to ')));
    }
    if (school.accessibility) host.appendChild(fact('Building access', school.accessibility));
    if (school.languages) host.appendChild(fact('Languages taught', school.languages));
    if (school.neighborhood) host.appendChild(fact('Neighborhood', school.neighborhood));
    // The directories write this as 1 or 0, which means nothing on a page.
    if (school.shared_building === '1' || school.shared_building === 1) {
      host.appendChild(fact('Building', 'Shared with at least one other school'));
    } else if (school.shared_building === '0' || school.shared_building === 0) {
      host.appendChild(fact('Building', 'Not shared with another school'));
    }
    if (school.directory_url) {
      host.appendChild(fact('Directory listing', 'Open in MySchools',
        { href: school.directory_url, external: true }));
    }

    if (!host.children.length) {
      host.appendChild(SF.el('div', {
        class: 'fact',
        html: '<dt>Contact details</dt><dd>Not published for this school. ' +
              'Only schools in a current admissions directory have them.</dd>'
      }));
    }
  }

  function renderOverview(school) {
    var host = document.getElementById('school-overview');
    host.innerHTML = '';
    if (!school.overview) { host.hidden = true; return; }
    host.hidden = false;
    host.appendChild(SF.el('h2', { class: 'section-label', text: 'In the school’s own words' }));
    host.appendChild(SF.el('p', { class: 'prose', text: school.overview }));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'Written by the school for the admissions directory. It is a ' +
            'description, not a measured value.'
    }));
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
    wrapper.appendChild(SF.el('span', { class: 'm-value', text: shown }));
    var scale = SF.scaleOf(metric.format);
    if (scale) {
      wrapper.appendChild(SF.el('span', { class: 'm-scale', text: scale }));
      // Read aloud as "out of", since a slash is spoken as "slash".
      wrapper.setAttribute('aria-label', SF.scaleSpoken(shown, metric.format));
    }
    var band = SF.bandElement(read.band, read.score);
    if (band) wrapper.appendChild(band);
    return wrapper;
  }

  function metaNode(read) {
    var meta = SF.el('span', { class: 'm-meta' });
    if (read.absent && read.bound) {
      meta.appendChild(SF.el('span', { text: read.year }));
      meta.appendChild(SF.el('span', { class: 'sep', text: '·' }));
      meta.appendChild(SF.el('span', { text: SF.ABSENCE_DETAIL.censored }));
      return meta;
    }
    if (read.absent) {
      meta.appendChild(SF.el('span', {
        text: SF.ABSENCE_DETAIL[read.status] || SF.ABSENCE_DETAIL.missing
      }));
      return meta;
    }
    var bits = [read.year];
    if (!SF.isBlank(read.n)) bits.push(SF.fmt.count(read.n) + ' students');
    bits.forEach(function (b, i) {
      if (i) meta.appendChild(SF.el('span', { class: 'sep', text: '·' }));
      meta.appendChild(SF.el('span', { text: b }));
    });
    return meta;
  }

  // The comparison group average, written out. A second bare number tells a
  // reader nothing; the distance from it, in the measure's own unit, does.
  // This lives inside the detail panel: beside the value it interrupted the
  // scan down a column of measures.
  function compareSentence(read, metric) {
    if (read.absent || SF.isBlank(read.comparison)) return null;
    var difference = read.value - read.comparison;
    var better = metric.lower_is_better ? difference < 0 : difference > 0;
    var size = Math.abs(difference);

    var unit, amount;
    if (metric.format === 'pct_unit') {
      amount = (size * 100).toFixed(1);
      unit = amount === '1.0' ? ' point' : ' points';
    } else {
      amount = size.toFixed(2);
      unit = '';
    }

    var node = SF.el('p', { class: 'm-compare' });
    if (size < 0.0005) {
      node.appendChild(document.createTextNode('Level with the '));
    } else {
      node.appendChild(SF.el('b', {
        class: better ? 'up' : 'down',
        text: amount + unit + (difference > 0 ? ' above' : ' below')
      }));
      node.appendChild(document.createTextNode(' the '));
    }
    node.appendChild(SF.el('b', { text: SF.formatValue(read.comparison, metric.format) }));
    node.appendChild(document.createTextNode(
      ' average of its comparison group, the schools New York City judges this ' +
      'one against.'));
    return node;
  }

  // The panel under a measure is built the first time it is opened, not on
  // load. A large profile has around two hundred of these and a thousand year
  // chips between them, and building all of that up front was most of the time
  // between asking for a school and seeing one.
  function details(metricId, metric, series, read) {
    var wrapper = SF.el('details');
    var summary = SF.el('summary', { text: 'Definition, source and year by year' });
    wrapper.appendChild(summary);

    var built = false;
    var build = function () {
      if (built) return;
      built = true;
      wrapper.appendChild(detailBody(metricId, metric, series, read));
    };

    // Two triggers on purpose. `toggle` is the correct event and covers opening
    // by keyboard or by script; the click on the summary covers it where
    // `toggle` does not fire, which some engines still get wrong. Building
    // twice is prevented by the flag, and an empty panel would be a silent
    // failure with nothing on screen to explain it.
    wrapper.addEventListener('toggle', function () { if (wrapper.open) build(); });
    summary.addEventListener('click', build);
    summary.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') build();
    });
    return wrapper;
  }

  function detailBody(metricId, metric, series, read) {
    var body = SF.el('div', { class: 'm-detail' });

    // The comparison lives here rather than beside the value. Next to the
    // number it broke the scan down a column of measures; here it is a
    // sentence someone has chosen to read.
    var comparison = compareSentence(read, metric);
    if (comparison) body.appendChild(comparison);

    body.appendChild(SF.el('p', { text: metric.description || describe(metric) }));
    body.appendChild(SF.el('p', {
      html: 'Unit: ' + SF.escapeHtml(metric.unit) +
            (metric.format_source === 'inferred'
              ? ' <span class="muted">(inferred from the published values, not stated by the source)</span>'
              : '') +
            '. Identifier: <code>' + SF.escapeHtml(metricId) + '</code>. ' +
            'Source: ' + SF.escapeHtml(metric.source_id) + '.'
    }));
    if (metric.comparability_note) {
      body.appendChild(SF.el('p', {
        html: '<strong>Comparability:</strong> ' + SF.escapeHtml(metric.comparability_note)
      }));
    }

    if (series && series.y.length) {
      var strip = SF.el('div', { class: 'history' });
      series.y.forEach(function (year, i) {
        var chip = SF.el('span', { class: 'h-year' });
        chip.appendChild(document.createTextNode(year + ' '));
        chip.appendChild(SF.el('b', {
          text: SF.isBlank(series.v[i])
            ? (SF.ABSENCE[series.st ? series.st[i] : 'missing'] || SF.ABSENCE.missing)
            : SF.formatValue(series.v[i], metric.format)
        }));
        strip.appendChild(chip);
      });
      body.appendChild(strip);
    }

    return body;
  }

  // ---- Groups under a measure ------------------------------------------

  function groupRow(member, options) {
    var o = options || {};
    var read = member.read;
    var row = SF.el('li', { class: 'group-row' });
    row.appendChild(SF.el('span', { class: 'g-name', text: member.metric.subgroup }));

    if (read.absent) {
      row.appendChild(SF.el('span', {
        class: read.bound ? 'g-value' : 'g-value absent',
        text: read.bound || SF.ABSENCE[read.status] || SF.ABSENCE.missing
      }));
      if (read.bound && !o.sharedYear) {
        row.appendChild(SF.el('span', { class: 'g-meta', text: read.year }));
      }
      return row;
    }

    row.appendChild(SF.el('span', {
      class: 'g-value', text: SF.formatValue(read.value, member.metric.format)
    }));
    var band = SF.bandElement(read.band, read.score, { scoreOnly: true });
    if (band) row.appendChild(band);

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
    if (meta.length) row.appendChild(SF.el('span', { class: 'g-meta', text: meta.join(' · ') }));
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
    if (sharedYear) {
      body.appendChild(SF.el('p', { class: 'm-meta', text: 'All from ' + sharedYear }));
    }
    return body;
  }

  // ---- A measure card ---------------------------------------------------

  function measureCard(base) {
    var item = SF.el('li', { class: 'measure' });

    if (!base.primaries.length) {
      // No all-students figure of its own: the card is a themed list, which is
      // how the demographic figures arrive.
      item.appendChild(SF.el('p', { class: 'm-label', text: base.label }));
      item.appendChild(groupsNode(base.groups, { hideThemeLabel: true }));
      return item;
    }

    base.primaries.forEach(function (primary) {
      var head = SF.el('div', { class: 'm-head' });
      // The scope is only worth saying when the same measure is reported twice,
      // which happens at a school with both middle and high school grades.
      var label = base.label;
      if (base.primaries.length > 1 && primary.scope) label += ', ' + primary.scope;
      head.appendChild(SF.el('span', { class: 'm-label', text: label }));
      head.appendChild(valueNode(primary.read, primary.metric));
      item.appendChild(head);
      item.appendChild(metaNode(primary.read));
      item.appendChild(details(primary.metricId, primary.metric,
                               primary.series, primary.read));
    });

    if (base.groups.length) {
      var groups = SF.el('details', { class: 'm-groups' });
      groups.appendChild(SF.el('summary', {
        text: 'By student group (' + base.groups.length + ')'
      }));
      groups.appendChild(groupsNode(base.groups));
      item.appendChild(groups);
    }
    return item;
  }

  // ---- Assembling the sections ------------------------------------------

  function appliesToSchool(metric, school) {
    var mine = (school.report_types || school.report_type || '').split('|');
    if (!mine.length || !mine[0]) return true;
    return (metric.applies_to || []).some(function (r) { return mine.indexOf(r) !== -1; });
  }

  function collectBases(payload, metrics) {
    var series = payload.series || {};
    var bases = {};
    var absent = {};

    Object.keys(metrics).forEach(function (metricId) {
      var metric = metrics[metricId];
      var parts = splitByReport(series[metricId]);
      var withValues = parts
        .map(function (p) { return { scope: p.scope, series: p.series, read: reading(p.series) }; })
        .filter(function (p) { return !p.read.absent || p.read.stated; });

      if (!withValues.length) {
        if (appliesToSchool(metric, payload.school)) {
          (absent[metric.category] = absent[metric.category] || [])
            .push(metric.label || metricId);
        }
        return;
      }

      var key = metric.base_id || (metric.category + ':' + metricId);
      var base = bases[key] || (bases[key] = {
        key: key,
        label: metric.base_label || metric.label,
        category: metric.category,
        categoryLabel: metric.category_label,
        themeRank: metric.theme_rank,
        headline: false,
        primaries: [],
        groups: []
      });
      if (metric.headline) base.headline = true;
      base.themeRank = Math.min(base.themeRank, metric.theme_rank);

      withValues.forEach(function (p) {
        var entry = {
          metricId: metricId, metric: metric,
          series: p.series, read: p.read, scope: p.scope
        };
        if (metric.subgroup) base.groups.push(entry);
        else base.primaries.push(entry);
      });
    });

    return { bases: bases, absent: absent };
  }

  // The measures worth showing before anything else. A profile can run to a
  // hundred and eighty cards, and opening at full length with no way in was the
  // single biggest complaint in the design review. This summarizes nothing and
  // scores nothing: it is the same cards, shown first.
  function renderGlance(bases, host) {
    var headline = [];
    Object.keys(bases).forEach(function (key) {
      var base = bases[key];
      if (base.headline && base.primaries.length) headline.push(base);
    });
    if (headline.length < 2) return null;

    headline.sort(function (a, b) {
      return (a.themeRank - b.themeRank) || a.label.localeCompare(b.label);
    });

    var section = SF.el('section');
    section.appendChild(SF.el('h2', { class: 'section-label', text: 'At a glance' }));
    section.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'The measures most often asked about, pulled out of the sections ' +
            'below. Nothing here is added up, and the full detail is unchanged ' +
            'further down the page.'
    }));

    var list = SF.el('ul', { class: 'glance-grid' });
    headline.slice(0, 8).forEach(function (base) {
      var primary = base.primaries[0];
      var card = SF.el('li', { class: 'glance' });
      card.appendChild(SF.el('span', { class: 'g-label', text: base.label }));
      card.appendChild(valueNode(primary.read, primary.metric));
      var meta = [primary.read.year];
      if (!SF.isBlank(primary.read.n) && primary.metric.source_id !== 'demographics') {
        meta.push(SF.fmt.count(primary.read.n) + ' students');
      }
      card.appendChild(SF.el('span', { class: 'g-year', text: meta.join(' · ') }));
      list.appendChild(card);
    });
    section.appendChild(list);
    host.appendChild(section);
    return true;
  }

  // Said once per profile, beside the first band, rather than only on the
  // method page. Three of the four reviewers asked what the comparison group
  // was and none of them found out without leaving the page.
  function bandExplainer() {
    return SF.el('p', {
      class: 'section-note',
      html: 'A colored band carries the score New York City gives that measure, ' +
            'out of 5, against a comparison group of schools the City considers ' +
            'similar to this one. The City chooses the group and publishes the ' +
            'score; this site groups the score into four bands and shows the ' +
            'number inside each one. <a href="method.html#bands">How to read a ' +
            'band</a>.'
    });
  }

  function renderMetrics(payload, metrics) {
    var host = document.getElementById('school-metrics');
    host.innerHTML = '';

    var collected = collectBases(payload, metrics);
    var byCategory = {};
    Object.keys(collected.bases).forEach(function (key) {
      var base = collected.bases[key];
      (byCategory[base.category] = byCategory[base.category] || []).push(base);
    });

    var order = SF.display.category_order && SF.display.category_order.length
      ? SF.display.category_order
      : Object.keys(byCategory);

    var glanced = renderGlance(collected.bases, host);

    // A jump list, so a long profile can be navigated rather than scrolled.
    var present = order.filter(function (c) {
      return (byCategory[c] || []).length || (collected.absent[c] || []).length;
    });
    if (present.length > 2) {
      var nav = SF.el('nav', { class: 'section-jump', 'aria-label': 'Sections of this profile' });
      present.forEach(function (category) {
        var label = (byCategory[category] || []).length
          ? byCategory[category][0].categoryLabel : category;
        nav.appendChild(SF.el('a', { href: '#section-' + category, text: label }));
      });
      host.appendChild(nav);
    }

    var explained = false;
    var drew = false;
    order.forEach(function (category) {
      var bases = byCategory[category] || [];
      var missing = collected.absent[category] || [];
      if (!bases.length && !missing.length) return;
      drew = true;

      var label = bases.length ? bases[0].categoryLabel : category;
      host.appendChild(SF.el('h2', {
        class: 'section-label', id: 'section-' + category, text: label
      }));

      // Explain the bands once, at the first section that has one, rather than
      // repeating it or leaving it only on the method page.
      if (!explained && bases.some(function (b) {
        return b.primaries.some(function (p) { return p.read.band; }) ||
               b.groups.some(function (g) { return g.read.band; });
      })) {
        explained = true;
        host.appendChild(bandExplainer());
      }

      if (bases.length) {
        bases.sort(function (a, b) {
          // Demographics arrive already themed, so theme order leads there.
          // Everywhere else the headline measures come first, then alphabetical.
          return (a.themeRank - b.themeRank) ||
                 (a.headline === b.headline ? 0 : a.headline ? -1 : 1) ||
                 a.label.localeCompare(b.label);
        });
        var list = SF.el('ul', { class: 'measure-list' });
        bases.forEach(function (base) { list.appendChild(measureCard(base)); });
        host.appendChild(list);
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
        host.appendChild(note);
      }
    });

    if (!drew) {
      host.appendChild(SF.el('div', {
        class: 'note-box',
        html: '<p><strong>No published statistics for this school.</strong> ' +
              'It is in the school directory but has no quality report or ' +
              'enrollment snapshot yet. This is common for a school that has ' +
              'just opened.</p>'
      }));
    }
  }

  // ---- Programs ----------------------------------------------------------

  function programCard(program) {
    var item = SF.el('li', { class: 'program' });
    item.appendChild(SF.el('h3', { text: program.name || program.code || 'Program' }));
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
        var parts = [];
        if (!SF.isBlank(row[1])) {
          parts.push(format(row[1], row[0]) + ' general education');
        }
        if (!SF.isBlank(row[2])) {
          parts.push(format(row[2], row[0]) + ' students with disabilities');
        }
        cell.appendChild(SF.el('dd', { text: parts.join(', ') }));
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

  function renderPrograms(payload) {
    var host = document.getElementById('school-programs');
    host.innerHTML = '';
    var programs = payload.programs || [];
    if (!programs.length) { host.hidden = true; return; }
    host.hidden = false;

    host.appendChild(SF.el('h2', { class: 'section-label', text: 'Programs and admissions' }));
    host.appendChild(SF.el('p', {
      class: 'section-note',
      text: 'Admissions are set per program, not per school, so one school can ' +
            'run an open program and a screened one side by side. Seats and ' +
            'applicants are from the Fall 2025 directory and describe that ' +
            'season only. A numbered list is the order applicants were ranked in.'
    }));

    var list = SF.el('ul', { class: 'program-list' });
    programs.forEach(function (p) { list.appendChild(programCard(p)); });
    host.appendChild(list);
  }

  // ---- Comparison basket ------------------------------------------------

  function renderCompareButton(school) {
    var host = document.getElementById('compare-action');
    host.innerHTML = '';
    var basket = SF.store.get('compare', []);
    var inBasket = basket.indexOf(school.dbn) !== -1;
    var limit = SF.display.max_compare || 12;

    var message = SF.el('span', { class: 'count', role: 'status' });

    var button = SF.el('button', {
      class: 'pill', type: 'button',
      'aria-pressed': inBasket ? 'true' : 'false',
      text: inBasket ? 'In your comparison' : 'Add to comparison'
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
      renderCompareButton(school);
    });
    host.appendChild(button);

    if (basket.length) {
      host.appendChild(SF.el('a', {
        class: 'pill',
        href: 'compare.html?schools=' + basket.join(','),
        text: 'Compare ' + basket.length + (basket.length === 1 ? ' school' : ' schools')
      }));
    }
    host.appendChild(message);
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
      SF.loadDisplay()
    ]).then(function (loaded) {
      var payload = loaded[0], metrics = loaded[1];
      state.payload = payload; state.metrics = metrics;
      renderHead(payload.school);
      renderFacts(payload.school);
      renderOverview(payload.school);
      renderCompareButton(payload.school);
      renderPrograms(payload);
      renderMetrics(payload, metrics);
    }).catch(function (err) {
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
