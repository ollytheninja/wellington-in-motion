const IDLE_MS = 2500;

/**
 * Fades `el` out when the mouse leaves the window or stops moving for a couple of seconds,
 * and brings it back on any mouse, touch or key activity. It stays put while the mouse is
 * over it or while a pointer is held down, so dragging the scrubber never loses the bar.
 */
export function autoHide(el: HTMLElement): void {
  let timer: number | undefined;
  let hovering = false;
  let pressed = false;

  const hide = () => {
    if (!hovering && !pressed) el.classList.add("idle");
  };
  const show = () => {
    el.classList.remove("idle");
    window.clearTimeout(timer);
    timer = window.setTimeout(hide, IDLE_MS);
  };

  for (const type of ["mousemove", "keydown", "touchstart"]) document.addEventListener(type, show, { passive: true });
  document.addEventListener("pointerdown", () => {
    pressed = true;
    show();
  });
  document.addEventListener("pointerup", () => {
    pressed = false;
    show();
  });
  document.documentElement.addEventListener("mouseleave", () => {
    window.clearTimeout(timer);
    hide();
  });
  el.addEventListener("mouseenter", () => (hovering = true));
  el.addEventListener("mouseleave", () => {
    hovering = false;
    show();
  });

  show();
}
