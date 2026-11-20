// Spintax: "{Great|Nice|Cool} post{!|!!}" expands to one random variant per use, so
// a handful of templates produce many distinct comments. Groups may be nested
// ("{a|{b|c}}"). Braces without a "|" inside are left untouched.

const GROUP = /\{([^{}]*\|[^{}]*)\}/;
const MAX_STEPS = 1000;

function pick(options) {
  return options[Math.floor(Math.random() * options.length)];
}

// Привітання за порою доби (час за THREADS_TZ, типово Київ). Уночі нейтральне слово:
// «Доброї ночі» звучить як побажання перед сном, а не як привітання.
const TZ = process.env.THREADS_TZ || "Europe/Kiev";
const GREETINGS = {
  morning: ["Доброго ранку", "Добрий ранок"],
  day: ["Добрий день", "Доброго дня"],
  evening: ["Добрий вечір", "Доброго вечора"],
  night: ["Вітаю", "Привіт"],
};

function dayPart(now = new Date()) {
  let hour;
  try {
    hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(now));
  } catch {
    hour = now.getHours();
  }
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "day";
  if (hour >= 18 && hour < 23) return "evening";
  return "night";
}

// Будь-яке привітання з порою доби в тексті («Добрий день», «Доброго ранку», ...)
// замінюється на те, що відповідає поточному часу: так «Добрий день» не потрапляє
// у відповідь о 8 ранку чи 22 вечора, навіть якщо його вписано в правило.
const TIMED_GREETING = /(?<![\p{L}])(?:добр(?:ий|ого)\s+(?:день|дня|ранок|ранку|вечір|вечора)|доброї\s+ночі)(?![\p{L}])/giu;
const GREETING_TOKEN = /\{(?:привітання|greeting)\}/giu;

function applyDayPart(text, now) {
  const options = GREETINGS[dayPart(now)];
  const fit = (match) => {
    const word = pick(options);
    return /^\p{Lu}/u.test(match) ? word : word.charAt(0).toLowerCase() + word.slice(1);
  };
  return text.replace(GREETING_TOKEN, () => pick(options)).replace(TIMED_GREETING, fit);
}

// { now } - лише для тестів.
function render(text, { now } = {}) {
  let out = String(text || "");
  // Innermost groups contain no braces, so resolving them first unwraps nesting.
  for (let step = 0; step < MAX_STEPS && GROUP.test(out); step += 1) {
    out = out.replace(GROUP, (_, body) => pick(body.split("|")));
  }
  out = applyDayPart(out, now);
  return out.replace(/[ \t]{2,}/g, " ").trim();
}

// Distinct sample renders, for previewing a template in the UI.
function samples(text, count = 5) {
  const seen = new Set();
  for (let i = 0; i < count * 10 && seen.size < count; i += 1) {
    seen.add(render(text));
  }
  return [...seen];
}

module.exports = { render, samples, dayPart };
