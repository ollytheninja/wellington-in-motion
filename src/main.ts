import "./style.css";
import { Clock } from "./clock/clock";
import { availableDates, loadNetwork } from "./data/load";
import { Scene } from "./render/scene";
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
  const rail = await loadNetwork("rail");
  const dates = availableDates(rail);
  const now = aucklandNow();

  // Default to today if the feed covers it, otherwise the nearest date it does.
  let date = dates.includes(now.date) ? now.date : now.date < dates[0]! ? dates[0]! : dates[dates.length - 1]!;
  let bus: Network | null = null;
  let railDay = buildDay(rail, date, "rail");
  let busDay: Day | null = null;

  /** The play window covers every mode that is loaded. */
  const playWindow = () => {
    const days = busDay ? [railDay, busDay] : [railDay];
    return { min: Math.min(...days.map((d) => d.start)), max: Math.max(...days.map((d) => d.end)) };
  };

  const w = playWindow();
  const inWindow = date === now.date && now.seconds >= w.min && now.seconds <= w.max;
  const clock = new Clock(inWindow ? now.seconds : w.min, DEFAULT_SPEED, w.min, w.max);

  const scene = new Scene(document.getElementById("map")!, rail);
  scene.setTrips(railDay.trips, []);

  const controls: Controls = setupControls(clock, {
    dates,
    date,
    onDate: (d) => {
      date = d;
      railDay = buildDay(rail, date, "rail");
      busDay = bus ? buildDay(bus, date, "bus") : null;
      scene.setTrips(railDay.trips, busDay?.trips ?? []);
      const next = playWindow();
      clock.setRange(next.min, next.max);
      controls.syncRange(clock);
    },
    onBasemap: (on) => scene.setBasemap(on),
    onBuses: (on) => scene.setShowBuses(on),
  });

  // Buses are most of the data, so they load after trains are already moving.
  void loadNetwork("bus").then((net) => {
    bus = net;
    busDay = buildDay(net, date, "bus");
    scene.setTrips(railDay.trips, busDay.trips);
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
