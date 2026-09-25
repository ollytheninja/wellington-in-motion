import "./style.css";
import { Clock } from "./clock/clock";
import { availableDates, loadCoastline, loadNetwork, type Mode } from "./data/load";
import { HAS_BASEMAP, Scene } from "./render/scene";
import { buildDay, type Day } from "./sim/sim";
import type { Network } from "./types";
import { DEFAULT_SPEED, setupControls, type Controls } from "./ui/controls";

function aucklandNow(): { date: string; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Pacific/Auckland",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    date: `${get("year")}${get("month")}${get("day")}`,
    seconds: +get("hour") * 3600 + +get("minute") * 60,
  };
}

async function main() {
  const [rail, ferry, coastline] = await Promise.all([loadNetwork("rail"), loadNetwork("ferry"), loadCoastline()]);
  const nets: Partial<Record<Mode, Network>> = { rail, ferry };
  const days: Partial<Record<Mode, Day>> = {};
  const dates = availableDates(rail);
  const now = aucklandNow();

  // Default to today if the feed covers it, otherwise the nearest date it does.
  let date = dates.includes(now.date) ? now.date : now.date < dates[0]! ? dates[0]! : dates[dates.length - 1]!;

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

  rebuild();
  const w = playWindow();
  const inWindow = date === now.date && now.seconds >= w.min && now.seconds <= w.max;
  const clock = new Clock(inWindow ? now.seconds : w.min, DEFAULT_SPEED, w.min, w.max);

  const controls: Controls = setupControls(clock, {
    dates,
    date,
    onDate: (d) => {
      date = d;
      rebuild();
      const next = playWindow();
      clock.setRange(next.min, next.max);
      controls.syncRange(clock);
    },
    onBasemap: (on) => scene.setBasemap(on),
    basemapAvailable: HAS_BASEMAP,
    onBuses: (on) => scene.setVisible("bus", on),
  });

  // Buses are most of the data, so they load after trains are already moving.
  void loadNetwork("bus").then((net) => {
    nets.bus = net;
    scene.setBusRoutes(net);
    rebuild();
    const next = playWindow();
    clock.setBounds(next.min, next.max);
    controls.syncRange(clock);
    controls.busesReady();
  });

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
