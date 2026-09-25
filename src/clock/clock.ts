/** Simulation time, in seconds from midnight of the service day. No rendering, no DOM. */
export class Clock {
  t: number;
  playing = true;
  /** While true the clock does not advance, even when playing. Used to wait for data to load. */
  held = false;
  /** At the end of the window, go back to the start instead of stopping. */
  loop = false;
  speed: number;
  min: number;
  max: number;

  constructor(start: number, speed: number, min: number, max: number) {
    this.t = start;
    this.speed = speed;
    this.min = min;
    this.max = max;
  }

  /** Advance by `dtMs` of real time. At the end of the window it stops, or wraps if `loop` is set. */
  tick(dtMs: number): void {
    if (!this.playing || this.held) return;
    const next = this.t + (dtMs / 1000) * this.speed;
    if (next < this.max) {
      this.t = next;
    } else if (this.loop) {
      this.t = this.min + ((next - this.min) % (this.max - this.min));
    } else {
      this.t = this.max;
      this.playing = false;
    }
  }

  /** Jump to `t`, kept inside the window. */
  seek(t: number): void {
    this.t = Math.min(this.max, Math.max(this.min, t));
  }

  /** Change the window but keep the current time if it is still inside. */
  setBounds(min: number, max: number): void {
    this.min = min;
    this.max = max;
    this.seek(this.t);
  }

  /** Change the window and go back to its start. */
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
