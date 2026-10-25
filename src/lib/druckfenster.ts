// Druck- und Vorschaufenster (window.open + document.write) laufen mit den Rechten der App.
// Rechnungs-HTML enthält Nutzertexte (Positionen, Kundennamen) – diese Sperre verhindert, dass
// darin eingeschleuster Code ausgeführt wird. Layout, Bilder und Drucken bleiben unverändert.
const SPERRE =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; base-uri 'none'\">";

export function ohneSkripte(html: string): string {
  const kopf = /<head(\s[^>]*)?>/i.exec(html);
  if (kopf) {
    const ende = kopf.index + kopf[0].length;
    return html.slice(0, ende) + SPERRE + html.slice(ende);
  }
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + SPERRE + html.slice(doctype[0].length) : SPERRE + html;
}
