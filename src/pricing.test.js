import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFare } from './pricing.js';

test('calculates express and economy fares for both vehicle types', () => {
  assert.deepEqual(calculateFare(5000, 'carro', 'express'), {
    distanceKm: 5,
    fare: 4.5,
    rate: 0.9
  });
  assert.deepEqual(calculateFare(5000, 'carro', 'economica'), {
    distanceKm: 5,
    fare: 4,
    rate: 0.8
  });
  assert.deepEqual(calculateFare(5000, 'moto', 'express'), {
    distanceKm: 5,
    fare: 2,
    rate: 0.4
  });
  assert.deepEqual(calculateFare(5000, 'moto', 'economica'), {
    distanceKm: 5,
    fare: 1.75,
    rate: 0.35
  });
});

test('rounds the route distance to meters before calculating the fare', () => {
  assert.deepEqual(calculateFare(12345.6, 'carro', 'express'), {
    distanceKm: 12.346,
    fare: 11.11,
    rate: 0.9
  });
});

test('rejects unknown vehicles and non-positive or invalid distances', () => {
  assert.throws(() => calculateFare(5000, 'bicycle', 'express'), /Tipo de vehículo/);
  assert.throws(() => calculateFare(5000, 'carro', 'unknown'), /Tipo de vehículo/);
  assert.throws(() => calculateFare(0, 'moto', 'express'), /mayor que cero/);
  assert.throws(() => calculateFare(Number.NaN, 'carro', 'express'), /mayor que cero/);
});
