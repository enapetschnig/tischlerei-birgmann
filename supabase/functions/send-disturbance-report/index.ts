import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// jsPDF is loaded dynamically inside generatePDF to avoid module-load failures in Deno

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

interface Material {
  id: string;
  material: string;
  menge: string | null;
  notizen: string | null;
}

interface Photo {
  id: string;
  file_path: string;
  file_name: string;
}

interface Disturbance {
  id: string;
  datum: string;
  start_time: string;
  end_time: string;
  pause_minutes: number;
  stunden: number;
  kunde_name: string;
  kunde_email: string | null;
  kunde_adresse: string | null;
  kunde_telefon: string | null;
  beschreibung: string;
  notizen: string | null;
  unterschrift_kunde: string;
}

interface ReportRequest {
  disturbance: Disturbance;
  materials: Material[];
  technicianNames?: string[];
  technicianName?: string; // Legacy support
  photos?: Photo[];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("de-AT", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

async function generatePDF(data: ReportRequest & { technicians: string[] }, photoImages: (string | null)[]): Promise<string> {
  const { disturbance, materials, technicians, photos } = data;

  // Dynamic import — avoids module-level crash in Deno Edge Functions
  const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;
  const cW = pageW - 2 * margin;

  // Tischlerei Birgmann colour palette
  const BLACK = { r: 50, g: 50, b: 50 };
  const GRAY  = { r: 130, g: 130, b: 130 };
  const LGRAY = { r: 245, g: 245, b: 245 };
  const WHITE = { r: 255, g: 255, b: 255 };
  const BRAND = { r: 140, g: 56, b: 16 };  // Tischlerei orange/brown

  let y = 0;

  const setTxt  = (c: {r:number,g:number,b:number}) => doc.setTextColor(c.r, c.g, c.b);
  const setFill = (c: {r:number,g:number,b:number}) => doc.setFillColor(c.r, c.g, c.b);
  const setDraw = (c: {r:number,g:number,b:number}) => doc.setDrawColor(c.r, c.g, c.b);

  function sectionHeader(title: string) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    setTxt(BRAND);
    doc.text(title, margin, y);
    setDraw({ r: 200, g: 180, b: 160 });
    doc.setLineWidth(0.3);
    doc.line(margin, y + 1.5, margin + cW, y + 1.5);
    y += 7;
  }

  function fieldLabel(label: string, xPos = margin) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTxt(GRAY);
    doc.text(label.toUpperCase(), xPos, y);
  }

  function fieldValue(val: string, xPos = margin, maxW = cW): number {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    setTxt(BLACK);
    const lines = doc.splitTextToSize(val, maxW);
    doc.text(lines, xPos, y + 4);
    return lines.length;
  }

  function checkPage(needed = 35) {
    if (y + needed > pageH - 18) { doc.addPage(); y = 20; }
  }

  // ── HEADER ──
  setFill(BRAND);
  doc.rect(0, 0, pageW, 1.5, "F");

  // Logo
  let logoLoaded = false;
  try {
    const logoRes = await fetch("https://www.birgmann.app/birgmann-logo.png");
    if (logoRes.ok) {
      const buf = await logoRes.arrayBuffer();
      const u8 = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
      doc.addImage(`data:image/png;base64,${btoa(bin)}`, "PNG", margin, 5, 55, 25);
      logoLoaded = true;
    }
  } catch (_) { /* optional */ }

  if (!logoLoaded) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    setTxt(BRAND);
    doc.text("TISCHLEREI BIRGMANN", margin, 20);
  }

  // Title block (right side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  setTxt(BRAND);
  doc.text("REGIEBERICHT", pageW - margin, 14, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setTxt(GRAY);
  doc.text(formatDate(disturbance.datum), pageW - margin, 21, { align: "right" });

  // Separator line below header
  setDraw({ r: 200, g: 200, b: 200 });
  doc.setLineWidth(0.2);
  doc.line(margin, 33, margin + cW, 33);

  y = 42;

  const col2x = margin + cW / 2 + 3;
  const colW = cW / 2 - 5;

  // ── KUNDENDATEN ──
  sectionHeader("Kundendaten");

  fieldLabel("Name");
  const nameLines = fieldValue(disturbance.kunde_name, margin, colW);
  if (disturbance.kunde_adresse) {
    fieldLabel("Adresse", col2x);
    fieldValue(disturbance.kunde_adresse, col2x, colW);
  }
  y += nameLines * 4.5 + 4;

  if (disturbance.kunde_telefon || disturbance.kunde_email) {
    if (disturbance.kunde_telefon) { fieldLabel("Telefon"); fieldValue(disturbance.kunde_telefon, margin, colW); }
    if (disturbance.kunde_email) { fieldLabel("E-Mail", col2x); fieldValue(disturbance.kunde_email, col2x, colW); }
    y += 9;
  }
  y += 5;

  // ── EINSATZDATEN ──
  checkPage(45);
  sectionHeader("Einsatzdaten");

  const st = disturbance.start_time.slice(0, 5);
  const et = disturbance.end_time.slice(0, 5);

  fieldLabel("Datum");
  fieldValue(formatDate(disturbance.datum), margin, colW);
  fieldLabel("Arbeitszeit", col2x);
  fieldValue(`${st} – ${et} Uhr`, col2x, colW);
  y += 9;

  if (disturbance.pause_minutes > 0) {
    fieldLabel("Pause");
    fieldValue(`${disturbance.pause_minutes} Minuten`, margin, colW);
    y += 9;
  }

  // Hours box
  y += 4;
  const boxY = y;
  const boxH = 18;
  setFill({ r: 250, g: 240, b: 230 }); // very light warm tint
  setDraw(BRAND);
  doc.setLineWidth(0.6);
  doc.roundedRect(col2x - 2, boxY, colW + 2, boxH, 2, 2, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setTxt(GRAY);
  doc.text("GESAMTSTUNDEN", col2x + 2, boxY + 6);
  doc.setFontSize(14);
  setTxt(BLACK);
  doc.text(`${disturbance.stunden.toFixed(2)} h`, col2x + 2, boxY + 14);
  y = boxY + boxH + 4;

  fieldLabel("Mitarbeiter");
  fieldValue(technicians.join(", "), margin, cW);
  y += 10;

  // ── DURCHGEFÜHRTE ARBEITEN ──
  checkPage(40);
  sectionHeader("Durchgeführte Arbeiten");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  setTxt(BLACK);
  const bLines = doc.splitTextToSize(disturbance.beschreibung, cW - 4);
  const bH = bLines.length * 4.8 + 6;
  setFill(LGRAY);
  setDraw({ r: 180, g: 180, b: 180 });
  doc.setLineWidth(0.2);
  doc.rect(margin, y - 2, cW, bH, "FD");
  doc.text(bLines, margin + 3, y + 2.5);
  y += bH + 5;

  if (disturbance.notizen) {
    checkPage(20);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    setTxt(GRAY);
    doc.text("NOTIZEN", margin, y);
    y += 4;
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9);
    setTxt({ r: 60, g: 60, b: 60 });
    const nLines = doc.splitTextToSize(disturbance.notizen, cW);
    doc.text(nLines, margin, y);
    y += nLines.length * 4.8 + 6;
  }

  // ── MATERIALIEN ──
  if (materials && materials.length > 0) {
    checkPage(30);
    y += 4;
    sectionHeader("Verwendete Materialien");

    const c1 = cW * 0.45;
    const c2 = cW * 0.2;
    const c3 = cW * 0.35;

    // Table header row
    setFill(LGRAY);
    doc.rect(margin, y - 3, cW, 7, "F");
    setDraw({ r: 160, g: 160, b: 160 });
    doc.setLineWidth(0.2);
    doc.rect(margin, y - 3, cW, 7, "S");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setTxt(BLACK);
    doc.text("Material", margin + 2, y + 1);
    doc.text("Menge", margin + c1 + 2, y + 1);
    doc.text("Notizen", margin + c1 + c2 + 2, y + 1);
    y += 7;

    materials.forEach((mat) => {
      checkPage(8);
      setDraw({ r: 200, g: 200, b: 200 });
      doc.setLineWidth(0.1);
      doc.line(margin, y + 4, margin + cW, y + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      setTxt(BLACK);
      doc.text(doc.splitTextToSize(mat.material || "-", c1 - 4), margin + 2, y);
      doc.text(mat.menge || "-", margin + c1 + 2, y);
      doc.text(doc.splitTextToSize(mat.notizen || "-", c3 - 4), margin + c1 + c2 + 2, y);
      y += 7;
    });

    setDraw({ r: 160, g: 160, b: 160 });
    doc.setLineWidth(0.3);
    doc.line(margin, y, margin + cW, y);
    y += 6;
  }

  // ── FOTOS ──
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    doc.addPage();
    y = 20;
    sectionHeader("Fotos");

    const imgW = (cW - 5) / 2;
    const imgH = imgW * 0.75;
    let col = 0;

    for (let i = 0; i < photos.length; i++) {
      const imageData = photoImages[i];
      if (!imageData) continue;
      if (col === 2) { col = 0; y += imgH + 12; checkPage(imgH + 15); }
      const xImg = margin + col * (imgW + 5);
      try {
        doc.addImage(imageData, "JPEG", xImg, y, imgW, imgH);
        setDraw({ r: 180, g: 180, b: 180 });
        doc.setLineWidth(0.2);
        doc.rect(xImg, y, imgW, imgH, "S");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        setTxt(GRAY);
        const fn = photos[i].file_name.length > 30 ? photos[i].file_name.slice(0, 28) + "…" : photos[i].file_name;
        doc.text(fn, xImg, y + imgH + 4);
      } catch (_) { /* skip */ }
      col++;
    }
    y += imgH + 14;
  }

  // ── UNTERSCHRIFT ──
  checkPage(65);
  y += 6;
  sectionHeader("Kundenunterschrift");

  setFill(WHITE);
  setDraw({ r: 190, g: 190, b: 190 });
  doc.setLineWidth(0.2);
  doc.rect(margin, y - 2, cW, 38, "FD");

  if (disturbance.unterschrift_kunde) {
    try {
      doc.addImage(disturbance.unterschrift_kunde, "PNG", margin + 2, y, cW - 4, 33);
    } catch (_) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      setTxt(GRAY);
      doc.text("[Unterschrift vorhanden]", margin + 5, y + 16);
    }
  }
  y += 42;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  setTxt(GRAY);
  doc.text(`Datum: ${new Date().toLocaleDateString("de-AT")}`, margin, y);
  y += 5;
  const confirmText = "Der Kunde bestätigt mit seiner Unterschrift die ordnungsgemäße Durchführung der oben angeführten Arbeiten.";
  doc.text(doc.splitTextToSize(confirmText, cW), margin, y);

  // ── FOOTER ──
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    setDraw({ r: 210, g: 210, b: 210 });
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 12, margin + cW, pageH - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    setTxt({ r: 150, g: 150, b: 150 });
    doc.text(`Tischlerei Birgmann  |  Erstellt am: ${new Date().toLocaleDateString("de-AT")}`, margin, pageH - 7);
    doc.text(`Seite ${p} / ${totalPages}`, pageW - margin, pageH - 7, { align: "right" });
  }

  return doc.output("datauristring").split(",")[1];
}

function generateEmailHtml(data: ReportRequest & { technicians: string[] }): string {
  const { disturbance, technicians } = data;
  const technicianDisplay = technicians.length === 1 ? technicians[0] : technicians.join(", ");

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: Arial, sans-serif; color: #333; line-height: 1.5; }
        .header { color: #8C3810; font-size: 24px; font-weight: bold; margin-bottom: 10px; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .info-box { background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">TISCHLEREI BIRGMANN</div>
        <h2>Regiebericht</h2>

        <p>Sehr geehrte Damen und Herren,</p>

        <p>im Anhang finden Sie den Regiebericht f&uuml;r den Einsatz bei <strong>${escapeHtml(disturbance.kunde_name)}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>

        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${escapeHtml(technicianDisplay)}<br>
          Arbeitszeit: ${escapeHtml(disturbance.start_time.slice(0, 5))} - ${escapeHtml(disturbance.end_time.slice(0, 5))} Uhr<br>
          Gesamtstunden: ${disturbance.stunden.toFixed(2)} h
        </div>

        <p>Der vollst&auml;ndige Bericht mit allen Details und der Kundenunterschrift befindet sich im angeh&auml;ngten PDF-Dokument.</p>

        <p>Mit freundlichen Gr&uuml;&szlig;en,<br>
        Tischlerei Birgmann</p>
      </div>
    </body>
    </html>
  `;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "RESEND_API_KEY is not set in Supabase secrets" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const { disturbance, materials, technicianNames, technicianName, photos }: ReportRequest = await req.json();

    // Backward compatibility + fallback
    const technicians = technicianNames?.length ? technicianNames :
                        technicianName ? [technicianName] : ["Techniker"];

    if (!disturbance || !disturbance.unterschrift_kunde) {
      return new Response(
        JSON.stringify({ error: "Disturbance data and signature required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Generating PDF for disturbance:", disturbance.id);

    // Fetch photo images from storage
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: (string | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageAsBase64(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF (with fallback if generation fails)
    let pdfBase64: string | null = null;
    try {
      pdfBase64 = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);
      console.log("PDF generated successfully");
    } catch (pdfError) {
      console.error("PDF generation failed, sending email without PDF:", pdfError instanceof Error ? pdfError.message : String(pdfError));
    }

    // Generate simple email HTML
    const emailHtml = generateEmailHtml({ disturbance, materials, technicians });

    // Fetch office email from settings with fallback
    const { data: setting } = await supabaseAdmin
      .from("app_settings")
      .select("value")
      .eq("key", "disturbance_report_email")
      .maybeSingle();

    const officeEmail = setting?.value || "";
    console.log("Using office email:", officeEmail);

    // Prepare recipients
    const recipients: string[] = [];
    if (officeEmail) recipients.push(officeEmail);
    if (disturbance.kunde_email) recipients.push(disturbance.kunde_email);

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ error: "Keine Empfaenger-E-Mail-Adresse vorhanden. Bitte Kunden-E-Mail oder Buero-E-Mail in den Einstellungen hinterlegen." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Create filename
    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;

    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email to:", recipients, "| PDF attached:", pdfBase64 !== null);

    const emailPayload: {
      from: string;
      to: string[];
      subject: string;
      html: string;
      attachments?: { filename: string; content: string }[];
    } = {
      from: "Tischlerei Birgmann <noreply@chrisnapetschnig.at>",
      to: recipients,
      subject: subject,
      html: emailHtml,
    };

    if (pdfBase64) {
      emailPayload.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailPayload),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      return new Response(
        JSON.stringify({ error: `E-Mail Fehler: ${resendData?.message || resendData?.name || JSON.stringify(resendData)}` }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log("Email sent successfully:", resendData);

    return new Response(
      JSON.stringify({ success: true, emailId: resendData?.id }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    console.error("Error sending disturbance report:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
