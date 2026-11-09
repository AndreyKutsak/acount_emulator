// Wall-clock helpers for a named IANA time zone, built on Intl only. Schedules are
// written in local time ("09:00–21:00 Europe/Kyiv") while the server may run in UTC.

const DEFAULT_TIMEZONE =
  process.env.TELEGRAM_AUTOCOMMENT_TIMEZONE ||
  process.env.STEALTH_TIMEZONE ||
  "Europe/Kyiv";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map();

function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

function formatter(timeZone) {
  if (!formatters.has(timeZone)) {
    formatters.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        weekday: "short",
      }),
    );
  }
  return formatters.get(timeZone);
}

// { year, month, day, hour, minute, second, weekday (0 = Sunday) } as seen on a
// clock in that zone.
function zonedParts(date, timeZone) {
  const parts = {};
  for (const { type, value } of formatter(timeZone).formatToParts(date)) {
    parts[type] = value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

function offsetMs(date, timeZone) {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// The instant at which the zone's clock shows `minutesOfDay` on the given day.
// Re-checked once so days with a DST switch still land on the right instant.
function zonedTimeToDate({ year, month, day }, minutesOfDay, timeZone) {
  const wallClock = Date.UTC(year, month - 1, day, 0, minutesOfDay);
  let ts = wallClock - offsetMs(new Date(wallClock), timeZone);
  const corrected = wallClock - offsetMs(new Date(ts), timeZone);
  if (corrected !== ts) ts = corrected;
  return new Date(ts);
}

function dayKey({ year, month, day }) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "09:30" -> 570; null when malformed.
function parseHHMM(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes > 0)) return null;
  return hours * 60 + minutes;
}

module.exports = {
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  zonedParts,
  zonedTimeToDate,
  dayKey,
  parseHHMM,
};
