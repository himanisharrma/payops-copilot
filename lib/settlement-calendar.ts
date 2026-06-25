export const INDIA_TIMEZONE = "Asia/Kolkata" as const;
export const SETTLEMENT_CALENDAR_VERSION =
  "india-demo-calendar-v1" as const;

const INDIA_OFFSET_MINUTES = 5 * 60 + 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Deliberately fictional demonstration closures. This is not an RBI calendar.
const SYNTHETIC_CLOSURE_MONTH_DAYS = new Set([
  "01-02",
  "08-17",
  "11-13",
]);

export type BusinessDayResult = {
  date: string;
  skippedDates: string[];
};

function parseDateOnly(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid calendar date: ${value}`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }

  return date;
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function addCalendarDays(date: string, days: number) {
  const parsed = parseDateOnly(date);
  return formatDateOnly(new Date(parsed.getTime() + days * DAY_MS));
}

export function indiaDateParts(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid instant");

  const india = new Date(date.getTime() + INDIA_OFFSET_MINUTES * 60_000);
  return {
    date: india.toISOString().slice(0, 10),
    hour: india.getUTCHours(),
    minute: india.getUTCMinutes(),
    second: india.getUTCSeconds(),
    millisecond: india.getUTCMilliseconds(),
  };
}

export function indiaDateTime(
  date: string,
  hour: number,
  minute: number,
) {
  const parsed = parseDateOnly(date);
  return new Date(
    Date.UTC(
      parsed.getUTCFullYear(),
      parsed.getUTCMonth(),
      parsed.getUTCDate(),
      hour,
      minute,
    ) -
      INDIA_OFFSET_MINUTES * 60_000,
  );
}

export function isSyntheticHoliday(date: string) {
  parseDateOnly(date);
  return SYNTHETIC_CLOSURE_MONTH_DAYS.has(date.slice(5));
}

export function isBusinessDay(date: string) {
  const parsed = parseDateOnly(date);
  const weekday = parsed.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isSyntheticHoliday(date);
}

export function nextBusinessDay(date: string): BusinessDayResult {
  const skippedDates: string[] = [];
  let candidate = addCalendarDays(date, 1);

  while (!isBusinessDay(candidate)) {
    skippedDates.push(candidate);
    candidate = addCalendarDays(candidate, 1);
  }

  return { date: candidate, skippedDates };
}

export function normalizeBusinessDay(date: string): BusinessDayResult {
  if (isBusinessDay(date)) return { date, skippedDates: [] };

  const skippedDates = [date];
  let candidate = addCalendarDays(date, 1);
  while (!isBusinessDay(candidate)) {
    skippedDates.push(candidate);
    candidate = addCalendarDays(candidate, 1);
  }
  return { date: candidate, skippedDates };
}

export function addBusinessDays(
  date: string,
  businessDays: number,
): BusinessDayResult {
  if (!Number.isInteger(businessDays) || businessDays < 0) {
    throw new Error("Business-day count must be a non-negative integer");
  }

  const normalized = normalizeBusinessDay(date);
  const skippedDates = [...normalized.skippedDates];
  let candidate = normalized.date;

  for (let added = 0; added < businessDays; ) {
    candidate = addCalendarDays(candidate, 1);
    if (isBusinessDay(candidate)) {
      added += 1;
    } else {
      skippedDates.push(candidate);
    }
  }

  return { date: candidate, skippedDates };
}

export function businessDaysBetween(startDate: string, endDate: string) {
  const start = parseDateOnly(startDate).getTime();
  const end = parseDateOnly(endDate).getTime();
  if (end <= start) return 0;

  let count = 0;
  for (
    let timestamp = start + DAY_MS;
    timestamp <= end;
    timestamp += DAY_MS
  ) {
    if (isBusinessDay(formatDateOnly(new Date(timestamp)))) count += 1;
  }
  return count;
}
