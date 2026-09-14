// npm run check   (node --experimental-strip-types src/derive.check.mts)
//
// Covers only the derivations that would fail silently on a phone: a cadence
// that never changes, a bubble that lies, an offer shown after its TTL, and a
// blocker table that lets a driver go online on a phone that will kill the
// service.
//
// No test runner and no `node:` imports on purpose: the project's TypeScript
// resolves under the `react-native` condition, where node builtins do not, and
// a throw already fails the process.
import type { PermissionState, Permissions } from 'expo-field-agent';

import { blockers, bubbleFor, intervalFor, nativeMissing, noticeFor, remainingMs, serviceFromStep, serviceLost } from './derive.ts';

let checks = 0;

function test(what: string, run: () => void): void {
  run();
  checks += 1;
  console.log(`ok  ${what}`);
}

const assert = {
  equal(actual: unknown, expected: unknown): void {
    if (actual !== expected) throw new Error(`attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown): void {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`attendu ${JSON.stringify(expected)}, obtenu ${JSON.stringify(actual)}`);
    }
  },
  ok(value: unknown): void {
    if (!value) throw new Error('attendu vrai');
  },
};

const perms = (over: Partial<Permissions> = {}): Permissions => ({
  location: 'granted',
  backgroundLocation: 'granted',
  notifications: 'granted',
  overlay: 'granted',
  batteryUnrestricted: 'granted',
  dndAccess: 'granted',
  fullScreenIntent: 'granted',
  notificationAccess: 'unsupported',
  autostart: 'granted',
  ...over,
});

test('bubble: offline shows nothing, states map to their colour', () => {
  assert.equal(bubbleFor('OFFLINE', 0, false), null);
  assert.deepEqual(bubbleFor('IDLE', 0, false), ['ok', 'En ligne']);
  assert.deepEqual(bubbleFor('OFFERED', 0, false), ['urgent', 'Nouvelle course']);
  assert.deepEqual(bubbleFor('TO_PICKUP', 0, false), ['warn', 'Vers le client']);
  assert.deepEqual(bubbleFor('ARRIVED', 0, false), ['warn', 'Sur place']);
  assert.deepEqual(bubbleFor('IN_TRIP', 0, false), ['ok', 'Course en cours']);
});

test('bubble: a backlog and a lost permission outrank the step', () => {
  assert.deepEqual(bubbleFor('IN_TRIP', 7, false), ['warn', 'Hors réseau']);
  assert.deepEqual(bubbleFor('IN_TRIP', 7, true), ['bad', 'Localisation coupée']);
  assert.equal(bubbleFor('OFFLINE', 7, true), null);
});

test('cadence: waiting follows the setting, a trip does not', () => {
  assert.equal(intervalFor('OFFLINE', 60), null);
  assert.equal(intervalFor('IDLE', 60), 60);
  assert.equal(intervalFor('OFFERED', 10), 10);
  assert.equal(intervalFor('TO_PICKUP', 60), 5);
  assert.equal(intervalFor('ARRIVED', 60), 10);
  assert.equal(intervalFor('IN_TRIP', 60), 5);
});

test('a killed process comes back on the step the server remembers', () => {
  assert.equal(serviceFromStep(null), 'TO_PICKUP');
  assert.equal(serviceFromStep('arrived'), 'ARRIVED');
  assert.equal(serviceFromStep('started'), 'IN_TRIP');
});

test('countdown is spent when the engine boot ate the TTL', () => {
  const receivedAt = 1_000_000;
  assert.equal(remainingMs(receivedAt, 30, receivedAt + 3_000), 27_000);
  assert.ok(remainingMs(receivedAt, 3, receivedAt + 4_000) < 0);
});

test('blockers: the three required, plus autostart only when undetermined', () => {
  assert.deepEqual(blockers(perms()), []);
  assert.deepEqual(blockers(perms({ backgroundLocation: 'denied' })), ['backgroundLocation']);
  assert.deepEqual(blockers(perms({ autostart: 'undetermined' })), ['autostart']);
  // A brand with no autostart screen must not block anything.
  assert.deepEqual(blockers(perms({ autostart: 'unsupported' })), []);
  // Nothing read yet is not the same as nothing needed.
  assert.equal(blockers(null).length, 3);
  // The notification bridge is opt-in comfort: it must never hold a shift back.
  assert.deepEqual(blockers(perms({ notificationAccess: 'denied' })), []);
});

test('la notification de service suit l\'etape et porte le numero de course', () => {
  assert.equal(noticeFor('OFFLINE', null), null);
  assert.deepEqual(noticeFor('IDLE', null), { title: 'En ligne', body: 'En attente de course.' });
  // Une offre ne change pas encore la notification : rien n'est accepte.
  assert.deepEqual(noticeFor('OFFERED', null), { title: 'En ligne', body: 'En attente de course.' });
  assert.equal(noticeFor('TO_PICKUP', '1234')?.title, 'Course #1234');
  assert.equal(noticeFor('ARRIVED', '1234')?.body, 'Sur place, en attente du client.');
  assert.equal(noticeFor('IN_TRIP', '1234')?.body, 'Course en cours.');
  // Sans numero connu, on ne fabrique pas un « Course #null ».
  assert.equal(noticeFor('IN_TRIP', null)?.title, 'En service');
});

test('tout en unsupported = module natif absent (Expo Go), pas un iPhone', () => {
  const everything = (state: PermissionState) =>
    Object.fromEntries(Object.keys(perms()).map((key) => [key, state])) as Permissions;
  assert.equal(nativeMissing(everything('unsupported')), true);
  assert.equal(nativeMissing(null), false);
  // Un iPhone : overlay, autostart et le pont sont indisponibles, pas la position.
  assert.equal(nativeMissing(perms({ overlay: 'unsupported', autostart: 'unsupported', fullScreenIntent: 'unsupported' })), false);
});

test('a queue is not an outage; a dead service or a stale fix is', () => {
  const now = 2_000_000;
  const base = { running: true, queued: 0, lastFixAt: now - 1_000, lastSentAt: now, lastError: null };
  assert.equal(serviceLost(null, now), false);
  assert.equal(serviceLost({ ...base, queued: 900 }, now), false);
  assert.equal(serviceLost({ ...base, running: false }, now), true);
  assert.equal(serviceLost({ ...base, lastFixAt: now - 11 * 60 * 1000 }, now), true);
  // Running, never a fix yet: starting up, not lost.
  assert.equal(serviceLost({ ...base, lastFixAt: null }, now), false);
});

console.log(`\n${checks} vérifications passées.`);
