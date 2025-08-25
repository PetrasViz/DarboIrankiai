const DEFAULT_SETTINGS = {
  delayMode: 'auto',
  autoFerryRest: true,
  autoFerryRestThreshold: 6,
  dutyCapHours: { single: 15, two: 21 }
};

function getSegmentDelays(segmentIndex, refuelEvents = [], ferryEvent = {}, settings = DEFAULT_SETTINGS) {
  let extraDelay = 0;
  const delayNotes = [];

  for (const e of refuelEvents) {
    if (e.segment === segmentIndex) {
      extraDelay += e.delay;
      delayNotes.push(`refuel ${e.delay.toFixed(2)}h`);
    }
  }

  let ferryAsRest = false;
  let ferryDelay = 0;
  if (ferryEvent && ferryEvent.segment === segmentIndex && ferryEvent.delay > 0) {
    ferryDelay = ferryEvent.delay;
    extraDelay += ferryDelay;
    delayNotes.push(`ferry ${ferryDelay.toFixed(2)}h`);
    if (settings.autoFerryRest && ferryDelay >= (settings.autoFerryRestThreshold || 0)) {
      ferryAsRest = true;
    }
  }

  return { extraDelay, delayNotes, ferryAsRest, ferryDelay };
}

function scheduleRest(state, pickDailyRest, type) {
  const len = pickDailyRest();
  const start = new Date(state.currentTime);
  state.currentTime = new Date(state.currentTime.getTime() + len * 3600000);
  state.dutyUsed = 0;
  state.rests.push({ type, start, end: new Date(state.currentTime), duration: len });
}

function applyFerryRest(state, pickDailyRest) {
  scheduleRest(state, pickDailyRest, 'ferry');
}

function scheduleDailyRest(state, pickDailyRest) {
  scheduleRest(state, pickDailyRest, 'daily');
}

function calculateTrip(params) {
  const {
    baseTime,
    defaultAvailableTime,
    firstSegmentAvailableTime,
    driverType,
    speed,
    startTime,
    refuelEvents = [],
    ferryEvent = {},
    settings = {},
    pickDailyRest = () => 11
  } = params;

  const mergedSettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    dutyCapHours: { ...DEFAULT_SETTINGS.dutyCapHours, ...(settings.dutyCapHours || {}) }
  };

  const state = {
    currentTime: new Date(startTime),
    dutyUsed: 0,
    segments: [],
    rests: [],
    warnings: [],
    settings: mergedSettings,
    isSingle: driverType === 'single'
  };

  const dutyCap = mergedSettings.dutyCapHours[state.isSingle ? 'single' : 'two'];

  let remainingDrive = baseTime;
  let segmentIndex = 0;

  while (remainingDrive > 0) {
    segmentIndex++;
    const segmentAvail = segmentIndex === 1 ? firstSegmentAvailableTime : defaultAvailableTime;

    const { extraDelay, ferryAsRest } = getSegmentDelays(segmentIndex, refuelEvents, ferryEvent, mergedSettings);

    let plannedDrive = Math.min(segmentAvail, remainingDrive);
    let inShiftBreak = (state.isSingle && plannedDrive > 4.5) ? 0.75 : 0;

    let countedDelay = extraDelay;
    let offDutyDelay = 0;

    if (mergedSettings.delayMode === 'auto' && !ferryAsRest) {
      countedDelay = 0;
      const wouldBe = state.dutyUsed + plannedDrive + inShiftBreak;
      if (wouldBe > dutyCap) {
        const overflow = wouldBe - dutyCap;
        plannedDrive = Math.max(0, plannedDrive - overflow);
        inShiftBreak = (state.isSingle && plannedDrive > 4.5) ? 0.75 : 0;
      } else {
        const room = dutyCap - (state.dutyUsed + plannedDrive + inShiftBreak);
        countedDelay = Math.min(extraDelay, room);
        offDutyDelay = extraDelay - countedDelay;
      }
    }

    if (!state.isSingle) {
      const effectiveAvail = Math.max(0, segmentAvail - countedDelay);
      plannedDrive = Math.min(plannedDrive, effectiveAvail, remainingDrive);
    }

    const segmentDuty = plannedDrive + inShiftBreak + countedDelay;
    const startSegTime = new Date(state.currentTime);

    if (plannedDrive === 0 && segmentDuty > 0) {
      if (countedDelay > 0) {
        state.dutyUsed += countedDelay;
        state.currentTime = new Date(state.currentTime.getTime() + countedDelay * 3600000);
      }
      if (offDutyDelay > 0) {
        state.currentTime = new Date(state.currentTime.getTime() + offDutyDelay * 3600000);
      }
      state.segments.push({
        index: segmentIndex,
        start: startSegTime,
        end: new Date(state.currentTime),
        driveTime: 0,
        delayOnDuty: countedDelay,
        delayOffDuty: offDutyDelay,
        inShiftBreak
      });

      if (remainingDrive > 0 && ferryAsRest) {
        applyFerryRest(state, pickDailyRest);
        continue;
      }
      if (remainingDrive > 0) {
        scheduleDailyRest(state, pickDailyRest);
      }
      continue;
    }

    state.currentTime = new Date(state.currentTime.getTime() + segmentDuty * 3600000);
    state.dutyUsed += segmentDuty;

    if (offDutyDelay > 0) {
      state.currentTime = new Date(state.currentTime.getTime() + offDutyDelay * 3600000);
    }

    remainingDrive -= plannedDrive;

    state.segments.push({
      index: segmentIndex,
      start: startSegTime,
      end: new Date(state.currentTime),
      driveTime: plannedDrive,
      delayOnDuty: countedDelay,
      delayOffDuty: offDutyDelay,
      inShiftBreak
    });

    if (remainingDrive > 0 && ferryAsRest) {
      applyFerryRest(state, pickDailyRest);
      continue;
    }
    if (remainingDrive > 0) {
      scheduleDailyRest(state, pickDailyRest);
    }
  }

  return {
    segments: state.segments,
    rests: state.rests,
    warnings: state.warnings
  };
}

module.exports = {
  getSegmentDelays,
  applyFerryRest,
  scheduleDailyRest,
  calculateTrip
};

