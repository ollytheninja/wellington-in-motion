import type { Clock } from "../clock/clock";
import { formatTime } from "../clock/clock";

export const SPEEDS = [
  { label: "1x", value: 1 },
  { label: "1 min/s", value: 60 },
  { label: "5 min/s", value: 300 },
  { label: "12 min/s (day in 2 min)", value: 720 },
  { label: "30 min/s", value: 1800 },
  { label: "1 hr/s", value: 3600 },
];
export const DEFAULT_SPEED = 720;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface Controls {
  /** Reflect the clock and train count in the UI. Call every frame. */
  update(clock: Clock, running: number): void;
  /** Match the scrubber to the clock's window. Call after `clock.setRange`. */
  syncRange(clock: Clock): void;
}

export function setupControls(
  clock: Clock,
  opts: { dates: string[]; date: string; onDate(date: string): void; onBasemap(on: boolean): void },
): Controls {
  const play = $<HTMLButtonElement>("play");
  const scrub = $<HTMLInputElement>("scrub");
  const speed = $<HTMLSelectElement>("speed");
  const dateInput = $<HTMLInputElement>("date");
  const clockEl = $("clock");
  const countEl = $("count");

  const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  dateInput.min = iso(opts.dates[0]!);
  dateInput.max = iso(opts.dates[opts.dates.length - 1]!);
  dateInput.value = iso(opts.date);
  dateInput.addEventListener("change", () => {
    const d = dateInput.value.replaceAll("-", "");
    if (opts.dates.includes(d)) opts.onDate(d);
  });

  for (const s of SPEEDS) speed.add(new Option(s.label, String(s.value), false, s.value === clock.speed));
  speed.addEventListener("change", () => (clock.speed = +speed.value));

  const syncPlay = () => (play.textContent = clock.playing ? "Pause" : "Play");
  play.addEventListener("click", () => {
    clock.playing = !clock.playing;
    syncPlay();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space" && (e.target as HTMLElement).tagName !== "INPUT") {
      e.preventDefault();
      play.click();
    }
  });

  let dragging = false;
  scrub.addEventListener("pointerdown", () => (dragging = true));
  window.addEventListener("pointerup", () => (dragging = false));
  scrub.addEventListener("input", () => clock.seek(+scrub.value));

  $<HTMLInputElement>("basemap").addEventListener("change", (e) => opts.onBasemap((e.target as HTMLInputElement).checked));

  syncPlay();
  const syncRange = (c: Clock) => {
    scrub.min = String(c.min);
    scrub.max = String(c.max);
  };
  syncRange(clock);
  return {
    syncRange,
    update(c, running) {
      clockEl.textContent = formatTime(c.t);
      if (!dragging) scrub.value = String(Math.round(c.t));
      countEl.textContent = `${running} train${running === 1 ? "" : "s"} running`;
    },
  };
}
