/* Schools Finder (schools.publicworks.nyc) / maps
   ------------------------------------------------------------------
   One MapLibre setup shared by Browse and the school profile. The library
   is about 800 KB, so it loads only when a map is about to be shown. A
   reader who never opens a map never downloads it.

   Layer order, bottom to top:
     basemap  ·  district fill and lines  ·  school points
     ·  basemap labels  ·  the fade outside the city  ·  district numbers
   Labels sit above the data so street and place names stay readable, and
   the fade sits above the labels so New Jersey and Long Island recede.

   Changes ease rather than jump: points and district fills fade, the
   camera glides, and the hovered school grows in as an HTML marker,
   because MapLibre does not animate a size set by hover state. Motion
   drops to instant when the reader asks the system for reduced motion. */

(function () {
  'use strict';

  // OpenFreeMap's Positron: an open vector basemap with no key and no usage cap.
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
  // orange-red warning color.
  var COLORS = {
    point: '#14634a',
    halo: '#ffffff',
    district: '#6d6a8f',
    chosenFill: '#dedcec',
    number: '#55527a',
    paper: '#f7f8f8'
  };

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

  // Resolves with a map whose style has loaded, or null when the browser
  // cannot draw one. The reason is written into the container.
  //
  // A map inside the page flow never takes the scroll wheel, so scrolling
  // always moves the page. It zooms with the buttons, a double click or a
  // pinch. Pass { scrollZoom: true } only for a map pinned to its own
  // frame, where the wheel has nothing else to do.
  function create(container, options) {
    return load().then(function (maplibregl) {
      var map;
      try {
        map = new maplibregl.Map(Object.assign({
          container: container,
          style: STYLE,
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
      container.appendChild(SF.el('div', { class: 'map-attrib', html: ATTRIBUTION }));

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

  // Districts, the fade outside the city, and district numbers.
  function addDistricts(map, chosen) {
    return SF.load('districts.json').then(function (geo) {
      var below = firstLabelLayer(map);

      map.addSource('districts', { type: 'geojson', data: geo });
      map.addLayer({ id: 'district-fill', type: 'fill', source: 'districts',
        paint: { 'fill-color': COLORS.chosenFill,
                 'fill-opacity': chosenOpacity(chosen, 0.45),
                 'fill-opacity-transition': FADE } }, below);
      map.addLayer({ id: 'district-line', type: 'line', source: 'districts',
        paint: { 'line-color': COLORS.district, 'line-opacity': 0.55,
                 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 2] } }, below);
      map.addLayer({ id: 'district-chosen', type: 'line', source: 'districts',
        paint: { 'line-color': COLORS.district, 'line-width': 2.5,
                 'line-opacity': chosenOpacity(chosen, 1),
                 'line-opacity-transition': FADE } }, below);

      // The city outline is a hole in one world-sized polygon, so the city
      // stays at full strength and everything else fades. The outline is
      // merged in advance: districts as separate holes share edges, and
      // shared-edge holes leave slivers of fade across the city.
      var world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
      map.addSource('outside', { type: 'geojson',
        data: { type: 'Polygon', coordinates: [world].concat(geo.outline || []) } });
      map.addLayer({ id: 'outside', type: 'fill', source: 'outside',
        paint: { 'fill-color': COLORS.paper, 'fill-opacity': 0.78 } });

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
      map.setPaintProperty('district-chosen', 'line-opacity', chosenOpacity(code, 1));
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

  // One marker per map marks the school in focus. CSS grows it in.
  var markers = typeof WeakMap === 'function' ? new WeakMap() : null;

  function focus(map, lngLat) {
    if (!markers) return;
    var marker = markers.get(map);
    if (!lngLat) {
      if (marker) marker.getElement().classList.remove('is-on');
      return;
    }
    if (!marker) {
      var dot = SF.el('div', { class: 'map-focus' });
      dot.setAttribute('aria-hidden', 'true');
      marker = new maplibregl.Marker({ element: dot }).setLngLat(lngLat).addTo(map);
      markers.set(map, marker);
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
