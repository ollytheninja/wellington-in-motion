import type { Credit } from "../data/load";

const REPO_URL = "https://github.com/ollytheninja/trains";
const METLINK_URL = "https://www.metlink.org.nz/legal/general-transit-feed-specification";
const CC_BY_URL = "https://creativecommons.org/licenses/by/4.0/";

const link = (text: string, href: string) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;

/**
 * Fills the credits box. Timetables and the hillshade are fixed. The coastline credit comes
 * from the data file, so the words CC BY 4.0 asks for stay with the data. The hillshade is
 * only credited when it is actually drawn, which needs its API key.
 */
export function renderCredits(el: HTMLElement, coastline: Credit | null): void {
  const rows: string[] = [
    `<p><b>Timetables</b> ${link("Metlink General Transit Feed Specification", METLINK_URL)}, Greater Wellington Regional Council. Vehicles are placed from the timetable, not tracked live.</p>`,
  ];
  if (import.meta.env.VITE_LINZ_BASEMAPS_KEY) {
    rows.push(`<p><b>Hillshade</b> ${link("Sourced from LINZ", "https://basemaps.linz.govt.nz/")}, ${link("CC BY 4.0", CC_BY_URL)}.</p>`);
  }
  if (coastline) {
    rows.push(
      `<p><b>Coastline</b> ${link(coastline.source, coastline.sourceUrl)}, ${link(coastline.licence, coastline.licenceUrl)}. ${coastline.changes}</p>`,
    );
  }
  rows.push(`<p><b>Source code</b> ${link("github.com/ollytheninja/trains", REPO_URL)}</p>`);
  el.innerHTML = `<h2>Credits</h2>${rows.join("")}`;
}
