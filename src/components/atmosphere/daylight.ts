export interface Daylight {
  localHour: number;
  daylight: number;
  twilight: number;
  sunX: number;
  sunY: number;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => {
  const bounded = clamp(value);
  return bounded * bounded * (3 - 2 * bounded);
};

/** A decorative clock based cycle, rather than an astronomical sunrise forecast. */
export function daylightAt(instant: Date, timezone: string): Daylight {
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Invalid atmosphere time");
  let parts: Intl.DateTimeFormatPart[];
  const options: Intl.DateTimeFormatOptions = {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
  };
  try {
    parts = new Intl.DateTimeFormat("en-GB", options).formatToParts(instant);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).formatToParts(instant);
  }
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const localHour = (value("hour") % 24) + value("minute") / 60 + value("second") / 3600;
  const sunElevation = Math.sin(((localHour - 6) / 12) * Math.PI);
  return {
    localHour,
    daylight: smooth((sunElevation + 0.12) / 0.9),
    twilight: 1 - smooth(Math.abs(sunElevation) / 0.32),
    sunX: clamp((localHour - 5) / 14),
    sunY: 0.18 + Math.max(0, sunElevation) * 0.63,
  };
}
