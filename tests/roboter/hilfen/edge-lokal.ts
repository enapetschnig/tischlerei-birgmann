// Startet echte Edge Functions aus supabase/functions lokal mit Deno – NUR für Roboter-Tests gegen die Testumgebung.
// Aufruf: deno run -A edge-lokal.ts <port> <funktion> [<funktion> …]
// Umgebung: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (Testumgebung), MAIL_ABLAGE (Ordner).
// Nach außen geht nichts: Resend-Mails landen als JSON in MAIL_ABLAGE, das Logo kommt aus public/.
const [portText, ...namen] = Deno.args;
const wurzel = new URL("../../../", import.meta.url);
const ablage = Deno.env.get("MAIL_ABLAGE") ?? "";
let mailNr = 0;

const echtesFetch = globalThis.fetch;
globalThis.fetch = async (eingabe: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url;
  if (url.startsWith("https://api.resend.com/")) {
    mailNr += 1;
    if (ablage) await Deno.writeTextFile(`${ablage}/mail-${mailNr}.json`, String(init?.body ?? ""));
    return new Response(JSON.stringify({ id: `test-${mailNr}` }), { status: 200, headers: { "Content-Type": "application/json" } });
  }
  if (/^https:\/\/(www\.)?birgmann\.app\/birgmann-logo\.png/.test(url)) {
    const bild = await Deno.readFile(new URL("public/birgmann-logo.png", wurzel));
    return new Response(bild, { status: 200, headers: { "Content-Type": "image/png" } });
  }
  return echtesFetch(eingabe, init);
};

const handler: Record<string, (req: Request) => Response | Promise<Response>> = {};
let aktuell = "";
const echtesServe = Deno.serve.bind(Deno);
(Deno as unknown as { serve: unknown }).serve = (a: unknown, b?: unknown) => {
  handler[aktuell] = (typeof a === "function" ? a : b) as (req: Request) => Promise<Response>;
  return { finished: Promise.resolve(), shutdown: async () => {} };
};
for (const name of namen) {
  aktuell = name;
  await import(new URL(`supabase/functions/${name}/index.ts`, wurzel).href);
}

echtesServe({ port: Number(portText), hostname: "127.0.0.1", onListen: () => console.log("bereit") }, (req) => {
  const name = new URL(req.url).pathname.replace(/^\/functions\/v1\//, "").split("/")[0];
  if (name === "gesund") return new Response("ok");
  const h = handler[name];
  return h ? h(req) : new Response(JSON.stringify({ error: `Funktion ${name} nicht geladen` }), { status: 404 });
});
