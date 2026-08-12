(function attachTimeControls(globalScope) {
  "use strict";

  const MINUTES_PER_DAY = 1440;
  const PLAYBACK_STEPS = Object.freeze([15, 60, 180]);

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function parseLocal(dateText, timeText = "00:00") {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ""));
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText || "00:00"));
    if (!dateMatch || !timeMatch) return null;
    const [, year, month, day] = dateMatch.map(Number);
    const [, hours, minutes] = timeMatch.map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) return null;
    const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
    if (
      date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ||
      date.getHours() !== hours || date.getMinutes() !== minutes
    ) return null;
    return date;
  }

  function toInputValues(value) {
    const date = validDate(value);
    if (!date) return null;
    return {
      date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
      time: `${pad(date.getHours())}:${pad(date.getMinutes())}`,
    };
  }

  function addElapsedMinutes(value, minutes) {
    const date = validDate(value);
    const amount = Number(minutes);
    return date && Number.isFinite(amount) ? new Date(date.getTime() + amount * 60000) : null;
  }

  function addCalendarDays(value, days) {
    const date = validDate(value);
    const amount = Number(days);
    if (!date || !Number.isFinite(amount)) return null;
    date.setDate(date.getDate() + Math.trunc(amount));
    return date;
  }

  function minuteOfDay(value) {
    const date = validDate(value);
    return date ? date.getHours() * 60 + date.getMinutes() : null;
  }

  function atMinuteOfDay(value, minuteValue) {
    const date = validDate(value);
    const minute = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(Number(minuteValue) || 0)));
    if (!date) return null;
    date.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    return date;
  }

  function normalizePlaybackStep(value) {
    const number = Number(value);
    return PLAYBACK_STEPS.includes(number) ? number : 60;
  }

  function windowSegments(startMinuteValue, durationMinutesValue) {
    const startMinute = Math.max(0, Math.min(MINUTES_PER_DAY, Number(startMinuteValue) || 0));
    const durationMinutes = Math.max(0, Math.min(MINUTES_PER_DAY, Number(durationMinutesValue) || 0));
    const firstDuration = Math.min(durationMinutes, MINUTES_PER_DAY - startMinute);
    const overflowDuration = Math.max(0, durationMinutes - firstDuration);
    return {
      primary: {
        leftPercent: startMinute / MINUTES_PER_DAY * 100,
        widthPercent: firstDuration / MINUTES_PER_DAY * 100,
      },
      overflow: {
        leftPercent: 0,
        widthPercent: overflowDuration / MINUTES_PER_DAY * 100,
      },
      crossesMidnight: overflowDuration > 0,
    };
  }

  const api = Object.freeze({
    MINUTES_PER_DAY,
    PLAYBACK_STEPS,
    addCalendarDays,
    addElapsedMinutes,
    atMinuteOfDay,
    minuteOfDay,
    normalizePlaybackStep,
    parseLocal,
    toInputValues,
    windowSegments,
  });

  globalScope.AstroTimeControls = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
