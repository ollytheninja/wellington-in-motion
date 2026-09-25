/** Simulation time, in seconds from midnight of the service day. No rendering, no DOM. */
export class Clock {
  t: number;
  playing = true;
  speed: number;
  min: number;
  max: number;

  constructor(start: number, speed: number, min: number, max: number) {
    this.t = start;
    this.speed = speed;
    this.min = min;
    this.max = max;
  }

  /** Advance by `dtMs` of real time. Wraps at the end of the window. */
  tick(dtMs: number): void {
    if (!this.playing) return;
    this.seek(this.t + (dtMs / 1000) * this.speed);
  }

  seek(t: number): void {
    const span = this.max - this.min;
    this.t = this.min + ((((t - this.min) % span) + span) % span);
  }

  setRange(min: number, max: number): void {
    this.min = min;
    this.max = max;
    this.t = min;
  }
}

/** HH:MM on the 24 hour clock. Times past midnight wrap, so 26:14 shows as 02:14. */
export function formatTime(t: number): string {
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
