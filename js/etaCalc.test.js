const assert = require('assert');
const { test } = require('node:test');
const {
  getSegmentDelays,
  applyFerryRest,
  scheduleDailyRest,
  calculateTrip
} = require('./etaCalc');

test('getSegmentDelays sums delays and flags ferry rest', () => {
  const refuelEvents = [{ segment: 1, delay: 1 }];
  const ferryEvent = { segment: 1, delay: 7 };
  const settings = { autoFerryRest: true, autoFerryRestThreshold: 6 };
  const info = getSegmentDelays(1, refuelEvents, ferryEvent, settings);
  assert.strictEqual(info.extraDelay, 8);
  assert.ok(info.delayNotes.includes('refuel 1.00h'));
  assert.ok(info.delayNotes.includes('ferry 7.00h'));
  assert.ok(info.ferryAsRest);
});

test('scheduleDailyRest advances time and resets duty', () => {
  const state = { currentTime: new Date('2023-01-01T00:00:00Z'), dutyUsed: 5, rests: [] };
  scheduleDailyRest(state, () => 11);
  assert.strictEqual(state.dutyUsed, 0);
  assert.strictEqual(state.rests.length, 1);
  assert.strictEqual(state.rests[0].duration, 11);
  assert.strictEqual(state.rests[0].start.toISOString(), '2023-01-01T00:00:00.000Z');
  assert.strictEqual(state.rests[0].end.toISOString(), '2023-01-01T11:00:00.000Z');
});

test('applyFerryRest schedules rest of type ferry', () => {
  const state = { currentTime: new Date('2023-01-01T00:00:00Z'), dutyUsed: 10, rests: [] };
  applyFerryRest(state, () => 11);
  assert.strictEqual(state.dutyUsed, 0);
  assert.strictEqual(state.rests[0].type, 'ferry');
});

test('calculateTrip respects duty cycle and schedules rests', () => {
  const start = new Date('2023-01-01T00:00:00Z');
  const result = calculateTrip({
    baseTime: 20,
    defaultAvailableTime: 9,
    firstSegmentAvailableTime: 9,
    driverType: 'single',
    speed: 80,
    startTime: start,
    refuelEvents: [],
    ferryEvent: {},
    settings: { delayMode: 'auto', autoFerryRest: true, autoFerryRestThreshold: 6 }
  });
  assert.strictEqual(result.segments.length, 3);
  assert.deepStrictEqual(result.segments.map(s => s.driveTime), [9, 9, 2]);
  assert.strictEqual(result.rests.length, 2);
  // Each duty period should be under 15h
  for (const seg of result.segments) {
    const duty = seg.driveTime + seg.inShiftBreak + seg.delayOnDuty;
    assert.ok(duty <= 15);
  }
});

test('calculateTrip counts qualifying ferry time toward daily rest', () => {
  const start = new Date('2023-01-01T00:00:00Z');
  const result = calculateTrip({
    baseTime: 10,
    defaultAvailableTime: 9,
    firstSegmentAvailableTime: 9,
    driverType: 'single',
    speed: 80,
    startTime: start,
    refuelEvents: [],
    ferryEvent: { segment: 1, delay: 7 },
    settings: { delayMode: 'auto', autoFerryRest: true, autoFerryRestThreshold: 6 }
  });

  assert.strictEqual(result.segments.length, 2);
  assert.strictEqual(result.segments[0].delayOnDuty, 0);
  assert.strictEqual(result.rests.length, 1);
  assert.strictEqual(result.rests[0].duration, 11);
  assert.strictEqual(result.rests[0].start.toISOString(), '2023-01-01T09:45:00.000Z');
  assert.strictEqual(result.rests[0].end.toISOString(), '2023-01-01T20:45:00.000Z');
});

test('calculateTrip attaches delay notes to segments', () => {
  const start = new Date('2023-01-01T00:00:00Z');
  const result = calculateTrip({
    baseTime: 5,
    defaultAvailableTime: 9,
    firstSegmentAvailableTime: 9,
    driverType: 'single',
    speed: 80,
    startTime: start,
    refuelEvents: [{ segment: 1, delay: 1 }],
    ferryEvent: { segment: 1, delay: 7 },
    settings: { delayMode: 'auto', autoFerryRest: true, autoFerryRestThreshold: 6 }
  });
  const notes = result.segments[0].delayNotes;
  assert.ok(Array.isArray(notes));
  assert.ok(notes.includes('refuel 1.00h'));
  assert.ok(notes.includes('ferry 7.00h'));
});

