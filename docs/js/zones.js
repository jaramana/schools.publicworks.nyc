/* Schools Finder / school zones
   ------------------------------------------------------------------
   SFZones.suggest(text)        addresses from GeoSearch, the City's geocoder
   SFZones.answer(lon, lat)     the zones and district at a point
   SFZones.fromKeys(keys)       the same answer from zone numbers in a link
   SFZones.shapes(result)       an answer's zones as GeoJSON, for a map
   SFZones.districtShapes(code) a district's elementary zones, for a map
   SFZones.keyString(keys)      a spot's zones as one value, "e816m114h9"

   The typed address goes only to GeoSearch. The point it returns is tested
   against the City's zones here, in the browser. A link carries zone
   numbers, never the address.

   The zones come from data/zones/: an index with a grid that names the
   files a point needs, and one file per district (or per borough, for high
   school choice areas no district holds). An answer names schools by DBN;
   the page that shows it supplies the rows. */

(function () {
  'use strict';

  var GEOSEARCH = 'https://geosearch.planninglabs.nyc/v2/autocomplete';
  var FIND_A_SCHOOL = 'https://www.schools.nyc.gov/find-a-school';
  var LEVELS = ['es', 'ms', 'hs'];
  var LEVEL_WORD = { es: 'elementary', ms: 'middle', hs: 'high' };

  // A house number, then a street. Anything else is a school name.
  var ADDRESS = /^\d+(-\d+)?[a-z]?\s+\S/i;

  // ---- Address text -------------------------------------------------

  // GeoSearch matches "350 5 Avenue" but not "350 5th Avenue", and an
  // apartment number stops a match outright.
  function normalize(text) {
    return String(text || '')
      .replace(/(,\s*|\s+)(apt|apartment|unit|suite|ste|fl|floor|rm|room)\b\.?\s*[\w-]+\s*$/i, '')
      .replace(/\s*#\s*[\w-]+\s*$/, '')
      .replace(/\b(\d+)(st|nd|rd|th)\b/gi, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeAddress(text) { return ADDRESS.test(normalize(text)); }

  function titleCase(text) {
    return String(text).toLowerCase().replace(/(^|[\s-])([a-z])/g, function (m, a, b) {
      return a + b.toUpperCase();
    });
  }

  var pending = null;

  // Resolves with [] for text that is not yet an address, and with null when
  // a newer call took its place, so results never arrive out of order.
  function suggest(text) {
    var query = normalize(text);
    if (!ADDRESS.test(query) || query.length < 5) return Promise.resolve([]);
    if (pending) pending.abort();
    pending = typeof AbortController === 'function' ? new AbortController() : null;
    return fetch(GEOSEARCH + '?text=' + encodeURIComponent(query),
                 pending ? { signal: pending.signal } : {})
      .then(function (r) {
        if (!r.ok) throw new Error('GeoSearch answered ' + r.status);
        return r.json();
      })
      .then(function (data) {
        return (data.features || []).filter(function (f) {
          return f.geometry && f.properties && f.properties.housenumber;
        }).map(function (f) {
          var p = f.properties;
          return {
            street: titleCase(p.name),
            place: [p.neighbourhood, p.borough].filter(Boolean).join(', '),
            borough: p.borough,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1]
          };
        });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return null;
        throw err;
      });
  }

  // ---- Geometry -----------------------------------------------------

  // The even-odd rule, the same test the pipeline checks the files against.
  function inRing(x, y, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function inPolygon(x, y, poly) {
    if (!inRing(x, y, poly[0])) return false;
    for (var k = 1; k < poly.length; k++) if (inRing(x, y, poly[k])) return false;
    return true;
  }

  function contains(zone, x, y) {
    var b = zone.b;
    if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
    for (var i = 0; i < zone.g.length; i++) if (inPolygon(x, y, zone.g[i])) return true;
    return false;
  }

  function polysOf(geometry) {
    return geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  }

  function boxOf(polys) {
    var b = [180, 90, -180, -90];
    polys.forEach(function (poly) {
      poly[0].forEach(function (p) {
        if (p[0] < b[0]) b[0] = p[0];
        if (p[1] < b[1]) b[1] = p[1];
        if (p[0] > b[2]) b[2] = p[0];
        if (p[1] > b[3]) b[3] = p[1];
      });
    });
    return b;
  }

  // ---- Data ---------------------------------------------------------

  var base = null;
  var files = {};

  // The index, with the approved changes and the K-8 schools by key.
  function load() {
    if (base) return base;
    base = SF.load('zones/index.json').then(function (index) {
      var changed = {};
      index.changes.forEach(function (c) {
        c.ids.forEach(function (id) { changed[c.level + id] = c; });
      });
      var k8 = {};
      index.k8.forEach(function (d) { k8[d] = true; });
      return { index: index, changed: changed, k8: k8, byKey: {}, data: {} };
    });
    return base;
  }

  // One district's or borough's zones, each filed by level and number.
  function loadFile(s, name) {
    if (files[name]) return files[name];
    files[name] = SF.load('zones/' + s.index.current + '/' + name + '.json').then(function (data) {
      LEVELS.forEach(function (level) {
        data[level].forEach(function (z) { z.level = level; s.byKey[level + z.id] = z; });
      });
      s.data[name] = data;
      return data;
    });
    return files[name];
  }

  // The files a point needs, from the index's grid.
  function filesAt(s, x, y) {
    var grid = s.index.grid;
    var c = Math.floor((x - grid.x0) / grid.step);
    var r = Math.floor((y - grid.y0) / grid.step);
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return [];
    return grid.sets[grid.cells[r * grid.cols + c]].map(function (i) { return s.index.files[i]; });
  }

  function loadFiles(s, names) {
    return Promise.all(names.map(function (n) { return loadFile(s, n); }));
  }

  // The zones with these numbers at one level, loading the files that hold them.
  function zonesOf(s, level, ids) {
    var names = [];
    ids.forEach(function (id) {
      var name = s.index.zone_files[level][String(id)];
      if (name && names.indexOf(name) === -1) names.push(name);
    });
    return loadFiles(s, names).then(function () {
      return ids.map(function (id) { return s.byKey[level + id]; }).filter(Boolean);
    });
  }

  function zoneAt(s, level, names, x, y) {
    for (var n = 0; n < names.length; n++) {
      var list = s.data[names[n]][level];
      for (var i = 0; i < list.length; i++) if (contains(list[i], x, y)) return list[i];
    }
    return null;
  }

  // The district comes from the published district lines. A zone's own
  // district stands in where the point falls between simplified outlines.
  function districtAt(geo, x, y, es) {
    for (var i = 0; i < geo.features.length; i++) {
      var f = geo.features[i];
      var polys = polysOf(f.geometry);
      f.b = f.b || boxOf(polys);
      if (contains({ b: f.b, g: polys }, x, y)) return f.properties.district;
    }
    return es && es.dist ? es.dist : null;
  }

  // One level's answer. `state` is one of:
  //   zoned     the City's zone names one or more schools
  //   changed   a rezoning approved since the zone file moved this zone
  //   unzoned   the City says the area has no zoned school, and why
  //   none      no zone covers the point: a park, an airport, water
  function levelAnswer(s, level, zone) {
    if (!zone) return { level: level, state: 'none', dbns: [] };
    var change = s.changed[level + zone.id];
    if (change) {
      var dbns = change.kind === 'redrawn'
        ? zone.dbns.concat(change.schools.filter(function (d) { return zone.dbns.indexOf(d) === -1; }))
        : change.schools;
      return { level: level, state: 'changed', zone: zone, change: change, dbns: dbns };
    }
    if (zone.kind === 'zoned') {
      return { level: level, state: 'zoned', zone: zone, remark: zone.remark, dbns: zone.dbns };
    }
    return { level: level, state: 'unzoned', zone: zone, remark: zone.remark, dbns: [] };
  }

  function assemble(s, zones, district, point) {
    var levels = {};
    LEVELS.forEach(function (l) { levels[l] = levelAnswer(s, l, zones[l]); });

    // A K-8 school whose middle grades give priority to its elementary zone
    // belongs in the middle-school answer too.
    var es = levels.es.state === 'zoned' ? levels.es.dbns : [];
    levels.ms.k8 = es.filter(function (d) { return s.k8[d]; });

    return {
      point: point || null,
      district: district,
      year: s.index.year,
      datasets: s.index.datasets,
      approved: s.index.approved,
      keys: { es: zones.es && zones.es.id, ms: zones.ms && zones.ms.id, hs: zones.hs && zones.hs.id },
      levels: levels
    };
  }

  function answer(lon, lat) {
    return Promise.all([load(), SF.load('districts.json')]).then(function (got) {
      var s = got[0];
      var names = filesAt(s, lon, lat);
      return loadFiles(s, names).then(function () {
        var zones = {};
        LEVELS.forEach(function (l) { zones[l] = zoneAt(s, l, names, lon, lat); });
        return assemble(s, zones, districtAt(got[1], lon, lat, zones.es), { lon: lon, lat: lat });
      });
    });
  }

  // keys: { es, ms, hs, d }. Unknown numbers read as no zone.
  function fromKeys(keys) {
    return load().then(function (s) {
      return Promise.all(LEVELS.map(function (l) {
        return keys[l] != null ? zonesOf(s, l, [keys[l]]) : [];
      })).then(function (found) {
        var zones = {};
        LEVELS.forEach(function (l, i) { zones[l] = found[i][0] || null; });
        var district = /^\d{2}$/.test(keys.d || '') ? keys.d : (zones.es && zones.es.dist) || null;
        return assemble(s, zones, district, null);
      });
    });
  }

  // ---- Shapes for maps ----------------------------------------------

  function feature(zone, level) {
    return { type: 'Feature', properties: { level: level, id: zone.id },
             geometry: { type: 'MultiPolygon', coordinates: zone.g } };
  }

  // Several old zones that now make one. Their fills are marked `part`, so
  // line layers skip them, and one outline traces the edge they share with
  // the outside. An edge two of them share appears twice and is dropped.
  function merged(zones, level) {
    var seen = {};
    zones.forEach(function (z) {
      z.g.forEach(function (poly) {
        poly.forEach(function (ring) {
          for (var i = 1; i < ring.length; i++) {
            var a = ring[i - 1].join(), b = ring[i].join();
            var key = a < b ? a + '|' + b : b + '|' + a;
            seen[key] = seen[key] ? null : [ring[i - 1], ring[i]];
          }
        });
      });
    });
    var edges = Object.keys(seen).map(function (k) { return seen[k]; }).filter(Boolean);
    return zones.map(function (z) {
      var f = feature(z, level);
      f.properties.part = true;
      return f;
    }).concat({ type: 'Feature', properties: { level: level },
                geometry: { type: 'MultiLineString', coordinates: edges } });
  }

  // Only a zone that names a school is drawn. An area the City leaves
  // unzoned is not a zone. A shared zone made from several old ones draws
  // as one.
  function shapes(result) {
    return load().then(function (s) {
      return Promise.all(LEVELS.map(function (l) {
        var level = result.levels[l];
        if (!level.zone || (level.state !== 'zoned' && level.state !== 'changed')) return [];
        if (level.change && level.change.kind === 'shared') {
          return zonesOf(s, l, level.change.ids).then(function (zones) { return merged(zones, l); });
        }
        return [feature(level.zone, l)];
      })).then(function (got) {
        return { type: 'FeatureCollection', features: [].concat.apply([], got) };
      });
    });
  }

  // A district's elementary zones, the level under the district on a map.
  // Old zones an approved rezoning made into one shared zone draw as one.
  function districtShapes(code) {
    return load().then(function (s) {
      if (s.index.files.indexOf(code) === -1) return { type: 'FeatureCollection', features: [] };
      return loadFile(s, code).then(function (data) {
        var features = [];
        var shared = {};
        data.es.forEach(function (z) {
          if (z.dist !== code || z.kind !== 'zoned') return;
          var c = s.changed['es' + z.id];
          if (c && c.kind === 'shared') (shared[c.ids.join()] = shared[c.ids.join()] || []).push(z);
          else features.push(feature(z, 'es'));
        });
        Object.keys(shared).forEach(function (k) { features = features.concat(merged(shared[k], 'es')); });
        return { type: 'FeatureCollection', features: features };
      });
    });
  }

  // The bounds of a feature collection, or null when it is empty.
  function bounds(collection) {
    var b = [180, 90, -180, -90];
    collection.features.forEach(function (f) {
      if (f.geometry.type !== 'MultiPolygon') return;
      var box = boxOf(f.geometry.coordinates);
      b = [Math.min(b[0], box[0]), Math.min(b[1], box[1]), Math.max(b[2], box[2]), Math.max(b[3], box[3])];
    });
    return b[0] < b[2] ? [[b[0], b[1]], [b[2], b[3]]] : null;
  }

  // ---- Keys ---------------------------------------------------------

  // One letter per level, then the zone number. A level with no zone at the
  // spot is left out, and reads back as no zone.
  function keyString(keys) {
    return LEVELS.map(function (l) { return keys[l] != null ? l.charAt(0) + keys[l] : ''; }).join('');
  }

  function parseKey(text) {
    var keys = {};
    String(text || '').replace(/([emh])(\d+)/g, function (m, c, id) {
      keys[{ e: 'es', m: 'ms', h: 'hs' }[c]] = id;
    });
    return keys;
  }

  // ---- Names --------------------------------------------------------

  // "P.S. 321 William Penn" becomes "P.S. 321", and "P.S. X014 Senator John
  // Calandra" becomes "P.S. 14". A name without a number stays whole when it
  // is short, and falls back to the DBN when it is not.
  function shortName(row) {
    var name = String(row.name || '');
    var m = name.match(/^((?:P\.S\.|I\.S\.|M\.S\.|J\.H\.S\.|PS|IS|MS)(?:\/(?:I\.S\.|M\.S\.))?\s*)[XMKQR]?0*(\d+)[XMKQR]?\b/i);
    if (m) return m[1] + m[2];
    return name && name.length <= 26 ? name : row.dbn;
  }

  // What a spot's zone is called in a summary line. `rowOf` turns a DBN into
  // the page's row for that school.
  function label(result, rowOf) {
    var level = result.levels.es.dbns.length ? result.levels.es : result.levels.ms;
    if (!level.dbns.length) return 'No zoned school';
    var first = shortName(rowOf(level.dbns[0]));
    if (level.state === 'changed') {
      if (level.change.kind === 'shared') return 'Shared zone, ' + level.dbns.length + ' schools';
      if (level.change.kind === 'split') return 'Former ' + shortName(rowOf(level.zone.dbns[0])) + ' zone';
      return first + ' zone, redrawn';
    }
    return first + ' zone' + (level.dbns.length > 1 ? ', shared' : '');
  }

  function yearText(year) { return String(year).replace('-', '–'); }

  // ---- Pieces of the page -------------------------------------------

  // The City's remark on a zone, in its own words.
  function quote(text) {
    return SF.el('blockquote', { class: 'zone-quote' }, [SF.el('p', { text: text })]);
  }

  // How an approved rezoning changes the zone, with its plan linked.
  function changeNote(level) {
    var c = level.change;
    var year = yearText(c.year);
    var plan = SF.el('a', { href: c.doc, text: 'District ' + parseInt(c.district, 10) + ' rezoning, ' + year });
    var lead = {
      shared: 'Shared zone since ' + year + '. ',
      split: 'This zone was divided among these schools for ' + year + '. ',
      redrawn: 'Zone lines here changed for ' + year + '. '
    }[c.kind];
    var p = SF.el('p', { class: 'zone-change' }, [document.createTextNode(lead), plan, document.createTextNode('.')]);
    if (c.kind !== 'shared') {
      p.appendChild(document.createTextNode(' '));
      p.appendChild(SF.el('a', { href: FIND_A_SCHOOL, text: 'Find a School' }));
      p.appendChild(document.createTextNode(' gives the zone for this address.'));
    }
    return p;
  }

  // The zone files and the rezonings page, with Find a School to confirm.
  function sourceLine(result) {
    var line = SF.el('p', { class: 'source-line' });
    line.appendChild(SF.el('span', { class: 'source-tag', text: 'Sources' }));
    line.appendChild(document.createTextNode('School zones ' + yearText(result.year) + ', '));
    LEVELS.forEach(function (l, i) {
      if (i) line.appendChild(document.createTextNode(i === 2 ? ' and ' : ', '));
      line.appendChild(SF.el('a', { href: result.datasets[l].page, text: LEVEL_WORD[l] }));
    });
    line.appendChild(document.createTextNode(', NYC Open Data; '));
    line.appendChild(SF.el('a', { href: result.approved, text: 'approved rezonings' }));
    line.appendChild(document.createTextNode(', NYC Public Schools. Confirm on '));
    line.appendChild(SF.el('a', { href: FIND_A_SCHOOL, text: 'Find a School' }));
    line.appendChild(document.createTextNode('.'));
    return line;
  }

  window.SFZones = {
    LEVELS: LEVELS, FIND_A_SCHOOL: FIND_A_SCHOOL,
    normalize: normalize, looksLikeAddress: looksLikeAddress, suggest: suggest,
    load: load, answer: answer, fromKeys: fromKeys, contains: contains,
    shapes: shapes, districtShapes: districtShapes, bounds: bounds,
    keyString: keyString, parseKey: parseKey, shortName: shortName, label: label,
    yearText: yearText, quote: quote, changeNote: changeNote, sourceLine: sourceLine
  };
})();
