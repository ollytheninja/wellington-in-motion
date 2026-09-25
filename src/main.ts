import "./style.css";
import { Clock } from "./clock/clock";
import { availableDates, loadCoastline, loadNetwork, type Mode } from "./data/load";
import { Scene } from "./render/scene";
import { buildDay, type Day } from "./sim/sim";
import type { Network } from "./types";
import { DEFAULT_SPEED, setupControls, type Controls } from "./ui/controls";
import { addDays } from "./data/wire";
import { renderCredits } from "./ui/credits";

/** The date (YYYYMMDD) and time of day, in seconds, in Wellington right now. */
function aucklandNow(): { date: string; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => +parts.find((p) => p.type === type)!.value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${get("year")}${pad(get("month"))}${pad(get("day"))}`,
    seconds: get("hour") * 3600 + get("minute") * 60 + get("second"),
  };
}

async function main() {
  const [rail, ferry, coastline] = await Promise.all([loadNetwork("rail"), loadNetwork("ferry"), loadCoastline()]);
  const nets: Partial<Record<Mode, Network>> = { rail, ferry };
  const days: Partial<Record<Mode, Day>> = {};
  const dates = availableDates(rail);
  const today = aucklandNow().date;

  // Default to today if the feed covers it, otherwise the nearest date it does.
  let date = dates.includes(today) ? today : today < dates[0]! ? dates[0]! : dates[dates.length - 1]!;

  renderCredits(document.getElementById("credits")!, coastline?.credit ?? null);

  const scene = new Scene(
    document.getElementById("map")!,
    [
      { mode: "rail", net: rail },
      { mode: "ferry", net: ferry },
    ],
    coastline,
  );

  /** Rebuild every loaded mode for `date` and hand the trips to the scene. */
  const rebuild = () => {
    for (const mode of Object.keys(nets) as Mode[]) {
      days[mode] = buildDay(nets[mode]!, date, mode);
      scene.setTrips(mode, days[mode]!.trips);
    }
  };
  /** The play window covers every loaded mode that runs on this date. */
  const playWindow = () => {
    const running = Object.values(days).filter((d) => d.trips.length > 0);
    if (running.length === 0) return { min: 0, max: 86400 };
    return { min: Math.min(...running.map((d) => d.start)), max: Math.max(...running.map((d) => d.end)) };
  };

  const peaks = () => ({
    rail: days.rail?.peak ?? null,
    ferry: days.ferry?.peak ?? null,
    bus: days.bus?.peak ?? null,
  });

  rebuild();
  const w = playWindow();
  // Always start at the first train, so a reload replays the day from the top.
  const clock = new Clock(w.min, DEFAULT_SPEED, w.min, w.max);
  // Hold at the start until the buses arrive, so the day does not run on without them.
  clock.held = true;

  /** Show another service day, from its first minute. */
  const loadDate = (d: string) => {
    date = d;
    rebuild();
    controls.setPeaks(peaks());
    const next = playWindow();
    clock.setRange(next.min, next.max);
    clock.playing = true;
    controls.syncRange(clock);
    controls.showDate(d);
  };

  /**
   * Real time, right now: today's date and the time of day, at 1x, playing. Before the first
   * train of the morning it is still yesterday's service day, whose times run past 24:00, so
   * 01:00 is 25:00 on yesterday's clock. If the feed does not cover today, the nearest day it does.
   */
  const goToNow = () => {
    const now = aucklandNow();
    const candidates = [
      { date: now.date, t: now.seconds },
      { date: addDays(now.date, -1), t: now.seconds + 86400 },
    ];
    let target = candidates.find((c) => {
      if (!dates.includes(c.date)) return false;
      if (c.date !== date) loadDate(c.date);
      return c.t >= clock.min && c.t <= clock.max;
    });
    if (!target) {
      const fallback = dates.includes(now.date) ? now.date : now.date < dates[0]! ? dates[0]! : dates[dates.length - 1]!;
      if (fallback !== date) loadDate(fallback);
      target = { date: fallback, t: now.seconds };
    }
    clock.seek(target.t);
    clock.speed = 1;
    clock.playing = true;
    controls.showSpeed(1);
  };

  const controls: Controls = setupControls(clock, {
    dates,
    date,
    onDate: (d) => loadDate(d),
    onNow: () => goToNow(),
    onBuses: (on) => scene.setVisible("bus", on),
  });

  controls.setPeaks(peaks());

  // Buses are most of the data, so they load after trains are already moving.
  void loadNetwork("bus")
    .then((net) => {
      nets.bus = net;
      scene.setBusRoutes(net);
      rebuild();
      controls.setPeaks(peaks());
      const next = playWindow();
      // If nobody has moved the clock, go back to the start of the (possibly wider) window.
      if (clock.t === w.min) clock.setRange(next.min, next.max);
      else clock.setBounds(next.min, next.max);
      controls.syncRange(clock);
      controls.busesReady();
    })
    .catch((err) => console.error("Could not load buses", err))
    .finally(() => (clock.held = false));

  let last = performance.now();
  const frame = (nowMs: number) => {
    clock.tick(nowMs - last);
    last = nowMs;
    const counts = scene.draw(clock.t, clock.playing ? clock.speed : 300);
    controls.update(clock, counts);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  document.body.textContent = String(err);
});
