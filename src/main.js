import './style.css';

const SUPABASE_URL = 'https://dvkusfutsnygppvtbxmg.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_TJDfKd2G-C0bFCB_3hnKGg_U68DBDNz';

document.querySelector('.greeting .eyebrow').textContent = new Intl.DateTimeFormat('es', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
}).format(new Date()).toLocaleUpperCase('es');

const rideOptions = [...document.querySelectorAll('.ride-option')];
const fare = document.querySelector('#fare');
const statusMessage = document.querySelector('#status-message');
const requestButton = document.querySelector('#request-ride');
const pickupInput = document.querySelector('#pickup');
const destinationInput = document.querySelector('#destination');
let selectedRide = 'comfort';

const fares = { comfort: '3.50', moto: '2.20' };

rideOptions.forEach((option) => {
  option.addEventListener('click', () => {
    selectedRide = option.dataset.ride;
    rideOptions.forEach((ride) => {
      const selected = ride === option;
      ride.classList.toggle('selected', selected);
      ride.setAttribute('aria-checked', String(selected));
    });
    fare.innerHTML = `$${fares[selectedRide]} <small>USD</small>`;
    statusMessage.textContent = '';
  });
});

function useCurrentLocation() {
  if (!navigator.geolocation) {
    statusMessage.textContent = 'Tu navegador no permite obtener la ubicación.';
    statusMessage.className = 'status-message error';
    return;
  }

  statusMessage.textContent = 'Buscando tu ubicación…';
  statusMessage.className = 'status-message';
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      pickupInput.value = `Mi ubicación (${coords.latitude.toFixed(5)}, ${coords.longitude.toFixed(5)})`;
      statusMessage.textContent = 'Ubicación agregada como punto de recogida.';
      statusMessage.className = 'status-message success';
    },
    () => {
      statusMessage.textContent = 'No pudimos obtener tu ubicación. Revisa los permisos del navegador.';
      statusMessage.className = 'status-message error';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.querySelector('#locate-button').addEventListener('click', useCurrentLocation);
document.querySelector('#pickup-location').addEventListener('click', useCurrentLocation);

requestButton.addEventListener('click', async () => {
  const pickup = pickupInput.value.trim();
  const destination = destinationInput.value.trim();
  if (pickup.length < 3 || destination.length < 3) {
    statusMessage.textContent = 'Escribe un punto de recogida y un destino para continuar.';
    statusMessage.className = 'status-message error';
    (pickup.length < 3 ? pickupInput : destinationInput).focus();
    return;
  }

  requestButton.disabled = true;
  requestButton.querySelector('span:first-child').textContent = 'Enviando solicitud…';
  statusMessage.textContent = '';
  statusMessage.className = 'status-message';

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/trips`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({
        pickup,
        destination,
        vehicle_type: selectedRide,
        estimated_fare: Number(fares[selectedRide])
      })
    });

    if (!response.ok) {
      const details = await response.json().catch(() => null);
      throw new Error(details?.message || details?.hint || `Error ${response.status}`);
    }

    statusMessage.textContent = '¡Solicitud enviada! Te avisaremos cuando un conductor la acepte.';
    statusMessage.className = 'status-message success';
    requestButton.querySelector('span:first-child').textContent = 'Solicitud enviada';
    requestButton.classList.add('submitted');
  } catch (error) {
    statusMessage.textContent = `No pudimos enviar tu solicitud. ${error.message}`;
    statusMessage.className = 'status-message error';
    requestButton.disabled = false;
    requestButton.querySelector('span:first-child').textContent = 'Solicitar viaje';
  }
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((error) => {
      console.error('No se pudo registrar el service worker:', error);
    });
  });
}
