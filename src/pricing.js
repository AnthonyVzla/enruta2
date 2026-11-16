export const VEHICLE_RATES = Object.freeze({
  carro: Object.freeze({ express: 0.9, economica: 0.8 }),
  moto: Object.freeze({ express: 0.4, economica: 0.35 })
});

export function calculateFare(distanceMeters, vehicleType, serviceType = 'express') {
  const rate = VEHICLE_RATES[vehicleType]?.[serviceType];
  if (!rate) throw new Error('Tipo de vehículo no válido.');
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    throw new Error('La distancia debe ser mayor que cero.');
  }

  const distanceKm = Math.round(distanceMeters) / 1000;
  const fare = Math.round(distanceKm * rate * 100 + Number.EPSILON) / 100;
  return { distanceKm, fare, rate };
}
