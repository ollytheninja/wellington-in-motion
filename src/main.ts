import "./style.css";
import { Clock } from "./clock/clock";
import { availableDates, loadNetwork } from "./data/load";
import { Scene } from "./render/scene";
import { buildDay } from "./sim/sim";
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
  const net = await loadNetwork();
  const dates = availableDates(net);
  const now = aucklandNow();

  // Default to today if the feed covers it, otherwise the nearest date it does.
  const date = dates.includes(now.date) ? now.date : now.date < dates[0]! ? dates[0]! : dates[dates.length - 1]!;
  const day = buildDay(net, date);
  const inWindow = date === now.date && now.seconds >= day.start && now.seconds <= day.end;
  const clock = new Clock(inWindow ? now.seconds : day.start, DEFAULT_SPEED, day.start, day.end);

  const scene = new Scene(document.getElementById("map")!, net);
  scene.setTrips(day.trips);

  const controls: Controls = setupControls(clock, {
    dates,
    date,
    onDate: (d) => {
      const next = buildDay(net, d);
      scene.setTrips(next.trips);
      clock.setRange(next.start, next.end);
      controls.syncRange(clock);
    },
    onBasemap: (on) => scene.setBasemap(on),
  });

  let last = performance.now();
  const frame = (nowMs: number) => {
    clock.tick(nowMs - last);
    last = nowMs;
    const running = scene.draw(clock.t, clock.playing ? clock.speed : 300);
    controls.update(clock, running);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err) => {
  document.body.textContent = String(err);
});
