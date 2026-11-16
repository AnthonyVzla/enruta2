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
  const tripsPanel = document.querySelector('#assigned-trips');
  const tripsList = document.querySelector('#assigned-trip-list');

  let watchId = null;
  let heartbeat = null;
  let tripsTimer = null;
  let destinationTimer = null;
  let destinationController = null;
  let destinationRequestId = 0;
  let currentPosition = null;
  let finishLocation = null;
  let lastPresenceWriteAt = 0;

  function report(message, isError = false) {
    locationStatus.textContent = message;
    locationStatus.classList.toggle('error', isError);
  }

  function stopTracking() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    clearInterval(heartbeat);
    heartbeat = null;
    clearInterval(tripsTimer);
    tripsTimer = null;
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
    report('Solicitando permiso para compartir tu ubicación…');
    watchId = navigator.geolocation.watchPosition(
      ({ coords }) => {
        currentPosition = { latitude: coords.latitude, longitude: coords.longitude };
        report('Conectado. Tu ubicación se actualiza mientras la app está abierta.');
        if (Date.now() - lastPresenceWriteAt >= 10000) {
          void savePresence(true).catch((error) => report(`No se pudo actualizar tu disponibilidad: ${error.message}`, true));
        }
      },
      (error) => {
        onlineControl.checked = false;
        stopTracking();
        serviceState.disabled = true;
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
  }

  async function disconnect() {
    onlineControl.checked = false;
    stopTracking();
    serviceState.disabled = true;
    try {
      await savePresence(false);
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

  async function refreshTrips() {
    const user = getUser();
    if (!user || getProfile()?.role !== 'driver') return;
    const { data, error } = await supabase.from('trips')
      .select('id, pickup, destination, vehicle_type, service_type, estimated_fare, status')
      .eq('driver_id', user.id)
      .in('status', ['pending', 'accepted', 'in_progress'])
      .order('created_at', { ascending: false });
    if (error) {
      tripsPanel.hidden = false;
      tripsList.textContent = `No se pudieron cargar los viajes: ${error.message}`;
      return;
    }
    tripsList.replaceChildren();
    const activeTrips = data || [];
    tripsPanel.hidden = activeTrips.length === 0;
    for (const trip of activeTrips) {
      const item = document.createElement('div');
      item.className = 'assigned-trip';
      const title = document.createElement('strong');
      title.textContent = `${trip.pickup} → ${trip.destination}`;
      const details = document.createElement('span');
      details.textContent = `${STATUS_LABELS[trip.status] || trip.status} · ${trip.vehicle_type} · ${trip.service_type} · $${Number(trip.estimated_fare).toFixed(2)}`;
      item.append(title, details);
      const action = TRIP_ACTIONS[trip.status];
      if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'text-button';
        button.textContent = action.label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const { error: updateError } = await supabase.rpc('advance_trip_status', {
              p_trip_id: trip.id,
              p_next_status: action.status
            });
            if (updateError) throw updateError;
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
            button.textContent = `Error: ${error.message}`;
          }
        });
        item.append(button);
      }
      tripsList.append(item);
    }
  }

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
      await restorePresence();
      await refreshTrips();
      clearInterval(tripsTimer);
      tripsTimer = setInterval(() => void refreshTrips(), 15000);
    },
    stop: stopTracking,
    disconnect
  };
}
