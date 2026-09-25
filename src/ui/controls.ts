import type { Clock } from "../clock/clock";
import { formatTime } from "../clock/clock";
import { autoHide } from "./autohide";
import type { Mode } from "../data/load";
import type { Counts } from "../render/scene";

export const SPEEDS = [
  { label: "1x", value: 1 },
  { label: "1 min/s", value: 60 },
  { label: "5 min/s", value: 300 },
  { label: "12 min/s", value: 720 },
  { label: "30 min/s", value: 1800 },
  { label: "1 hr/s", value: 3600 },
];
export const DEFAULT_SPEED = 720;

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 4.5v15l13-7.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z" fill="currentColor"/></svg>';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** How long a span of real seconds takes to say, to about two figures. */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}

export interface Controls {
  /** Reflect the clock and train count in the UI. Call every frame. */
  update(clock: Clock, counts: Counts): void;
  /** The most vehicles at once today for each mode, which is what a full bar means. Null while a mode is still loading. */
  setPeaks(peaks: Record<Mode, number | null>): void;
  /** Buses load after trains. Enables the Buses checkbox once they are in. */
  busesReady(): void;
  /** Show `date` (YYYYMMDD) in the date picker. */
  showDate(date: string): void;
  /** Show `speed` as the selected speed. */
  showSpeed(speed: number): void;
  /** Match the scrubber to the clock's window. Call after `clock.setRange`. */
  syncRange(clock: Clock): void;
}

export function setupControls(
  clock: Clock,
  opts: { dates: string[]; date: string; onDate(date: string): void; onNow(): void; onBuses(on: boolean): void },
): Controls {
  const play = $<HTMLButtonElement>("play");
  const loopBox = $<HTMLInputElement>("loop");
  const scrub = $<HTMLInputElement>("scrub");
  const speed = $<HTMLSelectElement>("speed");
  const dateInput = $<HTMLInputElement>("date");
  const clockEl = $("clock");
  const meters = Object.fromEntries(
    (["rail", "ferry", "bus"] as const).map((mode) => {
      const row = document.querySelector<HTMLElement>(`.meter[data-mode="${mode}"]`)!;
      return [mode, { row, fill: row.querySelector<HTMLElement>("i")!, num: row.querySelector<HTMLElement>(".n")! }];
    }),
  ) as Record<Mode, { row: HTMLElement; fill: HTMLElement; num: HTMLElement }>;
  const peaks: Record<Mode, number | null> = { rail: null, ferry: null, bus: null };
  let shownTime = "";
  let shownPos = "";
  const shown: Record<Mode, string> = { rail: "", ferry: "", bus: "" };

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
  /** The play window changes with the date and the modes loaded, so "day in ..." is worked out from it. */
  const labelSpeeds = (c: Clock) => {
    SPEEDS.forEach((s, i) => (speed.options[i]!.text = `${s.label} (day in ${formatDuration((c.max - c.min) / s.value)})`));
  };

  let shownPlaying: boolean | null = null;
  const syncPlay = () => {
    if (shownPlaying === clock.playing) return;
    shownPlaying = clock.playing;
    play.innerHTML = clock.playing ? ICON_PAUSE : ICON_PLAY;
    play.setAttribute("aria-label", clock.playing ? "Pause" : "Play");
  };
  play.addEventListener("click", () => {
    // Pressing play at the end of the day starts it again.
    if (!clock.playing && clock.t >= clock.max) clock.seek(clock.min);
    clock.playing = !clock.playing;
    syncPlay();
  });
  $<HTMLButtonElement>("now").addEventListener("click", () => opts.onNow());
  loopBox.addEventListener("change", () => (clock.loop = loopBox.checked));
  window.addEventListener("keydown", (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (e.code === "Space" && tag !== "INPUT" && tag !== "SELECT" && tag !== "BUTTON") {
      e.preventDefault();
      play.click();
    }
  });

  let dragging = false;
  scrub.addEventListener("pointerdown", () => (dragging = true));
  window.addEventListener("pointerup", () => (dragging = false));
  scrub.addEventListener("input", () => clock.seek(+scrub.value));

  const busBox = $<HTMLInputElement>("buses");
  busBox.addEventListener("change", () => opts.onBuses(busBox.checked));
  let busesLoaded = false;

  autoHide($("timeline"));

  syncPlay();
  const syncRange = (c: Clock) => {
    scrub.min = String(c.min);
    scrub.max = String(c.max);
    labelSpeeds(c);
  };
  /** The filled part of the track. The CSS turns this 0 to 1 fraction into a width. */
  const setFraction = (c: Clock) => scrub.style.setProperty("--frac", String((c.t - c.min) / (c.max - c.min)));
  scrub.addEventListener("input", () => setFraction(clock));
  syncRange(clock);
  return {
    syncRange,
    showDate(date) {
      dateInput.value = iso(date);
    },
    showSpeed(value) {
      speed.value = String(value);
    },
    busesReady() {
      busesLoaded = true;
      busBox.disabled = false;
    },
    setPeaks(next) {
      Object.assign(peaks, next);
    },
    update(c, counts) {
      // This runs every frame. Writing the same text or value again still costs a repaint in some browsers.
      const time = formatTime(c.t);
      if (time !== shownTime) clockEl.textContent = shownTime = time;
      const pos = String(Math.round(c.t));
      if (pos !== shownPos) {
        shownPos = pos;
        if (!dragging) scrub.value = pos;
        setFraction(c);
      }
      syncPlay();
      for (const mode of ["rail", "ferry", "bus"] as const) {
        const m = meters[mode];
        const peak = peaks[mode];
        const off = mode === "bus" && busesLoaded && !busBox.checked;
        const text = peak === null ? "\u2026" : String(counts[mode]);
        const width = peak ? `${Math.min(100, (counts[mode] / peak) * 100).toFixed(1)}%` : "0%";
        // Only touch the DOM when something changed. This runs every frame.
        if (shown[mode] !== `${text}|${width}|${off}`) {
          shown[mode] = `${text}|${width}|${off}`;
          m.num.textContent = text;
          m.fill.style.width = width;
          m.row.classList.toggle("off", off);
        }
      }
    },
  };
}
