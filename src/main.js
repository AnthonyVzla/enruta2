import { createClient } from '@supabase/supabase-js';
import './style.css';
import { createDriverPanel } from './driver.js';
import { calculateFare, VEHICLE_RATES } from './pricing.js';

const SUPABASE_URL = 'https://dvkusfutsnygppvtbxmg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TJDfKd2G-C0bFCB_3hnKGg_U68DBDNz';
const MAPBOX_ACCESS_TOKEN = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const authScreen = document.querySelector('#auth-screen');
const appShell = document.querySelector('#app-shell');
const authForm = document.querySelector('#auth-form');
const authMessage = document.querySelector('#auth-message');
const authSubmit = document.querySelector('#auth-submit');
const authModeToggle = document.querySelector('#auth-mode-toggle');
const signupFields = document.querySelector('#signup-fields');
const authRole = document.querySelector('#auth-role');
const driverCategoryField = document.querySelector('#driver-category-field');
const authFullName = document.querySelector('#auth-full-name');
const authEmail = document.querySelector('#auth-email');
const authPassword = document.querySelector('#auth-password');
const routeStatus = document.querySelector('#route-status');
const statusMessage = document.querySelector('#status-message');
const requestButton = document.querySelector('#request-ride');
const fare = document.querySelector('#fare');
const distance = document.querySelector('#distance');
const mapElement = document.querySelector('#map-canvas');
const driverControls = document.querySelector('#driver-controls');
const driverOnline = document.querySelector('#driver-online');
const driversStatus = document.querySelector('#drivers-status');
const driverList = document.querySelector('#driver-list');
const serviceOptions = [...document.querySelectorAll('.service-option')];
const candidateEtaLabels = {
  express: document.querySelector('#express-eta'),
  economica: document.querySelector('#economica-eta')
};

const roleLabels = {
  client: 'Cliente',
  driver: 'Conductor',
  support: 'Soporte',
  admin: 'Administración'
};
const rolesDetails = {
  driver: 'Tu perfil de conductor está listo. La categoría se usa para identificar el tipo de vehículo que ofreces.',
  support: 'Tu cuenta tiene acceso al perfil de soporte. Las herramientas de atención se habilitarán en el panel operativo.',
  admin: 'Tu cuenta tiene acceso al perfil de administración. Las herramientas de gestión se habilitarán en el panel operativo.'
};

let isRegistering = false;
let currentUser = null;
let currentProfile = null;
let selectedRide = 'carro';
let selectedService = 'express';
let currentRoute = null;
let routeController = null;
let routeRequestId = 0;
let requestInProgress = false;
let tripSubmitted = false;
let currentCandidates = [];
let currentMap = null;
let mapboxgl = null;
let mapInitializationPromise = null;
let mapMarkers = [];
let mapRouteCoordinates = null;
let hasFittedRoute = false;
let candidateRequestId = 0;
let candidateTimer = null;

const driverPanel = createDriverPanel({
  supabase,
  getUser: () => currentUser,
  getProfile: () => currentProfile,
  mapboxToken: MAPBOX_ACCESS_TOKEN
});

const addressFields = {
  pickup: {
    input: document.querySelector('#pickup'),
    suggestions: document.querySelector('#pickup-suggestions'),
    location: null,
    timer: null,
    requestId: 0,
    controller: null
  },
  destination: {
    input: document.querySelector('#destination'),
    suggestions: document.querySelector('#destination-suggestions'),
    location: null,
    timer: null,
    requestId: 0,
    controller: null
  }
};

document.querySelector('.greeting .eyebrow').textContent = new Intl.DateTimeFormat('es', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
}).format(new Date()).toLocaleUpperCase('es');

function setAuthMessage(message, type = '') {
  authMessage.textContent = message;
  authMessage.className = `status-message auth-message ${type}`.trim();
}

function setRouteMessage(message, type = '') {
  routeStatus.textContent = message;
  routeStatus.className = `route-status ${type}`.trim();
}

function setTripMessage(message, type = '') {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type}`.trim();
}

function updateAuthMode() {
  document.querySelector('#auth-title').textContent = isRegistering ? 'Crea tu cuenta' : 'Bienvenido de nuevo';
  document.querySelector('#auth-description').textContent = isRegistering
    ? 'Regístrate para empezar a moverte con EnRuta.'
    : 'Ingresa para pedir tu próximo viaje.';
  document.querySelector('#auth-switch-copy').textContent = isRegistering
    ? '¿Ya tienes cuenta?'
    : '¿Aún no tienes cuenta?';
  authModeToggle.textContent = isRegistering ? 'Iniciar sesión' : 'Crear cuenta';
  authSubmit.textContent = isRegistering ? 'Crear cuenta' : 'Iniciar sesión';
  signupFields.hidden = !isRegistering;
  authFullName.required = isRegistering;
  authPassword.autocomplete = isRegistering ? 'new-password' : 'current-password';
  driverCategoryField.hidden = !isRegistering || authRole.value !== 'driver';
  setAuthMessage('');
}

function clearRideState() {
  requestInProgress = false;
  setBookingBusy(false);
  requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
  routeRequestId += 1;
  for (const field of Object.values(addressFields)) {
    clearTimeout(field.timer);
    field.controller?.abort();
    field.requestId += 1;
    field.location = null;
    field.input.value = '';
    field.suggestions.replaceChildren();
    field.suggestions.hidden = true;
  }
  routeController?.abort();
  currentRoute = null;
  mapRouteCoordinates = null;
  hasFittedRoute = false;
  routeController = null;
  tripSubmitted = false;
  selectedRide = 'carro';
  selectedService = 'express';
  clearCandidates();
  document.querySelectorAll('.ride-option').forEach((option) => {
    const selected = option.dataset.ride === selectedRide;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
  serviceOptions.forEach((option) => {
    const selected = option.dataset.service === selectedService;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
  setRouteMessage(MAPBOX_ACCESS_TOKEN
    ? 'Escribe y selecciona ambos puntos para calcular la ruta.'
    : 'Configura VITE_MAPBOX_ACCESS_TOKEN para habilitar las rutas de Mapbox.');
  setTripMessage('');
  renderFare();
}

function showAuthScreen(message = '') {
  driverPanel.stop();
  authScreen.hidden = false;
  appShell.hidden = true;
  currentUser = null;
  currentProfile = null;
  clearRideState();
  setAuthMessage(message, message ? 'error' : '');
}

function displayProfile(profile) {
  const isClient = profile.role === 'client';
  document.querySelector('#profile-name').textContent = profile.full_name || 'Mi perfil';
  document.querySelector('#profile-role').textContent = roleLabels[profile.role] || 'Usuario';
  document.querySelector('#profile-avatar').textContent = (profile.full_name || 'E').trim().charAt(0).toLocaleUpperCase('es');
  document.querySelector('#greeting-title').textContent = isClient
    ? '¿A dónde vamos?'
    : `¡Hola, ${(profile.full_name || '').trim().split(/\s+/)[0] || 'bienvenido'}!`;
  document.querySelector('.map-card').hidden = !isClient;
  document.querySelector('#booking-card').hidden = !isClient;
  const rolePanel = document.querySelector('#role-panel');
  rolePanel.hidden = isClient;
  driverControls.hidden = profile.role !== 'driver';

  if (!isClient) {
    document.querySelector('#role-panel-title').textContent = `Perfil de ${roleLabels[profile.role] || 'usuario'}`;
    document.querySelector('#role-panel-description').textContent = rolesDetails[profile.role] || 'Tu perfil está activo.';
    const driverCategory = document.querySelector('#driver-category-summary');
    driverCategory.hidden = profile.role !== 'driver';
    document.querySelector('#driver-category-label').textContent = profile.vehicle_category === 'moto' ? 'Moto' : 'Carro';
  } else {
    window.setTimeout(() => {
      void initializeMap().then(() => currentMap?.resize());
    }, 0);
  }

  authScreen.hidden = true;
  appShell.hidden = false;
}

async function loadProfile(user) {
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, role, vehicle_category')
    .eq('id', user.id)
    .single();

  if (error) {
    throw new Error(`No se pudo cargar tu perfil: ${error.message}. Verifica que hayas ejecutado el esquema de Supabase.`);
  }

  currentUser = user;
  currentProfile = profile;
  displayProfile(profile);
  clearRideState();
  if (profile.role === 'driver') {
    void driverPanel.start();
  }
}

authModeToggle.addEventListener('click', () => {
  isRegistering = !isRegistering;
  updateAuthMode();
});

authRole.addEventListener('change', () => {
  driverCategoryField.hidden = authRole.value !== 'driver';
});

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authSubmit.disabled = true;
  setAuthMessage(isRegistering ? 'Creando tu cuenta…' : 'Iniciando sesión…');

  try {
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (isRegistering) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: authFullName.value.trim(),
            role: authRole.value,
            vehicle_category: authRole.value === 'driver'
              ? document.querySelector('#auth-vehicle').value
              : null
          }
        }
      });
      if (error) throw error;

      if (data.session && data.user) {
        await loadProfile(data.user);
      } else {
        isRegistering = false;
        updateAuthMode();
        setAuthMessage('Cuenta creada. Revisa tu correo para confirmar la dirección y luego inicia sesión.', 'success');
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await loadProfile(data.user);
    }
  } catch (error) {
    setAuthMessage(error.message || 'No se pudo completar la autenticación.', 'error');
  } finally {
    authSubmit.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  if (currentProfile?.role === 'driver' && document.querySelector('#driver-online').checked) {
    await driverPanel.disconnect();
  }
  const { error } = await supabase.auth.signOut();
  if (error) {
    setTripMessage(`No se pudo cerrar la sesión: ${error.message}`, 'error');
    return;
  }
  showAuthScreen();
});

supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && currentUser) showAuthScreen();
});

function renderFare() {
  const result = currentRoute ? calculateFare(currentRoute.distanceMeters, selectedRide, selectedService) : null;
  document.querySelector('#rate-carro').textContent = `$${VEHICLE_RATES.carro.express.toFixed(2)}/km`;
  document.querySelector('#rate-moto').textContent = `$${VEHICLE_RATES.moto.express.toFixed(2)}/km`;
  document.querySelector('#express-rate').textContent = `$${VEHICLE_RATES[selectedRide].express.toFixed(2)}/km`;
  document.querySelector('#economica-rate').textContent = `$${VEHICLE_RATES[selectedRide].economica.toFixed(2)}/km`;
  distance.textContent = result
    ? `${result.distanceKm.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 3 })} km`
    : '—';
  fare.innerHTML = result ? `$${result.fare.toFixed(2)} <small>USD</small>` : '— <small>USD</small>';
  const serviceHasDrivers = currentCandidates.some((candidate) => candidate.service === selectedService);
  requestButton.disabled = !currentUser || currentProfile?.role !== 'client' || !result
    || !serviceHasDrivers || requestInProgress || tripSubmitted;
  document.querySelectorAll('.ride-option').forEach((option) => {
    const selected = option.dataset.ride === selectedRide;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
  serviceOptions.forEach((option) => {
    const service = option.dataset.service;
    const selected = service === selectedService;
    const available = currentCandidates.some((candidate) => candidate.service === service);
    option.disabled = !currentRoute || !available || requestInProgress;
    option.classList.toggle('selected', selected);
    option.setAttribute('aria-checked', String(selected));
  });
}

function setBookingBusy(busy) {
  for (const field of Object.values(addressFields)) field.input.disabled = busy;
  document.querySelectorAll('.ride-option, .service-option, .locate-button, .field-action').forEach((control) => {
    control.disabled = busy;
  });
}

function clearRouteCalculation() {
  routeRequestId += 1;
  routeController?.abort();
  routeController = null;
  currentRoute = null;
  mapRouteCoordinates = null;
  hasFittedRoute = false;
  clearCandidates();
  tripSubmitted = false;
  requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
  renderFare();
  renderMap();
  setTripMessage('');
}

function clearCandidates(message = 'Completa la ruta para consultar conductores.') {
  candidateRequestId += 1;
  clearInterval(candidateTimer);
  candidateTimer = null;
  currentCandidates = [];
  driverList.replaceChildren();
  driverList.hidden = true;
  driversStatus.textContent = message;
  driversStatus.className = 'route-status';
  candidateEtaLabels.express.textContent = 'Sin disponibilidad';
  candidateEtaLabels.economica.textContent = 'Sin disponibilidad';
  renderFare();
  renderMap();
}

async function initializeMap() {
  if (currentMap || !mapElement || currentProfile?.role !== 'client') return;
  if (!MAPBOX_ACCESS_TOKEN) {
    showMapError('Configura un token público de Mapbox para mostrar el mapa.');
    return;
  }
  if (mapInitializationPromise) return mapInitializationPromise;
  mapInitializationPromise = (async () => {
    try {
      const [mapboxModule] = await Promise.all([
        import('mapbox-gl'),
        import('mapbox-gl/dist/mapbox-gl.css')
      ]);
      if (currentProfile?.role !== 'client') return;
      mapboxgl = mapboxModule.default;
      mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;
      currentMap = new mapboxgl.Map({
        container: mapElement,
        style: 'mapbox://styles/mapbox/streets-v12',
        center: [-66.9036, 10.4806],
        zoom: 10,
        attributionControl: true
      });
      currentMap.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      currentMap.on('load', renderMap);
      currentMap.on('error', (event) => {
        if (event.error) showMapError(`No se pudo cargar el mapa: ${event.error.message}`);
      });
    } catch (error) {
      showMapError(`No se pudo inicializar Mapbox: ${error.message}`);
    } finally {
      mapInitializationPromise = null;
    }
  })();
  return mapInitializationPromise;
}

function showMapError(message) {
  let notice = mapElement.querySelector('.map-error-message');
  if (!notice) {
    notice = document.createElement('p');
    notice.className = 'map-error-message';
    notice.setAttribute('role', 'status');
    mapElement.append(notice);
  }
  notice.textContent = message;
}

function renderMap() {
  if (!mapboxgl || !currentMap || !currentMap.isStyleLoaded()) return;
  for (const marker of mapMarkers) marker.remove();
  mapMarkers = [];

  if (mapRouteCoordinates?.length) {
    const data = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: mapRouteCoordinates }
    };
    if (currentMap.getSource('ride-route')) {
      currentMap.getSource('ride-route').setData(data);
    } else {
      currentMap.addSource('ride-route', { type: 'geojson', data });
      currentMap.addLayer({
        id: 'ride-route-line',
        type: 'line',
        source: 'ride-route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#18795b', 'line-width': 4, 'line-opacity': 0.85 }
      });
    }
  } else if (currentMap.getSource('ride-route')) {
    currentMap.getSource('ride-route').setData({
      type: 'FeatureCollection',
      features: []
    });
  }

  const pickup = addressFields.pickup.location;
  const destination = addressFields.destination.location;
  if (pickup) {
    mapMarkers.push(new mapboxgl.Marker({ color: '#18795b' })
      .setLngLat(pickup.coordinates).setPopup(new mapboxgl.Popup().setText('Punto de recogida'))
      .addTo(currentMap));
  }
  if (destination) {
    mapMarkers.push(new mapboxgl.Marker({ color: '#e4963b' })
      .setLngLat(destination.coordinates).setPopup(new mapboxgl.Popup().setText('Destino'))
      .addTo(currentMap));
  }
  const visibleCandidates = currentCandidates.filter((candidate) => candidate.service === selectedService);
  for (const candidate of visibleCandidates) {
    const marker = document.createElement('div');
    marker.className = 'driver-map-marker';
    const eta = document.createElement('span');
    eta.textContent = `${candidate.etaMinutes} min`;
    marker.append(eta);
    mapMarkers.push(new mapboxgl.Marker({ element: marker })
      .setLngLat([candidate.longitude, candidate.latitude])
      .setPopup(new mapboxgl.Popup().setText(candidate.service === 'economica'
        ? `Termina en ${candidate.etaToFinishMinutes} min · luego ${candidate.etaToPickupMinutes} min`
        : `A ${candidate.etaMinutes} min`))
      .addTo(currentMap));
  }
  if (mapRouteCoordinates?.length && !hasFittedRoute) {
    const bounds = new mapboxgl.LngLatBounds();
    for (const coordinate of mapRouteCoordinates) bounds.extend(coordinate);
    currentMap.fitBounds(bounds, { padding: 45, maxZoom: 14, duration: 500 });
    hasFittedRoute = true;
  }
}

async function fetchDrivingRoute(from, to) {
  const coordinates = [from, to].map((point) => point.join(',')).join(';');
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
  url.searchParams.set('access_token', MAPBOX_ACCESS_TOKEN);
  url.searchParams.set('overview', 'false');
  url.searchParams.set('steps', 'false');
  const response = await fetch(url);
  const result = await response.json();
  if (!response.ok || result.code !== 'Ok' || !result.routes?.length) {
    throw new Error(result.message || 'Mapbox no encontró una ruta para el conductor.');
  }
  if (!Number.isFinite(result.routes[0].duration) || result.routes[0].duration < 0) {
    throw new Error('Mapbox no devolvió un tiempo de llegada válido.');
  }
  return {
    distanceMeters: result.routes[0].distance,
    durationSeconds: result.routes[0].duration
  };
}

async function calculateCandidateETA(candidate, service) {
  const currentPosition = [candidate.longitude, candidate.latitude];
  if (service === 'express') {
    const route = await fetchDrivingRoute(currentPosition, addressFields.pickup.location.coordinates);
    return { ...candidate, service, etaMinutes: Math.max(1, Math.ceil(route.durationSeconds / 60)) };
  }

  const finishPosition = [candidate.finish_longitude, candidate.finish_latitude];
  const [toFinish, toPickup] = await Promise.all([
    fetchDrivingRoute(currentPosition, finishPosition),
    fetchDrivingRoute(finishPosition, addressFields.pickup.location.coordinates)
  ]);
  const etaToFinishMinutes = Math.max(1, Math.ceil(toFinish.durationSeconds / 60));
  const etaToPickupMinutes = Math.max(1, Math.ceil(toPickup.durationSeconds / 60));
  return {
    ...candidate,
    service,
    etaToFinishMinutes,
    etaToPickupMinutes,
    etaMinutes: etaToFinishMinutes + etaToPickupMinutes
  };
}

async function refreshCandidates() {
  const pickup = addressFields.pickup.location;
  if (!currentRoute || !pickup || currentProfile?.role !== 'client') return;
  if (!MAPBOX_ACCESS_TOKEN) {
    clearCandidates('Configura un token público de Mapbox para calcular la disponibilidad y el ETA.');
    return;
  }

  const requestId = ++candidateRequestId;
  driversStatus.textContent = 'Buscando conductores conectados cerca de tu ubicación…';
  driversStatus.className = 'route-status';
  candidateEtaLabels.express.textContent = 'Buscando…';
  candidateEtaLabels.economica.textContent = 'Buscando…';
  renderFare();

  try {
    const etaErrors = [];
    const serviceResults = await Promise.all(['express', 'economica'].map(async (service) => {
      const { data, error } = await supabase.rpc('find_eligible_drivers', {
        p_pickup_latitude: pickup.coordinates[1],
        p_pickup_longitude: pickup.coordinates[0],
        p_vehicle_type: selectedRide,
        p_service_type: service
      });
      if (error) throw error;
      const etaResults = await Promise.all((data || []).slice(0, 5).map((candidate) => (
        calculateCandidateETA(candidate, service).catch((error) => {
          etaErrors.push(error);
          return null;
        })
      )));
      return etaResults.filter(Boolean);
    }));
    if (requestId !== candidateRequestId) return;

    currentCandidates = serviceResults.flat();
    const express = currentCandidates.filter((candidate) => candidate.service === 'express');
    const economic = currentCandidates.filter((candidate) => candidate.service === 'economica');
    candidateEtaLabels.express.textContent = express.length
      ? `Llegada estimada: ${Math.min(...express.map((candidate) => candidate.etaMinutes))} min`
      : 'No hay conductores Express cercanos';
    candidateEtaLabels.economica.textContent = economic.length
      ? `Llegada estimada: ${Math.min(...economic.map((candidate) => candidate.etaMinutes))} min`
      : 'No hay conductores terminando cerca';
    if (!express.length && !economic.length) {
      driversStatus.textContent = etaErrors.length
        ? `No se pudo calcular el ETA de los conductores: ${etaErrors[0].message}`
        : 'No hay conductores elegibles disponibles para esta ruta.';
      driversStatus.classList.toggle('error', etaErrors.length > 0);
    } else {
      driversStatus.textContent = `${express.length + economic.length} opción(es) de conductor con GPS reciente.`;
      if (etaErrors.length) {
        driversStatus.textContent += ' Algunos ETA no están disponibles.';
        driversStatus.classList.add('error');
      }
    }
    renderCandidateList();
    renderFare();
    renderMap();
  } catch (error) {
    if (requestId !== candidateRequestId) return;
    currentCandidates = [];
    driverList.replaceChildren();
    driverList.hidden = true;
    candidateEtaLabels.express.textContent = 'No disponible';
    candidateEtaLabels.economica.textContent = 'No disponible';
    driversStatus.textContent = `No se pudo consultar la disponibilidad: ${error.message}`;
    driversStatus.classList.add('error');
    renderFare();
    renderMap();
  }

  if (requestId === candidateRequestId) {
    clearInterval(candidateTimer);
    candidateTimer = setInterval(() => void refreshCandidates(), 30000);
  }
}

function renderCandidateList() {
  driverList.replaceChildren();
  const visible = currentCandidates.filter((candidate) => candidate.service === selectedService);
  driverList.hidden = visible.length === 0;
  for (const candidate of visible) {
    const row = document.createElement('div');
    row.className = 'candidate-row';
    const label = document.createElement('span');
    label.textContent = selectedService === 'economica'
      ? `${candidate.etaToFinishMinutes} min al destino actual + ${candidate.etaToPickupMinutes} min hasta ti`
      : `Conductor a ${candidate.etaMinutes} min`;
    const category = document.createElement('strong');
    category.textContent = candidate.vehicle_category === 'moto' ? 'Moto' : 'Carro';
    row.append(label, category);
    driverList.append(row);
  }
}

function hideSuggestions(field) {
  field.suggestions.hidden = true;
  field.suggestions.replaceChildren();
}

function renderSuggestions(fieldName, features) {
  const field = addressFields[fieldName];
  field.suggestions.replaceChildren();
  for (const feature of features) {
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
      field.input.value = label;
      field.location = { label, coordinates };
      hideSuggestions(field);
      clearRouteCalculation();
      if (addressFields.pickup.location && addressFields.destination.location) void calculateRoute();
    });
    field.suggestions.append(option);
  }
  field.suggestions.hidden = field.suggestions.childElementCount === 0;
}

async function searchPlaces(fieldName) {
  const field = addressFields[fieldName];
  const query = field.input.value.trim();
  field.requestId += 1;
  const requestId = field.requestId;
  field.controller?.abort();
  field.controller = null;
  if (query.length < 3) {
    hideSuggestions(field);
    return;
  }
  if (!MAPBOX_ACCESS_TOKEN) {
    setRouteMessage('Configura VITE_MAPBOX_ACCESS_TOKEN para buscar direcciones con Mapbox.', 'error');
    return;
  }

  field.controller = new AbortController();
  const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
  url.searchParams.set('q', query);
  url.searchParams.set('access_token', MAPBOX_ACCESS_TOKEN);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('language', 'es');
  url.searchParams.set('limit', '5');

  try {
    const response = await fetch(url, { signal: field.controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `Error ${response.status}`);
    if (requestId === field.requestId) renderSuggestions(fieldName, result.features || []);
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== field.requestId) return;
    hideSuggestions(field);
    setRouteMessage(`No se pudieron buscar direcciones: ${error.message}`, 'error');
  }
}

for (const [fieldName, field] of Object.entries(addressFields)) {
  field.input.addEventListener('input', () => {
    field.location = null;
    field.requestId += 1;
    field.controller?.abort();
    field.controller = null;
    hideSuggestions(field);
    clearTimeout(field.timer);
    clearRouteCalculation();
    setRouteMessage('Selecciona una dirección de la lista para usar su ubicación exacta.');
    field.timer = setTimeout(() => void searchPlaces(fieldName), 350);
  });
}

async function calculateRoute() {
  const pickup = addressFields.pickup.location;
  const destination = addressFields.destination.location;
  if (!pickup || !destination) return;
  if (!MAPBOX_ACCESS_TOKEN) {
    setRouteMessage('Configura VITE_MAPBOX_ACCESS_TOKEN para calcular la distancia con Mapbox.', 'error');
    return;
  }

  const requestId = ++routeRequestId;
  routeController?.abort();
  currentRoute = null;
  mapRouteCoordinates = null;
  hasFittedRoute = false;
  clearCandidates('Calculando la ruta antes de consultar conductores.');
  tripSubmitted = false;
  requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
  renderFare();
  setRouteMessage('Calculando la distancia por carretera…');
  const controller = new AbortController();
  routeController = controller;

  const coordinates = [pickup.coordinates, destination.coordinates]
    .map((point) => point.join(','))
    .join(';');
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
  url.searchParams.set('access_token', MAPBOX_ACCESS_TOKEN);
  url.searchParams.set('overview', 'full');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('steps', 'false');

  try {
    const response = await fetch(url, { signal: controller.signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `Error ${response.status}`);
    if (result.code !== 'Ok' || !result.routes?.length) {
      throw new Error('Mapbox no encontró una ruta entre esos puntos.');
    }
    if (!Number.isFinite(result.routes[0].distance) || result.routes[0].distance <= 0) {
      throw new Error('La ruta debe tener una distancia mayor que cero.');
    }
    if (requestId !== routeRequestId) return;

    currentRoute = { distanceMeters: result.routes[0].distance };
    mapRouteCoordinates = result.routes[0].geometry?.coordinates || null;
    renderFare();
    renderMap();
    setRouteMessage('Ruta calculada por calles con Mapbox.', 'success');
    void refreshCandidates();
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== routeRequestId) return;
    currentRoute = null;
    renderFare();
    setRouteMessage(`No se pudo calcular la ruta: ${error.message}`, 'error');
  }
}

document.querySelectorAll('.ride-option').forEach((option) => {
  option.addEventListener('click', () => {
    selectedRide = option.dataset.ride;
    clearCandidates('Actualizando conductores para el vehículo elegido…');
    tripSubmitted = false;
    requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
    renderFare();
    setTripMessage('');
    void refreshCandidates();
  });
});

serviceOptions.forEach((option) => {
  option.addEventListener('click', () => {
    if (option.disabled) return;
    selectedService = option.dataset.service;
    tripSubmitted = false;
    requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
    renderCandidateList();
    renderFare();
    renderMap();
    setTripMessage('');
  });
});

function useCurrentLocation() {
  if (!navigator.geolocation) {
    setRouteMessage('Tu navegador no permite obtener la ubicación.', 'error');
    return;
  }

  setRouteMessage('Buscando tu ubicación…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const field = addressFields.pickup;
      const label = 'Mi ubicación actual';
      field.input.value = label;
      field.location = { label, coordinates: [coords.longitude, coords.latitude] };
      hideSuggestions(field);
      clearRouteCalculation();
      setRouteMessage('Ubicación agregada como punto de recogida.', 'success');
      if (addressFields.destination.location) void calculateRoute();
    },
    (error) => {
      setRouteMessage(`No pudimos obtener tu ubicación: ${error.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.querySelector('#locate-button').addEventListener('click', useCurrentLocation);
document.querySelector('#pickup-location').addEventListener('click', useCurrentLocation);

requestButton.addEventListener('click', async () => {
  const pickup = addressFields.pickup.location;
  const destination = addressFields.destination.location;
  const vehicleType = selectedRide;
  const serviceType = selectedService;
  const fareDetails = currentRoute && calculateFare(currentRoute.distanceMeters, vehicleType, serviceType);
  const eligibleDrivers = currentCandidates
    .filter((candidate) => candidate.service === serviceType)
    .sort((a, b) => a.etaMinutes - b.etaMinutes);
  const assignedDriver = eligibleDrivers[0];
  if (!pickup || !destination || !fareDetails) {
    setTripMessage('Selecciona el punto de recogida y el destino para calcular el precio.', 'error');
    return;
  }
  if (!assignedDriver) {
    setTripMessage('No hay conductores disponibles para esta modalidad. Actualiza la búsqueda antes de solicitar.', 'error');
    return;
  }

  requestInProgress = true;
  setBookingBusy(true);
  requestButton.querySelector('span:first-child').textContent = 'Enviando solicitud…';
  renderFare();
  setTripMessage('');

  try {
    const { error } = await supabase.rpc('request_trip', {
      p_pickup: pickup.label,
      p_destination: destination.label,
      p_pickup_latitude: pickup.coordinates[1],
      p_pickup_longitude: pickup.coordinates[0],
      p_destination_latitude: destination.coordinates[1],
      p_destination_longitude: destination.coordinates[0],
      p_vehicle_type: vehicleType,
      p_service_type: serviceType,
      p_distance_km: fareDetails.distanceKm,
      p_estimated_fare: fareDetails.fare,
      p_driver_id: assignedDriver.driver_id
    });
    if (error) throw error;

    tripSubmitted = true;
    setTripMessage(`Solicitud asignada a un conductor. Llegada estimada: ${assignedDriver.etaMinutes} min.`, 'success');
    void refreshCandidates();
  } catch (error) {
    setTripMessage(`No pudimos enviar tu solicitud: ${error.message}`, 'error');
  } finally {
    requestInProgress = false;
    setBookingBusy(false);
    requestButton.querySelector('span:first-child').textContent = tripSubmitted ? 'Solicitud enviada' : 'Solicitar viaje';
    renderFare();
  }
});

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    setAuthMessage(`No se pudo restaurar la sesión: ${error.message}`, 'error');
    return;
  }
  if (!data.session) return;
  try {
    await loadProfile(data.session.user);
  } catch (profileError) {
    setAuthMessage(profileError.message, 'error');
  }
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('No se pudo registrar el service worker:', error);
    });
  });
}

clearRideState();
void restoreSession();
