/* Schools Finder (schools.publicworks.nyc) / maps
   ------------------------------------------------------------------
   One MapLibre setup shared by Browse and the school profile. The library
   is about 800 KB, so it loads only when a map is about to be shown. A
   reader who never opens a map never downloads it.

   The basemap is OpenFreeMap's Positron, trimmed and recolored here before
   the map first draws. The city's land is a shade lighter than everything
   around it, and place names outside the city are dropped, so New Jersey
   and Long Island recede without a mask laid over the map.

   Layer order, bottom to top:
     surroundings  ·  city land  ·  water, parks, roads  ·  district fill
     and lines  ·  school points  ·  labels  ·  district numbers

   Changes ease rather than jump: points and district fills fade, the
   camera glides, and the hovered school grows in as an HTML marker,
   because MapLibre does not animate a size set by hover state. Motion
   drops to instant when the reader asks the system for reduced motion. */

(function () {
  'use strict';

  // OpenFreeMap: open vector tiles with no key and no usage cap.
  var STYLE = 'https://tiles.openfreemap.org/styles/positron';
  var FONT = ['Noto Sans Bold'];

  // The outer panning limit, padded well past the city so it never fights
  // the fitBounds on Browse.
  var BOUNDS = [[-74.6, 40.35], [-73.4, 41.1]];

  // OpenStreetMap's license asks for its credit on the map itself. The rest
  // of the credits are on the About page, one link away.
  var ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' +
    ' · <a href="about.html#map-sources">Sources</a>';

  // Green is the schools. Districts are a quiet slate violet: distinct from
  // the green, calmer than a saturated second hue, and clear of the site's
  // orange-red warning color. The basemap stays in cool greys.
  var COLORS = {
    point: '#14634a',
    halo: '#ffffff',
    district: '#6d6a8f',
    chosenFill: '#dedcec',
    number: '#55527a',
    land: '#fbfbfa',
    surroundings: '#e8eaea',
    water: '#d3dce0',
    waterText: '#687f8c',
    park: '#edf1ec',
    building: '#f0f0ed',
    buildingEdge: '#e2e3e0',
    place: '#474d52',
    neighborhood: '#626970'
  };

  // Positron layers this map has no use for: land cover, footpaths, rail,
  // airports, road shields, admin lines that compete with the district
  // lines, and state and country names.
  var DROP = /^(landcover_|landuse_|aeroway|airport|railway|boundary_|highway_path|highway-name-path|highway-shield|road_shield|label_state|label_country)/;
  var PLACES = /^label_(other|village|town|city)/;

  // At city scale the highways barely show, so the roads beyond the city do
  // not outdraw the schools. They reach full strength by street scale.
  var roadFill = ['interpolate', ['linear'], ['zoom'], 10, '#eef0f0', 12.5, '#ffffff'];
  var roadEdge = ['interpolate', ['linear'], ['zoom'], 10, '#dfe2e2', 12.5, '#d5d5d5'];

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var EASE = reduced ? 0 : 450;
  var FADE = { duration: reduced ? 0 : 250, delay: 0 };

  var library = null;

  function load() {
    if (library) return library;
    library = new Promise(function (resolve, reject) {
      if (window.maplibregl) return resolve(window.maplibregl);
      var css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/maplibre-gl.css';
      document.head.appendChild(css);
      var script = document.createElement('script');
      script.src = 'vendor/maplibre-gl.js';
      script.onload = function () { resolve(window.maplibregl); };
      script.onerror = function () { reject(new Error('The map library did not load.')); };
      document.head.appendChild(script);
    });
    return library;
  }

  function unavailable(container, why) {
    container.innerHTML = '';
    container.classList.add('map-unavailable');
    container.appendChild(SF.el('p', { text: why + ' The list and the address still work.' }));
  }

  // The city as one MultiPolygon, from the merged outline in districts.json.
  function cityShape(geo) {
    return { type: 'MultiPolygon',
             coordinates: (geo.outline || []).map(function (ring) { return [ring]; }) };
  }

  function restyle(style, geo) {
    var city = geo && geo.outline ? cityShape(geo) : null;
    var paint = {
      background: { 'background-color': city ? COLORS.surroundings : COLORS.land },
      water: { 'fill-color': COLORS.water },
      waterway: { 'line-color': COLORS.water },
      park: { 'fill-color': COLORS.park },
      building: { 'fill-color': COLORS.building, 'fill-outline-color': COLORS.buildingEdge },
      highway_motorway_inner: { 'line-color': roadFill },
      highway_motorway_bridge_inner: { 'line-color': roadFill },
      highway_major_inner: { 'line-color': roadFill },
      highway_motorway_casing: { 'line-color': roadEdge },
      highway_motorway_bridge_casing: { 'line-color': roadEdge },
      highway_major_casing: { 'line-color': roadEdge },
      water_name_point_label: { 'text-color': COLORS.waterText },
      water_name_line_label: { 'text-color': COLORS.waterText },
      waterway_line_label: { 'text-color': COLORS.waterText }
    };

    style.layers = style.layers.filter(function (l) { return !DROP.test(l.id); });
    style.layers.forEach(function (l) {
      Object.assign(l.paint = l.paint || {}, paint[l.id] || {});
      if (PLACES.test(l.id)) {
        l.paint['text-color'] = l.id === 'label_other' ? COLORS.neighborhood : COLORS.place;
        if (city) l.filter = ['all', l.filter || true, ['within', city]];
      }
    });

    if (city) {
      style.sources.city = { type: 'geojson', data: city };
      style.layers.splice(1, 0, { id: 'city', type: 'fill', source: 'city',
                                  paint: { 'fill-color': COLORS.land } });
    }
    return style;
  }

  // The finished style, built once per page. If OpenFreeMap's style cannot be
  // fetched here, MapLibre is handed its address and tries on its own.
  var styled = null;

  function basemap() {
    if (styled) return styled;
    var district = SF.load('districts.json').catch(function () { return null; });
    styled = fetch(STYLE)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (style) {
        return district.then(function (geo) { return restyle(style, geo); });
      })
      .catch(function () { return STYLE; });
    return styled;
  }

  // Resolves with a map whose style has loaded, or null when the browser
  // cannot draw one. The reason is written into the container.
  //
  // A map inside the page flow never takes the scroll wheel, so scrolling
  // always moves the page. It zooms with the buttons, a double click or a
  // pinch. Pass { scrollZoom: true } only for a map pinned to its own
  // frame, where the wheel has nothing else to do.
  //
  // `extras.note` is a few words set before the credits in the map corner.
  function create(container, options, extras) {
    return Promise.all([load(), basemap()]).then(function (got) {
      var maplibregl = got[0];
      var map;
      try {
        map = new maplibregl.Map(Object.assign({
          container: container,
          style: got[1],
          center: [-73.95, 40.70],
          zoom: 9.3,
          minZoom: 8.5,
          maxZoom: 18,
          maxBounds: BOUNDS,
          attributionControl: false,
          dragRotate: false,
          pitchWithRotate: false,
          scrollZoom: false
        }, options || {}));
      } catch (err) {
        unavailable(container, String(err).indexOf('WebGL') > -1
          ? 'This browser has WebGL turned off, so it cannot draw the map.'
          : 'This browser could not open the map.');
        return null;
      }
      map.touchZoomRotate.disableRotation();
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-left');
      var note = extras && extras.note ? SF.escapeHtml(extras.note) + ' · ' : '';
      container.appendChild(SF.el('div', { class: 'map-attrib', html: note + ATTRIBUTION }));

      // A map built while hidden and shown later must follow its container.
      if ('ResizeObserver' in window) {
        new ResizeObserver(function () { map.resize(); }).observe(container);
      }
      return new Promise(function (resolve) {
        map.on('load', function () { resolve(map); });
      });
    }).catch(function (err) {
      unavailable(container, err.message);
      return null;
    });
  }

  function firstLabelLayer(map) {
    var hit = map.getStyle().layers.filter(function (l) { return l.type === 'symbol'; })[0];
    return hit ? hit.id : undefined;
  }

  // The chosen district is picked by an opacity expression rather than a
  // filter, because a paint change can fade and a filter change cannot.
  function chosenOpacity(code, on) {
    return ['case', ['==', ['get', 'district'], code || '-'], on, 0];
  }

  // District fill, lines and numbers.
  function addDistricts(map, chosen) {
    return SF.load('districts.json').then(function (geo) {
      var below = firstLabelLayer(map);

      map.addSource('districts', { type: 'geojson', data: geo });
      map.addLayer({ id: 'district-fill', type: 'fill', source: 'districts',
        paint: { 'fill-color': COLORS.chosenFill,
                 'fill-opacity': chosenOpacity(chosen, 0.45),
                 'fill-opacity-transition': FADE } }, below);
      map.addLayer({ id: 'district-line', type: 'line', source: 'districts',
        paint: { 'line-color': COLORS.district, 'line-opacity': 0.35,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.5, 14, 3] } }, below);
      map.addLayer({ id: 'district-chosen', type: 'line', source: 'districts',
        paint: { 'line-color': COLORS.district,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.5, 14, 4],
                 'line-opacity': chosenOpacity(chosen, 0.75),
                 'line-opacity-transition': FADE } }, below);

      // Numbers crowd each other at city scale, so they appear on zooming in.
      map.addSource('district-labels', { type: 'geojson', data: {
        type: 'FeatureCollection',
        features: geo.features.map(function (f) {
          return { type: 'Feature',
                   properties: { n: String(parseInt(f.properties.district, 10)) },
                   geometry: { type: 'Point', coordinates: f.properties.label } };
        })
      } });
      map.addLayer({ id: 'district-number', type: 'symbol', source: 'district-labels',
        minzoom: 10,
        layout: { 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 14 },
        paint: { 'text-color': COLORS.number, 'text-halo-color': '#ffffff',
                 'text-halo-width': 2 } });
      return geo;
    });
  }

  function chooseDistrict(map, code) {
    if (map.getLayer('district-fill')) {
      map.setPaintProperty('district-fill', 'fill-opacity', chosenOpacity(code, 0.45));
    }
    if (map.getLayer('district-chosen')) {
      map.setPaintProperty('district-chosen', 'line-opacity', chosenOpacity(code, 0.75));
    }
  }

  // School points, under the basemap labels.
  var POINT_OPACITY = 0.8;

  function addSchools(map, data) {
    map.addSource('schools', { type: 'geojson', data: data });
    map.addLayer({
      id: 'schools', type: 'circle', source: 'schools',
      paint: {
        'circle-color': COLORS.point,
        'circle-opacity': POINT_OPACITY,
        'circle-opacity-transition': FADE,
        'circle-stroke-color': COLORS.halo,
        'circle-stroke-width': 1,
        'circle-stroke-opacity': 0.9,
        'circle-stroke-opacity-transition': FADE,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3.5, 12, 6, 15, 9]
      }
    }, firstLabelLayer(map));
  }

  // New points fade out, swap, and fade back in, rather than blinking.
  function setSchools(map, data) {
    var source = map.getSource('schools');
    if (!source) return;
    if (reduced) { source.setData(data); return; }
    map.setPaintProperty('schools', 'circle-opacity', 0);
    map.setPaintProperty('schools', 'circle-stroke-opacity', 0);
    setTimeout(function () {
      source.setData(data);
      map.setPaintProperty('schools', 'circle-opacity', POINT_OPACITY);
      map.setPaintProperty('schools', 'circle-stroke-opacity', 0.9);
    }, FADE.duration);
  }

  // The camera glides to its new view.
  function frame(map, bounds, options) {
    map.fitBounds(bounds, Object.assign({ padding: 48, maxZoom: 14, duration: EASE,
                                          essential: false }, options || {}));
  }

  // HTML markers, one of each kind per map. 'select' marks the chosen
  // school and CSS grows it in; 'hover' is a lighter ring for a preview.
  var markers = typeof WeakMap === 'function' ? new WeakMap() : null;

  function focus(map, lngLat, kind) {
    if (!markers) return;
    kind = kind || 'select';
    var own = markers.get(map) || {};
    markers.set(map, own);
    var marker = own[kind];
    if (!lngLat) {
      if (marker) marker.getElement().classList.remove('is-on');
      return;
    }
    if (!marker) {
      var dot = SF.el('div', { class: kind === 'hover' ? 'map-hover' : 'map-focus' });
      dot.setAttribute('aria-hidden', 'true');
      marker = own[kind] = new maplibregl.Marker({ element: dot }).setLngLat(lngLat).addTo(map);
    }
    var el = marker.getElement();
    el.classList.remove('is-on');
    marker.setLngLat(lngLat);
    // A reflow between the two class changes restarts the transition.
    void el.offsetWidth;
    el.classList.add('is-on');
  }

  window.SFMap = {
    create: create,
    addDistricts: addDistricts,
    addSchools: addSchools,
    setSchools: setSchools,
    chooseDistrict: chooseDistrict,
    frame: frame,
    focus: focus,
    colors: COLORS,
    touch: touch,
    reduced: reduced
  };
})();
