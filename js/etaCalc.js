  // ====== SETTINGS (v1.1) ======
  const SETTINGS = {
    dutyCapHours: { single: 15, two: 21 },   // daily spread caps
    delayMode: "auto",                       // off-duty by default; pull in as needed
    autoFerryRest: true,                     // default ON (toggle in UI)
    autoFerryRestThreshold: 6,               // hours
    preferReducedRestFirst: true             // prefer 9h before 11h
  };
  // Weekly counter for 9h reduced daily rests (reset with button)
  let WEEKLY_9H_RESTS_USED = 0;
  const forcedRests = new Set();


  // ====== GLOBALS ======
  let startTimeObj = null; // Safari-safe: captured from Flatpickr onChange

  // ====== UTILITIES ======
  function formatTime(date) {
    let h = date.getHours();
    let m = date.getMinutes();
    if (h < 10) h = '0' + h;
    if (m < 10) m = '0' + m;
    return h + ':' + m;
  }
  function formatDateTime(date) {
    const y = date.getFullYear();
    let mo = date.getMonth() + 1, d = date.getDate();
    if (mo < 10) mo = '0' + mo;
    if (d < 10) d = '0' + d;
    return y + '-' + mo + '-' + d + ' ' + formatTime(date);
  }
  function formatH(h) {
    const total = Math.round(h * 60);
    const hh = Math.floor(total / 60);
    const mm = total % 60;
    return `${hh}h ${mm.toString().padStart(2, "0")}m`;
  }

  // ====== INIT PICKER (Safari-safe) ======
  flatpickr("#startTime", {
    enableTime: true,
    dateFormat: "Y-m-d H:i",
    time_24hr: true,
    onChange: (selectedDates) => { startTimeObj = selectedDates[0] || null; }
  });

  // ====== I18N APPLY ======
  function updateLocalization() {
    currentLang = document.getElementById("languageSelect").value;
    const t = translations[currentLang];

    document.getElementById("calcTitle").innerText = t["title"];
    document.getElementById("drivingConfigLabel").innerText = t["drivingConfiguration"];
    document.getElementById("singleDriverLabel").innerText = t["singleDriver"];
    document.getElementById("twoDriversLabel").innerText = t["twoDrivers"];
    document.getElementById("customHoursLabel").innerText = t["customHours"];
    document.getElementById("distanceLabel").innerText = t["distance"];
    document.getElementById("speedLabel").innerText = t["speed"];
    document.getElementById("refuelsLabel").innerText = t["refuels"];
    document.getElementById("ferryTimeLabel").innerText = t["ferryTime"];
    document.getElementById("calcTripButton").innerText = t["calculateTrip"];
    document.getElementById("ferryDelayAssignmentHeader").innerText = t["ferryDelayAssignment"];
    document.getElementById("ferrySegmentLabel").innerText = t["applyFerryDelayInSegment"];
    document.getElementById("tripBreakdownAccordionButton").innerText = t["tripBreakdownResults"];
    document.getElementById("autoFerryRestLabel").innerText = t["autoFerryRestLabel"];
    document.getElementById("dutyRuleNote").innerText = t["dutyRuleNote"];
    document.getElementById("reducedRestsInfo").innerHTML =
      `${t["reducedInfo"]} <strong id="reducedCount">${WEEKLY_9H_RESTS_USED}</strong>/2`;

    // Floating button text
    var langButton = document.querySelector(".floating-lang-btn");
    langButton.textContent = currentLang === "en" ? "US" : (currentLang === "lt" ? "LT" : "RU");

    // regenerate refuel assignment text
    generateRefuelAssignments();
  }

  // ====== EVENT WIRING ======
  window.onload = function() {
    updateLocalization();
    updateFerryAssignmentVisibility();
    document.getElementById('reducedCount').innerText = WEEKLY_9H_RESTS_USED;
    document.getElementById('autoFerryRestToggle').checked = SETTINGS.autoFerryRest;
  };

  document.getElementById('ferryTime').addEventListener('input', updateFerryAssignmentVisibility);
  document.getElementById('refuels').addEventListener('input', function() {
    let v = parseInt(this.value) || 0; if (v > 10) this.value = 10;
    generateRefuelAssignments();
  });

  document.querySelectorAll('input[name="driverType"]').forEach(r => {
    r.addEventListener('change', () => {/* nothing extra needed; calculation uses it directly */});
  });

  document.getElementById('distance').addEventListener('input', ()=>{});
  document.getElementById('speed').addEventListener('input', ()=>{});
  document.getElementById('customHours').addEventListener('input', ()=>{});

  document.getElementById('resetWeekBtn').addEventListener('click', () => {
    WEEKLY_9H_RESTS_USED = 0;
    document.getElementById('reducedCount').innerText = WEEKLY_9H_RESTS_USED;
    updateLocalization();
  });

  document.getElementById('autoFerryRestToggle').addEventListener('change', (e) => {
    SETTINGS.autoFerryRest = e.target.checked;
  });

  // ====== UI HELPERS ======
  function updateFerryAssignmentVisibility() {
    var ferryTimeValue = parseFloat(document.getElementById('ferryTime').value) || 0;
    var c = document.getElementById('ferryAssignmentContainer');
    c.style.display = ferryTimeValue > 0 ? "block" : "none";
  }

  function generateRefuelAssignments() {
    const t = translations[currentLang];
    let refuelCount = parseInt(document.getElementById('refuels').value) || 0;
    let container = document.getElementById('refuelAssignmentsContainer');
    container.innerHTML = "";
    if (refuelCount > 0) {
      container.innerHTML += `<h5>${t["refuelDelayAssignments"] || "Refuel Delay Assignments"}</h5>`;
      for (let i = 0; i < refuelCount; i++) {
        const row = document.createElement('div');
        row.className = 'd-flex align-items-center mb-2';
        row.innerHTML = `
          <div class="me-2">${(t["refuelEvent"] || "Refuel event ")}${i+1}${(t["segment"] || " segment: ")}</div>
          <input type="number" class="refuelAssignment form-control" min="1" value="1" style="max-width:120px;">
        `;
        container.appendChild(row);
      }
    } else {
      container.innerHTML = `<p class="mb-0">${t["noRefuels"]}</p>`;
    }
  }

  // ====== CORE CALC (v1.1) ======
  function calculateTripWithDelays(
    baseTime,                    // hours to drive (distance / speed)
    defaultAvailableTime,        // 9 or 18
    firstSegmentAvailableTime,
    driverType,                  // "single" | "two"
    speed,                       // km/h
    startTime,                   // Date
    refuelEvents,                // [{segment, delay:1.0}, ...]
    ferryEvent,                  // {segment, delay:hours}
    forcedSet                    // Set of rest indexes forced to 9h
  ) {
    const breakdown = [];
    const segments = [];
    const rests = [];

    let restCounter = 0;

    const isSingle = (driverType === "single");
    const dutyCap = isSingle ? SETTINGS.dutyCapHours.single : SETTINGS.dutyCapHours.two;

    let currentTime = new Date(startTime.getTime());
    let remainingDrive = baseTime;
    let segmentIndex = 0;

    // Duty since last DAILY REST
    let dutyUsed = 0;

    // Warnings
    let warnings = [];

    function pickDailyRest() {
      restCounter++;
      if (forcedSet && forcedSet.has(restCounter)) {
        return 9;
      }
      return 11;
    }

    function getDelaysForSegment(segIdx) {
      let extraDelay = 0;
      let delayNotes = [];

      if (refuelEvents && refuelEvents.length) {
        refuelEvents.forEach(e => {
          if (e.segment === segIdx) {
            extraDelay += e.delay;
            delayNotes.push(`refuel ${e.delay.toFixed(2)}h`);
          }
        });
      }

      let ferryDelay = 0, ferryNote = "";
      let ferryAsRest = false;
      if (ferryEvent && ferryEvent.delay > 0 && ferryEvent.segment === segIdx) {
        ferryDelay = ferryEvent.delay;
        ferryNote = `ferry ${ferryDelay.toFixed(2)}h`;
        if (SETTINGS.autoFerryRest && ferryDelay >= SETTINGS.autoFerryRestThreshold) {
          ferryAsRest = true;
        }
      }
      extraDelay += ferryDelay;
      if (ferryNote) delayNotes.push(ferryNote);

      return { extraDelay, delayNotes, ferryAsRest, ferryDelay };
    }

    while (remainingDrive > 0) {
      segmentIndex++;
      const segmentAvail = (segmentIndex === 1 ? firstSegmentAvailableTime : defaultAvailableTime);

      const { extraDelay, delayNotes, ferryAsRest } = getDelaysForSegment(segmentIndex);

      let plannedDrive = Math.min(segmentAvail, remainingDrive);
      let inShiftBreak = 0;
      if (isSingle && plannedDrive > 4.5) inShiftBreak = 0.75;

      // AUTO delay behavior
      let countedDelay = extraDelay;
      let offDutyDelay = 0;

      if (SETTINGS.delayMode === "auto" && !ferryAsRest) {
        countedDelay = 0; // try keeping all delay off-duty
        let wouldBe = dutyUsed + plannedDrive + inShiftBreak;
        if (wouldBe > dutyCap) {
          // Trim driving to respect cap
          const overflow = wouldBe - dutyCap;
          plannedDrive = Math.max(0, plannedDrive - overflow);
          inShiftBreak = (isSingle && plannedDrive > 4.5) ? 0.75 : (plannedDrive > 0 ? 0 : 0);
        } else {
          // Pull just enough delay into duty, rest off-duty
          const room = dutyCap - (dutyUsed + plannedDrive + inShiftBreak);
          countedDelay = Math.min(extraDelay, room);
          offDutyDelay = extraDelay - countedDelay;
        }
      }

      // Two drivers: ensure we never exceed per-segment available after counted delay
      if (!isSingle) {
        const effectiveAvail = Math.max(0, segmentAvail - countedDelay);
        plannedDrive = Math.min(plannedDrive, effectiveAvail, remainingDrive);
      }

      const segmentDuty = plannedDrive + inShiftBreak + countedDelay;

      // Delay-only segment (no driving)
      if (plannedDrive === 0 && (countedDelay > 0 || offDutyDelay > 0)) {
        const startAt = new Date(currentTime);
        if (countedDelay > 0) {
          dutyUsed += countedDelay;
          currentTime = new Date(currentTime.getTime() + countedDelay * 3600000);
        }
        if (offDutyDelay > 0) {
          currentTime = new Date(currentTime.getTime() + offDutyDelay * 3600000);
        }
        const delayText = delayNotes.length ? ` (Extra: ${delayNotes.join(", ")})` : "";
        breakdown.push(
          `Segment ${segmentIndex}:\nStart at ${formatTime(startAt)}.\nDelay-only${delayText}\nEnd at ${formatTime(currentTime)}.`
        );
        if (ferryAsRest) {
          const restLen = pickDailyRest();
          const rs = new Date(currentTime);
          const re = new Date(currentTime.getTime() + restLen * 3600000);
          breakdown.push(`Daily rest (ferry as rest): ${formatH(restLen)} from ${formatTime(rs)} to ${formatTime(re)}.`);
          rests.push({ index: restCounter, start: rs, end: re, length: restLen });
          currentTime = re;
          dutyUsed = 0;
        }
        continue;
      }

      // Normal driving segment
      const segmentStart = new Date(currentTime);
      const distanceCovered = plannedDrive * speed;

      // Advance time for driving + in-shift + counted delay
      currentTime = new Date(currentTime.getTime() + segmentDuty * 3600000);
      dutyUsed += plannedDrive + inShiftBreak + countedDelay;

      if (offDutyDelay > 0) {
        const waitStart = new Date(currentTime);
        currentTime = new Date(currentTime.getTime() + offDutyDelay * 3600000);
        breakdown.push(`Off-duty wait: ${formatH(offDutyDelay)} from ${formatTime(waitStart)} to ${formatTime(currentTime)}.`);
      }

      remainingDrive -= plannedDrive;

      let driveDetails = isSingle
        ? (plannedDrive > 4.5
            ? `Drive ${formatH(4.5)}, 45m break, then drive ${formatH(plannedDrive - 4.5)}`
            : `Drive ${formatH(plannedDrive)}`)
        : `Drive ${plannedDrive.toFixed(2)}h`;

      const extras = [];
      if (inShiftBreak > 0) extras.push(`in-shift break ${formatH(inShiftBreak)}`);
      if (countedDelay > 0) extras.push(`on-duty delay ${formatH(countedDelay)}${delayNotes.length ? ` (${delayNotes.join(", ")})` : ""}`);
      if (offDutyDelay > 0) extras.push(`off-duty delay ${formatH(offDutyDelay)}${delayNotes.length ? ` (${delayNotes.join(", ")})` : ""}`);

      breakdown.push(
        `Segment ${segmentIndex}:\nStart at ${formatTime(segmentStart)}.\n` +
        `${driveDetails}, covering ${distanceCovered.toFixed(2)} km\n` +
        (extras.length ? `(${extras.join("; ")})\n` : "") +
        `${remainingDrive > 0 ? "End work at" : "End at"} ${formatTime(currentTime)}.`
      );

      segments.push({
        segmentIndex,
        startTime: new Date(segmentStart),
        driveTime: plannedDrive,
        delayOnDuty: countedDelay,
        delayOffDuty: offDutyDelay,
        inShiftBreak,
        endTime: new Date(currentTime)
      });

      // Auto ferry rest handling
      if (remainingDrive > 0 && ferryAsRest) {
        const restLen = pickDailyRest();
        const rs = new Date(currentTime);
        const re = new Date(currentTime.getTime() + restLen * 3600000);
        breakdown.push(`Daily rest (ferry as rest): ${formatH(restLen)} from ${formatTime(rs)} to ${formatTime(re)}.`);
        rests.push({ index: restCounter, start: rs, end: re, length: restLen });
        currentTime = re;
        dutyUsed = 0;
        continue;
      }

      // Need a daily rest between days if still driving remains
      if (remainingDrive > 0) {
        const restLen = pickDailyRest();
        const rs = new Date(currentTime);
        const re = new Date(currentTime.getTime() + restLen * 3600000);
        breakdown.push(`Daily rest: ${formatH(restLen)} from ${formatTime(rs)} to ${formatTime(re)}.`);
        rests.push({ index: restCounter, start: rs, end: re, length: restLen });
        currentTime = re;
        dutyUsed = 0;
      }
    }

    if (warnings.length) {
      breakdown.push("Warnings:\n- " + warnings.join("\n- "));
    }

    return { breakdown, finalTime: new Date(currentTime), rests };
  }

  // ====== CONTROLLER ======
  function calculateTripAndDisplay() {
    const t = translations[currentLang];

    if (!startTimeObj) {
      alert("Please select a start time.");
      return;
    }
    let startTime = new Date(startTimeObj.getTime());

    let driverType = document.querySelector('input[name="driverType"]:checked').value;
    let defaultAvailableTime = (driverType === "single" ? 9 : 18);
    let customTime = parseFloat(document.getElementById('customHours').value);
    let firstSegmentAvailableTime = (!isNaN(customTime) && customTime > 0 && customTime < defaultAvailableTime)
      ? customTime : defaultAvailableTime;

    let distance = parseFloat(document.getElementById('distance').value);
    let speed = parseFloat(document.getElementById('speed').value);
    if (isNaN(distance) || distance <= 0 || isNaN(speed) || speed <= 0) {
      alert("Please enter valid values for distance and speed.");
      return;
    }

    let baseDrivingTime = distance / speed;

    // read UI options
    SETTINGS.autoFerryRest = document.getElementById('autoFerryRestToggle').checked;

    // build refuel events
    let refuelEvents = [];
    let refuelCount = parseInt(document.getElementById('refuels').value) || 0;
    if (refuelCount > 0) {
      let refuelInputs = document.querySelectorAll('.refuelAssignment');
      refuelInputs.forEach(function(input) {
        let seg = parseInt(input.value);
        if (!seg || seg < 1) seg = 1;
        refuelEvents.push({ segment: seg, delay: 1.0 });
      });
    }

    // ferry event
    let ferryTimeMinutes = parseFloat(document.getElementById('ferryTime').value) || 0;
    let ferryDelay = ferryTimeMinutes / 60;
    let ferrySegment = 1;
    if (ferryDelay > 0) {
      ferrySegment = parseInt(document.getElementById('ferrySegment').value);
      if (!ferrySegment || ferrySegment < 1) ferrySegment = 1;
    }
    let ferryEvent = { segment: ferrySegment, delay: ferryDelay };

    // run calc
    let out = calculateTripWithDelays(
      baseDrivingTime,
      defaultAvailableTime,
      firstSegmentAvailableTime,
      driverType,
      speed,
      startTime,
      refuelEvents,
      ferryEvent,
      forcedRests
    );

    let totalTripHours = (out.finalTime - startTime) / 3600000;

      // render
      let resultHtml = `<strong>${t["finalEstimatedArrival"]}</strong> ${formatDateTime(out.finalTime)}<br>` +
                       `<strong>${t["totalTripDuration"]}</strong> ${totalTripHours.toFixed(2)}h<br><br>` +
                       `<strong>${t["tripBreakdown"]}</strong><div class='breakdown'>`;
      let restPtr = 0;
      out.breakdown.forEach(function(step) {
        if (step.startsWith("Daily rest")) {
          const r = out.rests[restPtr++];
          if (r.length === 11) {
            resultHtml += `<div class="rest-entry" data-index="${r.index}">${step} <button class="reduce-rest btn btn-link btn-sm">${t["reduceTo9h"]}</button></div>`;
          } else {
            resultHtml += `<div>${step}</div>`;
          }
        } else {
          resultHtml += `<div>${step}</div>`;
        }
      });
      resultHtml += `${t["destinationReached"]} ${formatDateTime(out.finalTime)}</div>`;

    document.getElementById("result").innerHTML = resultHtml;
    const reducedEl = document.getElementById('reducedCount');
    if (reducedEl) reducedEl.innerText = WEEKLY_9H_RESTS_USED;

    // expand accordion
    var collapseElement = document.getElementById('collapseBreakdown');
    var bsCollapse = bootstrap.Collapse.getInstance(collapseElement);
    if (!bsCollapse) { bsCollapse = new bootstrap.Collapse(collapseElement, {toggle: false}); }
    bsCollapse.show();
  }

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('reduce-rest')) {
    const restEl = e.target.closest('.rest-entry');
    if (!restEl) return;
    const idx = parseInt(restEl.getAttribute('data-index'));
    if (isNaN(idx)) return;
    if (WEEKLY_9H_RESTS_USED >= 2) return;
    forcedRests.add(idx);
    WEEKLY_9H_RESTS_USED++;
    const reducedEl = document.getElementById('reducedCount');
    if (reducedEl) reducedEl.innerText = WEEKLY_9H_RESTS_USED;
    calculateTripAndDisplay();
  }
});
