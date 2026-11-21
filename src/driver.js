const STATUS_LABELS = {
  pending: 'Pendiente de aceptación',
  accepted: 'Aceptado',
  in_progress: 'En curso'
};
const TRIP_ACTIONS = {
  pending: { status: 'accepted', label: 'Aceptar viaje' },
  accepted: { status: 'in_progress', label: 'Iniciar viaje' },
  in_progress: { status: 'completed', label: 'Finalizar viaje' }
};

export function createDriverPanel({ supabase, getUser, getProfile, mapboxToken }) {
  const onlineControl = document.querySelector('#driver-online');
  const serviceState = document.querySelector('#driver-service-state');
  const finishField = document.querySelector('#driver-finish-field');
  const destinationInput = document.querySelector('#driver-destination');
  const suggestions = document.querySelector('#driver-destination-suggestions');
  const locationStatus = document.querySelector('#driver-location-status');
  const mapElement = document.querySelector('#driver-map-canvas');
  const mapStatus = document.querySelector('#driver-map-status');
  const availableTripsPanel = document.querySelector('#available-trips');
  const availableTripsList = document.querySelector('#available-trip-list');
  const tripsPanel = document.querySelector('#assigned-trips');
  const tripsList = document.querySelector('#assigned-trip-list');
  const navigationPreference = document.querySelector('#driver-navigation-preference');
  const paymentForm = document.querySelector('#driver-payment-form');
  const paymentBank = document.querySelector('#driver-payment-bank');
  const paymentPhone = document.querySelector('#driver-payment-phone');
  const paymentIdentity = document.querySelector('#driver-payment-identity');
  const paymentSave = document.querySelector('#driver-payment-save');
  const paymentStatus = document.querySelector('#driver-payment-status');

  let watchId = null;
  let heartbeat = null;
  let tripsTimer = null;
  let heatmapTimer = null;
  let destinationTimer = null;
  let destinationController = null;
  let destinationRequestId = 0;
  let mapInitializationPromise = null;
  let mapboxgl = null;
  let map = null;
  let mapMarkers = [];
  let activeTrip = null;
  let heatmapRequestId = 0;
  let lastHeatmapRefreshAt = 0;
  let routeRequestId = 0;
  let routeController = null;
  let lastRouteUpdateAt = 0;
  let currentPosition = null;
  let finishLocation = null;
  let lastPresenceWriteAt = 0;
  let lastRoutePosition = null;

  function setMapStatus(message, isError = false) {
    mapStatus.textContent = message;
    mapStatus.classList.toggle('error', isError);
  }

  function report(message, isError = false) {
    locationStatus.textContent = message;
    locationStatus.classList.toggle('error', isError);
  }

  function featureCollection(features = []) {
    return { type: 'FeatureCollection', features };
  }

  function initializeMap() {
    if (map || mapInitializationPromise || !mapElement) return mapInitializationPromise;
    if (!mapboxToken) {
      setMapStatus('Configura un token público de Mapbox para habilitar el mapa del conductor.', true);
      return Promise.resolve();
    }

    mapInitializationPromise = (async () => {
      try {
        const [mapboxModule] = await Promise.all([
          import('mapbox-gl'),
          import('mapbox-gl/dist/mapbox-gl.css')
        ]);
        if (getProfile()?.role !== 'driver') return;
        mapboxgl = mapboxModule.default;
        mapboxgl.accessToken = mapboxToken;
        map = new mapboxgl.Map({
          container: mapElement,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [-66.9036, 10.4806],
          zoom: 12,
          attributionControl: true
        });
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        map.on('load', () => {
          map.addSource('driver-heatmap', { type: 'geojson', data: featureCollection() });
          map.addLayer({
            id: 'driver-heatmap-layer',
            type: 'heatmap',
            source: 'driver-heatmap',
            maxzoom: 16,
            paint: {
              'heatmap-weight': ['get', 'weight'],
              'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 3],
              'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 24, 16, 40],
              'heatmap-color': [
                'interpolate', ['linear'], ['heatmap-density'],
                0, 'rgba(250, 204, 21, 0)',
                0.2, '#facc15',
                0.55, '#f97316',
                1, '#dc2626'
              ],
              'heatmap-opacity': 0.82
            }
          });
          map.addSource('driver-trip-route', { type: 'geojson', data: featureCollection() });
          map.addLayer({
            id: 'driver-trip-route-line',
            type: 'line',
            source: 'driver-trip-route',
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': '#18795b', 'line-width': 5, 'line-opacity': 0.9 }
          });
          map.resize();
          setMapStatus('Mapa listo. La zona de calor se actualiza mientras estás conectado.');
          renderDriverMap();
          void refreshHeatmap();
          if (activeTrip) void updateActiveTripRoute();
        });
        map.on('error', (event) => {
          if (!event.error) return;
          const status = event.error.status || event.error.statusCode;
          if (status === 401 || /401|unauthorized|access token/i.test(event.error.message || '')) {
            setMapStatus('Mapbox rechazó el token (401). Genera un token público vigente y limita su dominio a anthonyvzla.github.io.', true);
          } else {
            setMapStatus(`No se pudo cargar el mapa: ${event.error.message}`, true);
          }
        });
      } catch (error) {
        setMapStatus(`No se pudo inicializar Mapbox: ${error.message}`, true);
      } finally {
        mapInitializationPromise = null;
      }
    })();
    return mapInitializationPromise;
  }

  function renderDriverMap() {
    if (!mapboxgl || !map || !map.isStyleLoaded()) return;
    for (const marker of mapMarkers) marker.remove();
    mapMarkers = [];

    if (currentPosition && onlineControl.checked) {
      const locationMarker = document.createElement('div');
      locationMarker.className = 'driver-map-marker driver-location-marker';
      locationMarker.textContent = 'Tú';
      mapMarkers.push(new mapboxgl.Marker({ element: locationMarker })
        .setLngLat([currentPosition.longitude, currentPosition.latitude])
        .addTo(map));
    }

    if (activeTrip) {
      const destination = activeTrip.status === 'accepted'
        ? [Number(activeTrip.pickup_longitude), Number(activeTrip.pickup_latitude)]
        : [Number(activeTrip.destination_longitude), Number(activeTrip.destination_latitude)];
      if (destination.every(Number.isFinite)) {
        mapMarkers.push(new mapboxgl.Marker({ color: '#e4963b' })
          .setLngLat(destination)
          .setPopup(new mapboxgl.Popup().setText(activeTrip.status === 'accepted'
            ? 'Punto de recogida'
            : 'Destino del viaje'))
          .addTo(map));
      }
    }
  }

  async function refreshHeatmap() {
    if (getProfile()?.role !== 'driver' || !map || !map.isStyleLoaded()) return;
    const requestId = ++heatmapRequestId;
    const source = map.getSource('driver-heatmap');
    if (!source) return;
    if (!onlineControl.checked || !currentPosition) {
      source.setData(featureCollection());
      setMapStatus('Conéctate y comparte tu ubicación para ver la demanda en un radio de 2 km.');
      return;
    }

    try {
      const { data, error } = await supabase.rpc('driver_heatmap');
      if (error) throw error;
      if (requestId !== heatmapRequestId) return;
      lastHeatmapRefreshAt = Date.now();
      const features = (data || []).map((spot) => ({
        type: 'Feature',
        properties: { weight: Math.min(1, Math.max(0.15, Number(spot.demand) / 5)) },
        geometry: { type: 'Point', coordinates: [Number(spot.longitude), Number(spot.latitude)] }
      })).filter((feature) => feature.geometry.coordinates.every(Number.isFinite));
      source.setData(featureCollection(features));
      setMapStatus(features.length
        ? `${features.length} zona(s) de demanda detectada(s) en los últimos 24 h.`
        : 'No hay solicitudes recientes dentro de 2 km.');
    } catch (error) {
      if (requestId !== heatmapRequestId) return;
      setMapStatus(`No se pudo consultar la demanda: ${error.message}. Verifica que hayas aplicado el esquema actualizado de Supabase.`, true);
    }
  }

  async function updateActiveTripRoute() {
    if (!activeTrip || !currentPosition || !map || !map.isStyleLoaded()) return;
    const requestId = ++routeRequestId;
    routeController?.abort();
    routeController = new AbortController();
    const isPickupRoute = activeTrip.status === 'accepted';
    const target = isPickupRoute
      ? [Number(activeTrip.pickup_longitude), Number(activeTrip.pickup_latitude)]
      : [Number(activeTrip.destination_longitude), Number(activeTrip.destination_latitude)];
    if (!target.every(Number.isFinite)) {
      setMapStatus('Este viaje no tiene coordenadas válidas para mostrar la ruta.', true);
      return;
    }

    const from = [currentPosition.longitude, currentPosition.latitude];
    const coordinates = [from, target].map((point) => point.join(',')).join(';');
    const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
    url.searchParams.set('access_token', mapboxToken);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');

    try {
      const response = await fetch(url, { signal: routeController.signal });
      const result = await response.json();
      if (!response.ok || result.code !== 'Ok' || !result.routes?.length) {
        throw new Error(result.message || `Error ${response.status}`);
      }
      if (requestId !== routeRequestId) return;
      const route = result.routes[0].geometry?.coordinates;
      if (!Array.isArray(route) || route.length < 2) throw new Error('Mapbox no devolvió la geometría de la ruta.');
      map.getSource('driver-trip-route').setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: route }
      });
      const bounds = new mapboxgl.LngLatBounds();
      for (const coordinate of route) bounds.extend(coordinate);
      map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 450 });
      renderDriverMap();
      lastRoutePosition = currentPosition;
      lastRouteUpdateAt = Date.now();
      setMapStatus(isPickupRoute ? 'Ruta hacia el punto de recogida.' : 'Ruta hacia el destino del pasajero.');
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === routeRequestId) {
        setMapStatus(`No se pudo calcular la ruta del viaje: ${error.message}`, true);
      }
    }
  }

  function openNavigation() {
    if (!activeTrip) return;
    const isPickupRoute = activeTrip.status === 'accepted';
    const latitude = Number(isPickupRoute ? activeTrip.pickup_latitude : activeTrip.destination_latitude);
    const longitude = Number(isPickupRoute ? activeTrip.pickup_longitude : activeTrip.destination_longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setMapStatus('Este viaje no tiene coordenadas válidas para navegar.', true);
      return;
    }

    if (navigationPreference.value === 'google-maps') {
      const url = new URL('https://www.google.com/maps/dir/');
      url.searchParams.set('api', '1');
      url.searchParams.set('destination', `${latitude},${longitude}`);
      url.searchParams.set('travelmode', 'driving');
      const link = document.createElement('a');
      link.href = url.toString();
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.click();
      return;
    }

    if (map) {
      map.flyTo({ center: [longitude, latitude], zoom: 15 });
      void updateActiveTripRoute();
    }
  }

  function stopTracking(clearTrips = false) {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    clearInterval(heartbeat);
    heartbeat = null;
    clearInterval(heatmapTimer);
    heatmapTimer = null;
    if (clearTrips) {
      clearInterval(tripsTimer);
      tripsTimer = null;
    }
  }

  async function savePresence(isOnline) {
    const user = getUser();
    const profile = getProfile();
    if (!user || profile?.role !== 'driver') return;
    if (isOnline && !currentPosition) throw new Error('Esperando una ubicación GPS válida.');
    const finishing = serviceState.value === 'finishing';
    if (isOnline && finishing && !finishLocation) {
      throw new Error('Busca y selecciona el destino de tu servicio actual.');
    }
    const { error } = await supabase.from('driver_presence').upsert({
      driver_id: user.id,
      vehicle_category: profile.vehicle_category,
      is_online: isOnline,
      service_state: serviceState.value,
      latitude: currentPosition?.latitude ?? null,
      longitude: currentPosition?.longitude ?? null,
      finish_destination: finishing ? finishLocation.label : null,
      finish_latitude: finishing ? finishLocation.coordinates[1] : null,
      finish_longitude: finishing ? finishLocation.coordinates[0] : null,
      last_seen_at: new Date().toISOString()
    }, { onConflict: 'driver_id' });
    if (error) throw error;
    if (isOnline) lastPresenceWriteAt = Date.now();
  }

  function connect() {
    if (watchId !== null) return;
    if (!navigator.geolocation) {
      onlineControl.checked = false;
      report('Este navegador no permite compartir ubicación.', true);
      return;
    }
    if (serviceState.value === 'finishing' && !finishLocation) {
      onlineControl.checked = false;
      finishField.hidden = false;
      report('Selecciona primero el destino de tu servicio actual.', true);
      return;
    }

    onlineControl.checked = true;
    serviceState.disabled = false;
    lastPresenceWriteAt = 0;
    void initializeMap();
    report('Solicitando permiso para compartir tu ubicación…');
    watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        currentPosition = { latitude: coords.latitude, longitude: coords.longitude };
        report('Conectado. Tu ubicación se actualiza mientras la app está abierta.');
        renderDriverMap();
        if (Date.now() - lastHeatmapRefreshAt >= 30000) void refreshHeatmap();
        if (Date.now() - lastPresenceWriteAt >= 10000) {
          void savePresence(true).catch((error) => report(`No se pudo actualizar tu disponibilidad: ${error.message}`, true));
        }
        if (activeTrip && (
          !lastRoutePosition
          || Date.now() - lastRouteUpdateAt >= 30000
          || Math.hypot(
            (currentPosition.latitude - lastRoutePosition.latitude) * 111,
            (currentPosition.longitude - lastRoutePosition.longitude) * 111 * Math.cos(currentPosition.latitude * Math.PI / 180)
          ) >= 0.1
        )) {
          void updateActiveTripRoute();
        }
      },
      (error) => {
        onlineControl.checked = false;
        stopTracking();
        serviceState.disabled = true;
        void refreshHeatmap();
        report(`No se pudo obtener tu ubicación: ${error.message}`, true);
        void savePresence(false).catch((saveError) => {
          report(`No se pudo obtener tu ubicación ni guardar el estado: ${saveError.message}`, true);
        });
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      void savePresence(true).catch((error) => report(`No se pudo renovar tu disponibilidad: ${error.message}`, true));
    }, 20000);
    clearInterval(heatmapTimer);
    heatmapTimer = setInterval(() => void refreshHeatmap(), 30000);
  }

  async function disconnect() {
    onlineControl.checked = false;
    stopTracking();
    serviceState.disabled = true;
    void refreshHeatmap();
    try {
      await savePresence(false);
      renderDriverMap();
      report('Desconectado. Tu ubicación ya no se comparte.');
    } catch (error) {
      report(`No se pudo guardar el estado desconectado: ${error.message}`, true);
    }
  }

  async function searchDestination() {
    if (!mapboxToken) {
      report('Configura un token público de Mapbox para buscar el destino.', true);
      return;
    }
    const requestId = ++destinationRequestId;
    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', destinationInput.value.trim());
    url.searchParams.set('access_token', mapboxToken);
    url.searchParams.set('autocomplete', 'true');
    url.searchParams.set('language', 'es');
    url.searchParams.set('limit', '5');
    destinationController = new AbortController();
    try {
      const response = await fetch(url, { signal: destinationController.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `Error ${response.status}`);
      if (requestId !== destinationRequestId) return;
      suggestions.replaceChildren();
      for (const feature of result.features || []) {
        const coordinates = feature.geometry?.coordinates;
        const properties = feature.properties || {};
        if (!Array.isArray(coordinates) || coordinates.length < 2 || !coordinates.every(Number.isFinite)) continue;
        const label = properties.full_address
          || [properties.name, properties.place_formatted].filter(Boolean).join(', ');
        if (!label) continue;
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'suggestion-option';
        option.setAttribute('role', 'option');
        option.textContent = label;
        option.addEventListener('click', () => {
          finishLocation = { label, coordinates };
          destinationInput.value = label;
          suggestions.replaceChildren();
          suggestions.hidden = true;
          if (onlineControl.checked) {
            void savePresence(true).catch((error) => report(error.message, true));
          }
        });
        suggestions.append(option);
      }
      suggestions.hidden = suggestions.childElementCount === 0;
    } catch (error) {
      if (error.name !== 'AbortError' && requestId === destinationRequestId) {
        report(`No se pudo buscar el destino: ${error.message}`, true);
      }
    }
  }

  async function restorePresence() {
    const user = getUser();
    const { data, error } = await supabase.from('driver_presence')
      .select('is_online, service_state, latitude, longitude, finish_destination, finish_latitude, finish_longitude, last_seen_at')
      .eq('driver_id', user.id)
      .maybeSingle();
    if (error) {
      report(`No se pudo consultar tu disponibilidad: ${error.message}`, true);
      return;
    }
    if (!data) return;
    serviceState.value = data.service_state;
    finishField.hidden = data.service_state !== 'finishing';
    if (data.latitude !== null && data.longitude !== null) {
      currentPosition = { latitude: Number(data.latitude), longitude: Number(data.longitude) };
    }
    if (data.finish_destination && data.finish_latitude !== null && data.finish_longitude !== null) {
      finishLocation = {
        label: data.finish_destination,
        coordinates: [Number(data.finish_longitude), Number(data.finish_latitude)]
      };
      destinationInput.value = data.finish_destination;
    }
    const fresh = Date.now() - new Date(data.last_seen_at).getTime() <= 45000;
    if (data.is_online && fresh) connect();
    else {
      onlineControl.checked = false;
      serviceState.disabled = true;
      if (data.is_online) await disconnect();
    }
  }

  function showEmptyList(list, message) {
    const empty = document.createElement('p');
    empty.className = 'empty-list';
    empty.textContent = message;
    list.replaceChildren(empty);
  }

  function renderTripList(trips, list) {
    list.replaceChildren();
    if (!trips.length) {
      showEmptyList(list, 'No hay viajes en esta lista.');
      return;
    }

    for (const trip of trips) {
      const item = document.createElement('div');
      item.className = 'assigned-trip';
      const title = document.createElement('strong');
      title.textContent = `${trip.pickup} → ${trip.destination}`;
      const details = document.createElement('span');
      details.textContent = `${STATUS_LABELS[trip.status] || trip.status} · ${trip.vehicle_type} · ${trip.service_type} · $${Number(trip.estimated_fare).toFixed(2)}`;
      const actions = document.createElement('div');
      actions.className = 'trip-card-actions';
      const action = TRIP_ACTIONS[trip.status];

      if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = action.label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const { error } = await supabase.rpc('advance_trip_status', {
              p_trip_id: trip.id,
              p_next_status: action.status
            });
            if (error) throw error;
            if (action.status === 'completed') {
              serviceState.value = 'available';
              finishLocation = null;
              destinationInput.value = '';
              finishField.hidden = true;
              if (onlineControl.checked) await savePresence(true);
            }
            await refreshTrips();
          } catch (error) {
            button.disabled = false;
            setMapStatus(`No se pudo actualizar el viaje: ${error.message}`, true);
          }
        });
        actions.append(button);
      }

      if (trip.status === 'accepted' || trip.status === 'in_progress') {
        const navigationButton = document.createElement('button');
        navigationButton.type = 'button';
        navigationButton.className = 'text-button';
        navigationButton.textContent = 'Navegar';
        navigationButton.setAttribute('aria-label', 'Navegar al punto activo del viaje');
        navigationButton.addEventListener('click', openNavigation);
        actions.append(navigationButton);
      }

      item.append(title, details, actions);
      list.append(item);
    }
  }

  async function refreshTrips() {
    const user = getUser();
    if (!user || getProfile()?.role !== 'driver') return;
    const { data, error } = await supabase.from('trips')
      .select('id, pickup, destination, pickup_latitude, pickup_longitude, destination_latitude, destination_longitude, vehicle_type, service_type, estimated_fare, status')
      .eq('driver_id', user.id)
      .in('status', ['pending', 'accepted', 'in_progress'])
      .order('created_at', { ascending: false });
    if (error) {
      availableTripsList.textContent = `No se pudieron cargar los servicios: ${error.message}`;
      tripsList.textContent = `No se pudieron cargar los viajes: ${error.message}`;
      return;
    }

    const activeTrips = data || [];
    const availableTrips = activeTrips.filter((trip) => trip.status === 'pending');
    const assignedTrips = activeTrips.filter((trip) => trip.status === 'accepted' || trip.status === 'in_progress');
    renderTripList(availableTrips, availableTripsList);
    renderTripList(assignedTrips, tripsList);
    availableTripsPanel.hidden = false;
    tripsPanel.hidden = false;

    const nextTrip = assignedTrips[0] || null;
    const routeChanged = activeTrip?.id !== nextTrip?.id || activeTrip?.status !== nextTrip?.status;
    activeTrip = nextTrip;
    if (routeChanged) {
      lastRoutePosition = null;
      lastRouteUpdateAt = 0;
      routeController?.abort();
      routeRequestId += 1;
      if (map?.isStyleLoaded()) {
        map.getSource('driver-trip-route')?.setData(featureCollection());
        renderDriverMap();
        if (activeTrip) void updateActiveTripRoute();
      }
    }
  }

  async function loadPaymentDetails() {
    const user = getUser();
    if (!user || getProfile()?.role !== 'driver') return;
    paymentForm.reset();
    paymentStatus.textContent = '';
    paymentStatus.classList.remove('error', 'success');
    const { data, error } = await supabase.from('driver_payment_profiles')
      .select('bank_name, phone_number, identity_number')
      .eq('driver_id', user.id)
      .maybeSingle();
    if (error) {
      paymentStatus.textContent = `No se pudieron cargar tus datos: ${error.message}. Aplica el esquema actualizado de Supabase.`;
      paymentStatus.classList.add('error');
      return;
    }
    if (data) {
      paymentBank.value = data.bank_name;
      paymentPhone.value = data.phone_number;
      paymentIdentity.value = data.identity_number;
      paymentStatus.textContent = 'Datos de Pago Móvil cargados.';
    } else {
      paymentStatus.textContent = 'Completa estos datos para que tus pasajeros puedan pagarte directamente.';
    }
  }

  paymentForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = getUser();
    if (!user || getProfile()?.role !== 'driver') return;
    paymentSave.disabled = true;
    paymentStatus.classList.remove('error', 'success');
    paymentStatus.textContent = 'Guardando…';
    try {
      const { error } = await supabase.from('driver_payment_profiles').upsert({
        driver_id: user.id,
        bank_name: paymentBank.value.trim(),
        phone_number: paymentPhone.value.trim(),
        identity_number: paymentIdentity.value.trim(),
        updated_at: new Date().toISOString()
      }, { onConflict: 'driver_id' });
      if (error) throw error;
      paymentStatus.textContent = 'Datos de Pago Móvil guardados.';
      paymentStatus.classList.add('success');
    } catch (error) {
      paymentStatus.textContent = `No se pudieron guardar los datos: ${error.message}. Aplica el esquema actualizado de Supabase.`;
      paymentStatus.classList.add('error');
    } finally {
      paymentSave.disabled = false;
    }
  });

  navigationPreference.addEventListener('change', () => {
    try {
      localStorage.setItem(`enruta-navigation-${getUser()?.id}`, navigationPreference.value);
    } catch (error) {
      setMapStatus(`No se pudo guardar la preferencia de navegación: ${error.message}`, true);
    }
  });

  onlineControl.addEventListener('change', () => {
    if (onlineControl.checked) connect();
    else void disconnect();
  });
  serviceState.addEventListener('change', () => {
    const finishing = serviceState.value === 'finishing';
    finishField.hidden = !finishing;
    if (!finishing) {
      finishLocation = null;
      destinationInput.value = '';
      suggestions.replaceChildren();
      suggestions.hidden = true;
    }
    if (finishing && !finishLocation && onlineControl.checked) {
      onlineControl.checked = false;
      stopTracking();
      serviceState.disabled = true;
      renderDriverMap();
      void refreshHeatmap();
      const user = getUser();
      void supabase.from('driver_presence')
        .update({ is_online: false, last_seen_at: new Date().toISOString() })
        .eq('driver_id', user.id)
        .then(({ error }) => {
          report(error
            ? `Selecciona el destino de tu servicio. No se pudo actualizar tu estado: ${error.message}`
            : 'Selecciona el destino de tu servicio actual y vuelve a conectarte.');
          if (error) locationStatus.classList.add('error');
        });
      return;
    }
    if (onlineControl.checked) {
      void savePresence(true).catch((error) => report(error.message, true));
    }
  });
  destinationInput.addEventListener('input', () => {
    finishLocation = null;
    clearTimeout(destinationTimer);
    destinationController?.abort();
    destinationController = null;
    destinationRequestId += 1;
    suggestions.replaceChildren();
    suggestions.hidden = true;
    if (destinationInput.value.trim().length >= 3) {
      destinationTimer = setTimeout(() => void searchDestination(), 350);
    }
  });

  return {
    async start() {
      if (getProfile()?.role !== 'driver') return;
      try {
        navigationPreference.value = localStorage.getItem(`enruta-navigation-${getUser()?.id}`) || 'enruta';
      } catch (error) {
        report(`No se pudo leer la preferencia de navegación: ${error.message}`, true);
      }
      await initializeMap();
      await restorePresence();
      await refreshTrips();
      await loadPaymentDetails();
      clearInterval(tripsTimer);
      tripsTimer = setInterval(() => void refreshTrips(), 15000);
    },
    stop() {
      stopTracking(true);
      heatmapRequestId += 1;
      routeRequestId += 1;
      routeController?.abort();
      routeController = null;
      activeTrip = null;
      currentPosition = null;
      paymentForm.reset();
      paymentStatus.textContent = '';
      paymentStatus.classList.remove('error', 'success');
      if (map?.isStyleLoaded()) {
        map.getSource('driver-heatmap')?.setData(featureCollection());
        map.getSource('driver-trip-route')?.setData(featureCollection());
        renderDriverMap();
      }
    },
    disconnect
  };
}
