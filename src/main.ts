import "./style.css";
import { Clock } from "./clock/clock";
import { availableDates, loadCoastline, loadNetwork, type Mode } from "./data/load";
import { Scene } from "./render/scene";
import { buildDay, type Day } from "./sim/sim";
import type { Network } from "./types";
import { DEFAULT_SPEED, setupControls, type Controls } from "./ui/controls";
import { renderCredits } from "./ui/credits";

function aucklandToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}${get("month")}${get("day")}`;
}

async function main() {
  const [rail, ferry, coastline] = await Promise.all([loadNetwork("rail"), loadNetwork("ferry"), loadCoastline()]);
  const nets: Partial<Record<Mode, Network>> = { rail, ferry };
  const days: Partial<Record<Mode, Day>> = {};
  const dates = availableDates(rail);
  const today = aucklandToday();

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

  const controls: Controls = setupControls(clock, {
    dates,
    date,
    onDate: (d) => {
      date = d;
      rebuild();
      controls.setPeaks(peaks());
      const next = playWindow();
      clock.setRange(next.min, next.max);
      clock.playing = true;
      controls.syncRange(clock);
    },
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
