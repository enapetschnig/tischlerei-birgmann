import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from "npm:pdf-lib@1.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase Admin Client for reading settings
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

// A4 dimensions in points (1 point = 1/72 inch)
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 56.69; // ~20mm
const CONTENT_WIDTH = A4_WIDTH - 2 * MARGIN;

// Colors
const BRAND_COLOR = rgb(140 / 255, 56 / 255, 16 / 255);
const GRAY = rgb(100 / 255, 100 / 255, 100 / 255);
const LIGHT_GRAY = rgb(150 / 255, 150 / 255, 150 / 255);
const BLACK = rgb(0, 0, 0);
const TABLE_BG = rgb(240 / 255, 240 / 255, 240 / 255);
const TABLE_BORDER = rgb(200 / 255, 200 / 255, 200 / 255);

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

async function fetchImageBytes(url: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("Failed to fetch image:", url, response.status);
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { bytes: new Uint8Array(arrayBuffer), type: contentType };
  } catch (error) {
    console.error("Error fetching image:", error);
    return null;
  }
}

function dataUriToBytes(dataUri: string): { bytes: Uint8Array; type: string } {
  const match = dataUri.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error("Invalid data URI");
  const type = match[1];
  const b64 = match[2];
  const binaryStr = atob(b64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return { bytes, type };
}

// Helper to wrap text into lines that fit within maxWidth
function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const lines: string[] = [];
  const paragraphs = text.split("\n");

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }

    const words = paragraph.split(" ");
    let currentLine = "";

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines;
}

async function generatePDF(
  data: ReportRequest & { technicians: string[] },
  photoImages: ({ bytes: Uint8Array; type: string } | null)[]
): Promise<Uint8Array> {
  const { disturbance, materials, technicians, photos } = data;

  const doc = await PDFDocument.create();
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await doc.embedFont(StandardFonts.HelveticaOblique);

  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let yPos = A4_HEIGHT - MARGIN; // pdf-lib: y=0 is bottom

  // Helper: check if we need a new page
  const ensureSpace = (needed: number) => {
    if (yPos - needed < MARGIN) {
      page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
      yPos = A4_HEIGHT - MARGIN;
    }
  };

  // --- HEADER ---

  // Try loading logo
  let logoLoaded = false;
  try {
    const logoResponse = await fetch("https://www.birgmann.app/birgmann-logo.png");
    if (logoResponse.ok) {
      const logoBuffer = await logoResponse.arrayBuffer();
      const logoImage = await doc.embedPng(new Uint8Array(logoBuffer));
      const logoDims = logoImage.scaleToFit(113, 42); // ~40mm x 15mm
      page.drawImage(logoImage, {
        x: MARGIN,
        y: yPos - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });

      // Company name next to logo
      page.drawText("TISCHLEREI BIRGMANN", {
        x: MARGIN + logoDims.width + 14,
        y: yPos - 20,
        size: 20,
        font: helveticaBold,
        color: BRAND_COLOR,
      });
      yPos -= Math.max(logoDims.height, 28) + 8;
      logoLoaded = true;
    }
  } catch (e) {
    console.error("Could not load logo:", e);
  }

  if (!logoLoaded) {
    page.drawText("TISCHLEREI BIRGMANN", {
      x: MARGIN,
      y: yPos,
      size: 24,
      font: helveticaBold,
      color: BRAND_COLOR,
    });
    yPos -= 28;
  }

  // Divider line
  page.drawLine({
    start: { x: MARGIN, y: yPos },
    end: { x: MARGIN + CONTENT_WIDTH, y: yPos },
    thickness: 1,
    color: BRAND_COLOR,
  });
  yPos -= 18;

  // Subtitle
  page.drawText("Regiebericht", {
    x: MARGIN,
    y: yPos,
    size: 16,
    font: helveticaBold,
    color: GRAY,
  });
  yPos -= 28;

  // --- KUNDENDATEN ---
  page.drawText("Kundendaten", {
    x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
  });
  yPos -= 18;

  const drawInfoLine = (text: string) => {
    page.drawText(text, {
      x: MARGIN, y: yPos, size: 10, font: helvetica, color: BLACK,
    });
    yPos -= 14;
  };

  drawInfoLine(`Name: ${disturbance.kunde_name}`);
  if (disturbance.kunde_adresse) drawInfoLine(`Adresse: ${disturbance.kunde_adresse}`);
  if (disturbance.kunde_telefon) drawInfoLine(`Telefon: ${disturbance.kunde_telefon}`);
  if (disturbance.kunde_email) drawInfoLine(`E-Mail: ${disturbance.kunde_email}`);

  yPos -= 14;

  // --- EINSATZDATEN ---
  ensureSpace(100);
  page.drawText("Einsatzdaten", {
    x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
  });
  yPos -= 18;

  drawInfoLine(`Datum: ${formatDate(disturbance.datum)}`);

  const startTime = disturbance.start_time.slice(0, 5);
  const endTime = disturbance.end_time.slice(0, 5);
  drawInfoLine(`Arbeitszeit: ${startTime} - ${endTime} Uhr`);

  if (disturbance.pause_minutes > 0) {
    drawInfoLine(`Pause: ${disturbance.pause_minutes} Minuten`);
  }

  page.drawText(`Gesamtstunden: ${disturbance.stunden.toFixed(2)} Stunden`, {
    x: MARGIN, y: yPos, size: 10, font: helveticaBold, color: BLACK,
  });
  yPos -= 14;

  // Technicians
  if (technicians.length === 1) {
    drawInfoLine(`Techniker: ${technicians[0]}`);
  } else if (technicians.length > 1) {
    drawInfoLine("Techniker:");
    technicians.forEach((name) => {
      drawInfoLine(`  - ${name}`);
    });
  }

  yPos -= 10;

  // --- DURCHGEFÜHRTE ARBEITEN ---
  ensureSpace(60);
  page.drawText("Durchgeführte Arbeiten", {
    x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
  });
  yPos -= 18;

  const beschreibungLines = wrapText(disturbance.beschreibung, helvetica, 10, CONTENT_WIDTH);
  for (const line of beschreibungLines) {
    ensureSpace(14);
    if (line) {
      page.drawText(line, {
        x: MARGIN, y: yPos, size: 10, font: helvetica, color: BLACK,
      });
    }
    yPos -= 14;
  }

  // --- NOTIZEN ---
  if (disturbance.notizen) {
    yPos -= 6;
    ensureSpace(40);
    page.drawText("Notizen", {
      x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
    });
    yPos -= 18;

    const notizenLines = wrapText(disturbance.notizen, helvetica, 10, CONTENT_WIDTH);
    for (const line of notizenLines) {
      ensureSpace(14);
      if (line) {
        page.drawText(line, {
          x: MARGIN, y: yPos, size: 10, font: helvetica, color: BLACK,
        });
      }
      yPos -= 14;
    }
  }

  yPos -= 10;

  // --- MATERIALIEN ---
  if (materials && materials.length > 0) {
    ensureSpace(60);
    page.drawText("Verwendetes Material", {
      x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
    });
    yPos -= 18;

    // Table header background
    page.drawRectangle({
      x: MARGIN,
      y: yPos - 4,
      width: CONTENT_WIDTH,
      height: 18,
      color: TABLE_BG,
    });

    page.drawText("Material", { x: MARGIN + 6, y: yPos, size: 9, font: helveticaBold, color: BLACK });
    page.drawText("Menge", { x: MARGIN + 255, y: yPos, size: 9, font: helveticaBold, color: BLACK });
    page.drawText("Notizen", { x: MARGIN + 340, y: yPos, size: 9, font: helveticaBold, color: BLACK });
    yPos -= 20;

    for (const mat of materials) {
      ensureSpace(20);

      // Row border
      page.drawLine({
        start: { x: MARGIN, y: yPos + 12 },
        end: { x: MARGIN + CONTENT_WIDTH, y: yPos + 12 },
        thickness: 0.5,
        color: TABLE_BORDER,
      });

      page.drawText(mat.material || "-", { x: MARGIN + 6, y: yPos, size: 9, font: helvetica, color: BLACK });
      page.drawText(mat.menge || "-", { x: MARGIN + 255, y: yPos, size: 9, font: helvetica, color: BLACK });
      page.drawText(mat.notizen || "-", { x: MARGIN + 340, y: yPos, size: 9, font: helvetica, color: BLACK });
      yPos -= 18;
    }

    yPos -= 10;
  }

  // --- FOTOS ---
  if (photos && photos.length > 0 && photoImages.some(img => img !== null)) {
    page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
    yPos = A4_HEIGHT - MARGIN;

    page.drawText("Fotos", {
      x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
    });
    yPos -= 24;

    for (let i = 0; i < photos.length; i++) {
      const imgData = photoImages[i];
      if (!imgData) continue;

      ensureSpace(200);

      try {
        const image = imgData.type.includes("png")
          ? await doc.embedPng(imgData.bytes)
          : await doc.embedJpg(imgData.bytes);

        const dims = image.scaleToFit(227, 170); // ~80mm x 60mm
        page.drawImage(image, {
          x: MARGIN,
          y: yPos - dims.height,
          width: dims.width,
          height: dims.height,
        });
        yPos -= dims.height + 4;

        // Filename
        page.drawText(photos[i].file_name, {
          x: MARGIN, y: yPos, size: 8, font: helvetica, color: GRAY,
        });
        yPos -= 20;
      } catch (e) {
        console.error("Error adding photo to PDF:", e);
      }
    }
  }

  // --- UNTERSCHRIFT ---
  ensureSpace(120);

  page.drawText("Kundenunterschrift", {
    x: MARGIN, y: yPos, size: 12, font: helveticaBold, color: BLACK,
  });
  yPos -= 10;

  if (disturbance.unterschrift_kunde) {
    try {
      const sigData = dataUriToBytes(disturbance.unterschrift_kunde);
      const sigImage = sigData.type.includes("png")
        ? await doc.embedPng(sigData.bytes)
        : await doc.embedJpg(sigData.bytes);

      const sigDims = sigImage.scaleToFit(170, 71); // ~60mm x 25mm
      page.drawImage(sigImage, {
        x: MARGIN,
        y: yPos - sigDims.height,
        width: sigDims.width,
        height: sigDims.height,
      });
      yPos -= sigDims.height + 8;
    } catch (e) {
      console.error("Error adding signature:", e);
      page.drawText("[Unterschrift konnte nicht geladen werden]", {
        x: MARGIN, y: yPos - 14, size: 10, font: helveticaOblique, color: GRAY,
      });
      yPos -= 28;
    }
  }

  // Confirmation text
  const confirmText = "Der Kunde bestaetigt mit seiner Unterschrift die ordnungsgemaesse Durchfuehrung der oben genannten Arbeiten.";
  const confirmLines = wrapText(confirmText, helvetica, 9, CONTENT_WIDTH);
  for (const line of confirmLines) {
    page.drawText(line, {
      x: MARGIN, y: yPos, size: 9, font: helvetica, color: GRAY,
    });
    yPos -= 12;
  }

  // Footer on last page
  const footerY = MARGIN - 20;
  page.drawText(
    `Erstellt am: ${new Date().toLocaleDateString("de-AT")} | Tischlerei Birgmann`,
    { x: MARGIN, y: Math.max(footerY, 20), size: 8, font: helvetica, color: LIGHT_GRAY }
  );

  return await doc.save();
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

        <p>im Anhang finden Sie den Regiebericht f&uuml;r den Einsatz bei <strong>${disturbance.kunde_name}</strong> vom <strong>${formatDate(disturbance.datum)}</strong>.</p>

        <div class="info-box">
          <strong>Zusammenfassung:</strong><br>
          Techniker: ${technicianDisplay}<br>
          Arbeitszeit: ${disturbance.start_time.slice(0, 5)} - ${disturbance.end_time.slice(0, 5)} Uhr<br>
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

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    // Fetch photo images from storage as raw bytes
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const photoImages: ({ bytes: Uint8Array; type: string } | null)[] = [];
    if (photos && photos.length > 0) {
      console.log(`Fetching ${photos.length} photos...`);
      for (const photo of photos) {
        const photoUrl = `${supabaseUrl}/storage/v1/object/public/disturbance-photos/${photo.file_path}`;
        const imageData = await fetchImageBytes(photoUrl);
        photoImages.push(imageData);
      }
    }

    // Generate PDF
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await generatePDF({ disturbance, materials, technicians, photos }, photoImages);
    } catch (pdfError) {
      console.error("PDF generation failed:", pdfError);
      throw new Error(`PDF-Erstellung fehlgeschlagen: ${pdfError instanceof Error ? pdfError.message : "Unbekannter Fehler"}`);
    }

    const pdfBase64 = uint8ArrayToBase64(pdfBytes);
    console.log("PDF generated, size:", pdfBytes.length, "bytes");

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
      throw new Error("Keine Empfaenger-E-Mail-Adresse vorhanden. Bitte Kunden-E-Mail oder Buero-E-Mail in den Einstellungen hinterlegen.");
    }

    // Create filename
    const dateForFilename = formatDateShort(disturbance.datum).replace(/\./g, "-");
    const kundeForFilename = disturbance.kunde_name.replace(/[^a-zA-Z0-9äöüÄÖÜß]/g, "_");
    const pdfFilename = `Regiebericht_${kundeForFilename}_${dateForFilename}.pdf`;

    const subject = `Regiebericht - ${disturbance.kunde_name} - ${formatDateShort(disturbance.datum)}`;

    console.log("Sending email with PDF attachment to:", recipients);

    // Send email via Resend REST API
    const apiKey = Deno.env.get("RESEND_API_KEY")!;
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tischlerei Birgmann <noreply@chrisnapetschnig.at>",
        to: recipients,
        subject: subject,
        html: emailHtml,
        attachments: [
          {
            filename: pdfFilename,
            content: pdfBase64,
          },
        ],
      }),
    });

    if (!resendResponse.ok) {
      const errorBody = await resendResponse.text();
      console.error("Resend API error:", resendResponse.status, errorBody);
      throw new Error(`E-Mail-Versand fehlgeschlagen (${resendResponse.status}): ${errorBody}`);
    }

    const emailResponse = await resendResponse.json();
    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ success: true, emailResponse }),
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
