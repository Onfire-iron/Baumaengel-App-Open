// =============================================================
// PDF-Bericht erzeugen (A4 hochformat)
// =============================================================
//
// Aufbau: Deckblatt mit den Projektangaben (Beteiligte, Begehungs- und Erstellungsdatum usw.), auf
// Seite 2 das Titelbild (nur wenn eines gewählt ist), Teilnehmer der Begehungen, Legende mit
// Mängeltabelle, je Plan ein Übersichtsplan, je Mangel eine Seite (Planausschnitt, Text, Fotos).
// Tabelle und Mängelseiten sind nach Nummer sortiert, erledigte Mängel folgen am Ende in einem eigenen
// Abschnitt. Es kommen nur die gewählten Punkttypen hinein (levels, z. B. ohne Intern).
// Ab Seite 2 steht oben eine Kopfzeile mit Projektnummer, Projekt und Logo, unten die Seitenzahl.
// Kopf- und Fußzeile kommen am Schluss, weil erst dann die Seitenzahl feststeht.
//
// Die Pläne werden mit PDF.js in hoher Auflösung als Bild gezeichnet. So klappt es mit
// jedem PDF, auch mit Scans und gedrehten Seiten. Punkte und Texte sind dagegen
// Vektorgrafik und bleiben beim Heranzoomen immer scharf.

import fontkit from '@pdf-lib/fontkit';
import {
  LineCapStyle,
  PDFDocument,
  PDFString,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib';
import type { Color, PDFFont, PDFImage, PDFPage } from 'pdf-lib';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as store from './db.ts';
import { IMPORTANCE, IMPORTANCE_TEXT, formatDate, isOverdue, sortForReport } from './defects.ts';
import { reportAddress, reportLogoUrl } from './divisions.ts';
import { googleMapsUrl } from './maps.ts';
import { INFO_PAGE_PARTIES } from './parties.ts';
import { openPdf } from './pdf.ts';
import { canvasToJpeg, shrinkPhoto } from './photos.ts';
import type { Defect, Importance, Inspection, Plan, Project, ReportSettings } from './types.ts';

// Alles, was die Zeichenfunktionen immer wieder brauchen
interface ReportContext {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  reportDate: string;
  charsets: Map<PDFFont, Set<number>>;
  logo?: PDFImage | null;
  header?: Header;
  top: number; // Oberkante des Inhalts unter der Kopfzeile, siehe layoutHeader
}

// Kopfzeile auf allen Seiten außer dem Deckblatt: links Projektnummer, Name, Datum und Ersteller,
// rechts das Logo mit der Adresse des Büros darunter wie auf dem Deckblatt. rechts das Logo in der Größe des Deckblatts. Sie ist auf jeder Seite gleich hoch.
interface HeaderLine {
  text: string;
  font: PDFFont;
  size: number;
  color: Color;
}

interface Header {
  lines: HeaderLine[];
  logo: { width: number; height: number } | null;
  office: string; // Adresse des Büros unter dem Logo
  lineY: number; // Unterkante der Kopfzeile, darunter beginnt der Inhalt
}

export interface ReportOptions {
  project: Project;
  plans: Plan[];
  pins: Defect[];
  settings: Partial<ReportSettings>;
  levels: Importance[]; // diese Punkttypen kommen in den Bericht
  dateText: string;
  reportDate: string;
  onProgress?: (done: number, total: number, text: string) => void;
  signal?: AbortSignal;
}

type PdfCache = ReturnType<typeof createPdfCache>;

interface Overview {
  plan: Plan;
  page: number;
  pageCount: number;
}

interface Point {
  x: number;
  y: number;
}

interface Region extends Point {
  width: number;
  height: number;
}

// Ein Punkt in der Legende hat keine Wichtigkeit, wenn er für "Erledigt" steht
type PinLook = { done: true; importance?: Importance } | { done: false; importance: Importance };

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - MARGIN;
const BOTTOM = 56; // darunter beginnt die Fußzeile

const CROP_H = 290; // Höhe des Planausschnitts auf der Mangel-Seite
const CROP_PORTION = 0.3; // Der Ausschnitt zeigt 30 % der längeren Planseite
const CROP_PIXELS = 1800; // entspricht rund 270 dpi im Bericht
const OVERVIEW_PIXELS = 3000;
const MAX_CANVAS_PIXELS = 16_000_000; // Grenze des iPads pro Zeichenfläche
const PLAN_JPEG_QUALITY = 0.85;
const PHOTO_SIDE = 1200;
const PHOTO_QUALITY = 0.75;

const COLOR = {
  brand: rgb(0.227, 0.208, 0.569), // #3A3591
  text: rgb(0.08, 0.125, 0.18),
  muted: rgb(0.31, 0.357, 0.412),
  line: rgb(0.478, 0.447, 0.91), // #7A72E8
  zebra: rgb(0.945, 0.957, 0.969),
  mangel: rgb(0.85, 0.19, 0.19),
  hinweis: rgb(0.1, 0.5, 0.27),
  intern: rgb(0.118, 0.518, 0.58), // #1E8494
  erledigt: rgb(0.373, 0.408, 0.451), // #5F6873
  white: rgb(1, 1, 1),
};

const LOGO_BOX = { width: 170, height: 70 }; // Logo auf dem Deckblatt und in der Kopfzeile
const HEADER_LINE_HEIGHT = 1.3; // Zeilenabstand in der Kopfzeile, mal Schriftgröße


// Erzeugt den Bericht und liefert ihn als Blob.
// onProgress(erledigt, gesamt, text) meldet den Fortschritt, signal bricht ab.
export async function buildReport({
  project,
  plans,
  pins: allPins,
  settings,
  levels,
  dateText,
  reportDate,
  onProgress,
  signal,
}: ReportOptions): Promise<Blob> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await loadFont(doc, 'LiberationSans-Regular.ttf');
  const bold = await loadFont(doc, 'LiberationSans-Bold.ttf');

  const name = settings.name || project.name;
  const pins = allPins.filter((pin) => levels.includes(pin.importance));
  doc.setTitle(`Bauüberwachungsbericht ${name}`);
  doc.setAuthor(settings.creator || '');
  doc.setCreator('Baumängel-App');
  doc.setLanguage('de-DE');

  const r: ReportContext = {
    doc,
    regular,
    bold,
    reportDate,
    charsets: new Map([
      [regular, new Set(regular.getCharacterSet())],
      [bold, new Set(bold.getCharacterSet())],
    ]),
    top: TOP,
  };

  r.logo = await loadLogo(doc, settings, project.division);
  r.header = layoutHeader(r, name, settings, dateText, reportAddress(project.division));
  r.top = r.header.lineY - 12;

  const pdfs = createPdfCache();
  try {
    const overviews = await collectOverviews(plans, pins, pdfs);
    const total = 2 + overviews.length + pins.length;
    let done = 0;
    const step = async (text: string) => {
      if (signal?.aborted) throw new DOMException('Abgebrochen', 'AbortError');
      onProgress?.(done++, total, text);
      await new Promise((resolve) => setTimeout(resolve)); // Bildschirm aktualisieren lassen
    };

    await step('Deckblatt wird erstellt …');
    drawCover(r, name, settings, dateText);
    await drawCoverPhoto(r, settings);
    drawInspections(r, settings.inspections ?? []);
    drawLegend(r, plans, pins, levels);
    let doneSectionDrawn = false;

    for (const [index, overview] of overviews.entries()) {
      await step(`Übersichtsplan ${index + 1} von ${overviews.length} wird gezeichnet …`);
      await drawOverview(r, overview, pins, pdfs);
    }

    for (const [index, pin] of sortForReport(pins).entries()) {
      await step(`Mangel ${index + 1} von ${pins.length} wird erstellt …`);
      if (pin.done && !doneSectionDrawn) {
        drawDoneSection(r, pins.filter((p) => p.done).length);
        doneSectionDrawn = true;
      }
      await drawDefect(r, pin, pins, plans, pdfs);
    }

    await step('Datei wird zusammengestellt …');
    drawHeadersAndFooters(r);
    const bytes = await doc.save();
    onProgress?.(total, total, 'Fertig');
    return new Blob([bytes as BlobPart], { type: 'application/pdf' });
  } finally {
    pdfs.close();
  }
}

async function loadFont(doc: PDFDocument, fileName: string) {
  const response = await fetch(`${import.meta.env.BASE_URL}pdfjs/standard_fonts/${fileName}`);
  if (!response.ok) throw new Error(`Schrift fehlt: ${fileName}`);
  // subset: nur die benutzten Buchstaben einbetten, das hält die Datei klein
  return doc.embedFont(await response.arrayBuffer(), { subset: true });
}

// Eigenes Logo des Projekts, sonst das Standardlogo seines Bereichs. null heißt: bewusst kein Logo.
async function loadLogo(doc: PDFDocument, settings: Partial<ReportSettings>, division: string | null | undefined) {
  if (settings.logo === null) return null;
  if (settings.logo) return doc.embedJpg(settings.logo);
  const response = await fetch(reportLogoUrl(division));
  if (!response.ok) throw new Error('Standardlogo fehlt');
  return doc.embedPng(await response.arrayBuffer());
}

// Hält immer nur ein PDF offen, damit dem iPad nicht der Arbeitsspeicher ausgeht
function createPdfCache() {
  let openPlanId: number | null = null;
  let pdf: PDFDocumentProxy | null = null;
  const close = () => {
    pdf?.loadingTask.destroy();
    pdf = null;
    openPlanId = null;
  };
  return {
    close,
    async get(planId: number) {
      if (planId !== openPlanId) {
        close();
        pdf = await openPdf(await store.getPlanData(planId));
        openPlanId = planId;
      }
      return pdf!;
    },
  };
}

// Pro Plan eine Seite. Bei mehrseitigen PDFs jede Seite, auf der Punkte liegen.
async function collectOverviews(plans: Plan[], pins: Defect[], pdfs: PdfCache) {
  const overviews: Overview[] = [];
  for (const plan of plans) {
    const pdf = await pdfs.get(plan.id);
    const pages = [...new Set(pins.filter((p) => p.planId === plan.id).map((p) => p.page))]
      .filter((page) => page <= pdf.numPages)
      .sort((a, b) => a - b);
    for (const page of pages.length > 0 ? pages : [1]) {
      overviews.push({ plan, page, pageCount: pdf.numPages });
    }
  }
  return overviews;
}

// =============================================================
// Text
// =============================================================

// Zeichen ohne Entsprechung in der Schrift (z. B. Emojis) würden als leeres Kästchen
// erscheinen. Die Umwandlung in die NFC-Form macht aus "a + Punkte" ein echtes "ä".
function clean(r: ReportContext, text: string | null | undefined, font: PDFFont) {
  const charset = r.charsets.get(font)!;
  let result = '';
  for (const char of String(text ?? '').normalize('NFC').replace(/\t/g, ' ')) {
    const code = char.codePointAt(0)!;
    if (code < 32 || (code >= 0x7f && code < 0xa0)) continue; // Steuerzeichen
    if (charset.has(code)) result += char;
    else if (!/[\p{Mn}‍️]/u.test(char)) result += '?';
  }
  return result;
}

function drawText(
  r: ReportContext,
  page: PDFPage,
  text: string | null | undefined,
  x: number,
  y: number,
  { font = r.regular, size = 11, color = COLOR.text }: { font?: PDFFont; size?: number; color?: Color } = {}
) {
  page.drawText(clean(r, text, font), { x, y, font, size, color });
}

// Unsichtbarer, antippbarer Bereich, der eine Internetadresse öffnet
function addLink(
  r: ReportContext,
  page: PDFPage,
  box: { x: number; y: number; width: number; height: number },
  url: string
) {
  const link = r.doc.context.register(
    r.doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height],
      Border: [0, 0, 0], // kein Rahmen um den Link
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
    })
  );
  page.node.addAnnot(link);
}

function textWidth(r: ReportContext, text: string, font: PDFFont, size: number) {
  return font.widthOfTextAtSize(clean(r, text, font), size);
}

// Bricht Text in Zeilen um, die in maxWidth passen. Absätze bleiben erhalten.
function wrapText(
  r: ReportContext,
  text: string | null | undefined,
  font: PDFFont,
  size: number,
  maxWidth: number
) {
  const lines: string[] = [];
  for (const paragraph of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(r, candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Ein einzelnes Wort länger als die Zeile wird hart getrennt
      line = '';
      for (const char of word) {
        if (textWidth(r, line + char, font, size) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Kürzt Text mit " …", bis er in maxWidth passt
function shorten(r: ReportContext, text: string, font: PDFFont, size: number, maxWidth: number) {
  let result = clean(r, text, font);
  if (textWidth(r, result, font, size) <= maxWidth) return result;
  while (result && textWidth(r, `${result} …`, font, size) > maxWidth) result = result.slice(0, -1);
  return `${result.trimEnd()} …`;
}

// =============================================================
// Grafik-Bausteine
// =============================================================

function fit(width: number, height: number, boxWidth: number, boxHeight: number) {
  const factor = Math.min(boxWidth / width, boxHeight / height);
  return { width: width * factor, height: height * factor };
}

// Zeichnet ein Bild zentriert in eine Box. y ist die Unterkante der Box.
function drawImageInBox(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number
) {
  const size = fit(image.width, image.height, boxWidth, boxHeight);
  const rect = {
    x: x + (boxWidth - size.width) / 2,
    y: y + (boxHeight - size.height) / 2,
    ...size,
  };
  page.drawImage(image, rect);
  return rect;
}

// Zeichnet einen Haken. (x, y) ist seine Mitte, size seine Breite.
function drawCheck(page: PDFPage, x: number, y: number, size: number, color: Color) {
  const left = { x: x - size * 0.5, y: y + size * 0.02 };
  const bottom = { x: x - size * 0.14, y: y - size * 0.34 };
  const right = { x: x + size * 0.5, y: y + size * 0.36 };
  for (const [start, end] of [[left, bottom], [bottom, right]]) {
    page.drawLine({ start, end, color, thickness: size * 0.2, lineCap: LineCapStyle.Round });
  }
}

// Form wie in der App: Mangel als Kreis, Hinweis als Raute, Intern als Quadrat.
// So bleibt die Wichtigkeit auch im Schwarz-Weiß-Druck und bei Farbschwäche erkennbar.
function drawLevelShape(
  page: PDFPage,
  importance: Importance,
  x: number,
  y: number,
  radius: number,
  border: { borderColor?: Color; borderWidth?: number } = {}
) {
  const color = COLOR[importance];
  if (importance === 'intern') {
    const side = radius * 1.8;
    page.drawRectangle({ x: x - side / 2, y: y - side / 2, width: side, height: side, color, ...border });
  } else if (importance === 'hinweis') {
    // pdf-lib dreht um die linke untere Ecke, die damit zur unteren Spitze wird
    const side = radius * 1.65;
    page.drawRectangle({
      x,
      y: y - side * Math.SQRT1_2,
      width: side,
      height: side,
      rotate: degrees(45),
      color,
      ...border,
    });
  } else {
    page.drawCircle({ x, y, size: radius, color, ...border });
  }
}

// Erledigte Punkte: grau, mit Haken statt Nummer, etwas kleiner und durchscheinend
function drawPin(
  r: ReportContext,
  page: PDFPage,
  x: number,
  y: number,
  radius: number,
  number: number,
  pin: PinLook
) {
  if (pin.done) {
    const size = radius * 0.85;
    page.drawCircle({
      x,
      y,
      size,
      color: COLOR.erledigt,
      borderColor: COLOR.white,
      borderWidth: size * 0.2,
      opacity: 0.85,
      borderOpacity: 0.85,
    });
    drawCheck(page, x, y, size, COLOR.white);
    return;
  }

  drawLevelShape(page, pin.importance, x, y, radius, { borderColor: COLOR.white, borderWidth: radius * 0.2 });
  const size = radius * (String(number).length > 2 ? 0.85 : 1.05);
  const width = r.bold.widthOfTextAtSize(String(number), size);
  page.drawText(String(number), {
    x: x - width / 2,
    y: y - size * 0.36,
    font: r.bold,
    size,
    color: COLOR.white,
  });
}

// Zeichnet die Punkte einer Planseite. Erledigte zuerst, damit sie offene nicht verdecken.
function drawPins(
  r: ReportContext,
  page: PDFPage,
  pins: Defect[],
  radius: number,
  toPosition: (pin: Defect) => Point | null,
  skip?: Defect
) {
  const order = [...pins].sort((a, b) => Number(a.done) - Number(b.done));
  for (const pin of order) {
    if (pin === skip) continue;
    const position = toPosition(pin);
    if (position) drawPin(r, page, position.x, position.y, radius, pin.number, pin as PinLook);
  }
}

// Farbiges Schild, rechtsbündig an right. Liefert die linke Kante für das nächste Schild.
function drawBadge(
  r: ReportContext,
  page: PDFPage,
  text: string,
  right: number,
  y: number,
  color: Color,
  textColor: Color,
  withCheck: boolean = false
) {
  const checkSpace = withCheck ? 15 : 0;
  const width = textWidth(r, text, r.bold, 11) + 16 + checkSpace;
  const left = right - width;
  page.drawRectangle({ x: left, y: y - 5, width, height: 22, color });
  if (withCheck) drawCheck(page, left + 13, y + 6, 10, textColor);
  drawText(r, page, text, left + 8 + checkSpace, y + 2, { font: r.bold, size: 11, color: textColor });
  return left;
}

function drawHeading(r: ReportContext, page: PDFPage, text: string, y: number = r.top - 16) {
  const size = 18;
  const lines = wrapText(r, text, r.bold, size, CONTENT_W);
  let lineY = y;
  for (const line of lines) {
    drawText(r, page, line, MARGIN, lineY, { font: r.bold, size, color: COLOR.brand });
    lineY -= size * 1.25;
  }
  return lineY;
}

function addPage(r: ReportContext) {
  return r.doc.addPage([PAGE_W, PAGE_H]);
}

// Zeichnet einen Bereich einer PDF-Seite als JPEG. region in PDF-Einheiten.
async function renderRegion(pdfPage: PDFPageProxy, region: Region, targetPixels: number) {
  const scale = Math.min(
    targetPixels / Math.max(region.width, region.height),
    Math.sqrt(MAX_CANVAS_PIXELS / (region.width * region.height))
  );
  const viewport = pdfPage.getViewport({
    scale,
    offsetX: -region.x * scale,
    offsetY: -region.y * scale,
  });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(region.width * scale);
  canvas.height = Math.ceil(region.height * scale);
  await pdfPage.render({ canvas, viewport }).promise;

  const jpeg = await canvasToJpeg(canvas, PLAN_JPEG_QUALITY);
  canvas.width = 0; // gibt den Speicher auf dem iPad sofort frei
  pdfPage.cleanup();
  return jpeg;
}

// =============================================================
// Deckblatt mit Projektangaben
// =============================================================

const TITLE = 'Bauüberwachungsbericht';

// Oben links der Titel, rechts das Logo und darunter die Adresse des Büros. Darunter Name, Adresse und
// Projektnummer des Objekts und die Projektangaben. Das Titelbild steht auf Seite 2 (drawCoverPhoto).
function drawCover(r: ReportContext, name: string, settings: Partial<ReportSettings>, dateText: string) {
  const page = addPage(r);
  let y = TOP;

  // Logo oben rechts, darunter die Adresse des Büros, wie in der Kopfzeile der übrigen Seiten
  const right = drawLogoAndOffice(r, page);

  // Der Titel wird kleiner, wenn er sonst an Logo oder Adresse stößt
  const room = CONTENT_W - (right.width ? right.width + 18 : 0);
  const titleSize = Math.min(28, (28 * room) / textWidth(r, TITLE, r.bold, 28));
  drawText(r, page, TITLE, MARGIN, y - 28, { font: r.bold, size: titleSize, color: COLOR.brand });

  y = Math.min(y - 76, right.bottom - 10) - 12;

  for (const line of wrapText(r, name, r.bold, 24, CONTENT_W).slice(0, 3)) {
    y -= 24;
    drawText(r, page, line, MARGIN, y, { font: r.bold, size: 24 });
    y -= 6;
  }
  y -= 8;

  // Die Adresse ist ein Link zu Google Maps (Antippen im PDF-Programm öffnet die Karte)
  const addressTop = y;
  let addressWidth = 0;
  for (const line of wrapText(r, settings.address, r.regular, 13, CONTENT_W).filter(Boolean).slice(0, 6)) {
    y -= 17;
    drawText(r, page, line, MARGIN, y, { size: 13 });
    addressWidth = Math.max(addressWidth, textWidth(r, line, r.regular, 13));
  }
  const mapsUrl = googleMapsUrl(settings.address);
  if (mapsUrl && addressWidth > 0) {
    addLink(r, page, { x: MARGIN, y: y - 4, width: addressWidth, height: addressTop - y + 4 }, mapsUrl);
  }

  // Projektnummer unter der Adresse (in den Projektangaben steht sie deshalb nicht)
  const projectNumber = settings.projectNumber?.trim();
  if (projectNumber) {
    if (addressWidth > 0) y -= 10;
    y -= 17;
    const label = 'Projektnummer: ';
    drawText(r, page, label, MARGIN, y, { size: 13, color: COLOR.muted });
    const labelWidth = textWidth(r, label, r.regular, 13);
    drawText(r, page, shorten(r, projectNumber, r.regular, 13, CONTENT_W - labelWidth), MARGIN + labelWidth, y, {
      size: 13,
    });
  }

  drawProjectInfo(r, page, y - 34, settings, dateText);
}

// Projektangaben unter dem Textblock des Deckblatts: Beteiligte, dann Begehungsdatum (die letzte
// Begehung), Erstellungsdatum und Ersteller als kompakte Tabelle, Bezeichnung links, Wert rechts.
// Leere Angaben fallen weg. Reicht der Platz nicht, geht es auf der nächsten Seite weiter.
function drawProjectInfo(
  r: ReportContext,
  firstPage: PDFPage,
  top: number,
  settings: Partial<ReportSettings>,
  dateText: string
) {
  const LABEL_SIZE = 10;
  const VALUE_SIZE = 11.5;
  const LINE = 14.5; // Zeilenabstand der Werte
  const PAD = 6; // Abstand über und unter jeder Zeile der Tabelle
  const SEPARATOR = rgb(0.84, 0.86, 0.89);

  const lastInspection = (settings.inspections ?? []).map((inspection) => inspection.date).sort().at(-1);
  const groups = [
    INFO_PAGE_PARTIES.map(({ key, label }) => ({ label, value: settings[key]?.trim() ?? '' })),
    [
      { label: 'Begehungsdatum', value: lastInspection ? formatDate(lastInspection) : '' },
      { label: 'Erstellungsdatum', value: dateText },
      { label: 'Ersteller', value: settings.creator?.trim() ?? '' },
    ],
  ]
    .map((group) => group.filter((row) => row.value))
    .filter((group) => group.length);
  if (!groups.length) return;

  // Die Spalte für die Bezeichnungen ist so breit wie die längste davon ("Brandschutzdienststelle")
  const labelWidth = Math.max(...groups.flat().map((row) => textWidth(r, row.label, r.regular, LABEL_SIZE))) + 18;
  const valueWidth = CONTENT_W - labelWidth;

  let page = firstPage;
  let y = top;
  drawText(r, page, 'Projektangaben', MARGIN, y, { font: r.bold, size: 14, color: COLOR.brand });
  y -= 8;
  for (const [groupIndex, group] of groups.entries()) {
    if (groupIndex > 0) y -= 12; // Abstand zwischen Beteiligten und den Daten
    for (const row of group) {
      const lines = wrapText(r, row.value, r.regular, VALUE_SIZE, valueWidth).filter(Boolean).slice(0, 12);
      const height = PAD * 2 + lines.length * LINE;
      if (y - height < BOTTOM) {
        page = addPage(r);
        y = drawHeading(r, page, 'Projektangaben (Fortsetzung)') - 6;
      }
      let lineY = y - PAD - VALUE_SIZE + 1;
      drawText(r, page, row.label, MARGIN, lineY + 1, { size: LABEL_SIZE, color: COLOR.muted });
      for (const line of lines) {
        drawText(r, page, line, MARGIN + labelWidth, lineY, { size: VALUE_SIZE });
        lineY -= LINE;
      }
      y -= height;
      page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_W - MARGIN, y }, thickness: 0.6, color: SEPARATOR });
    }
  }
}

// Titelbild auf einer eigenen Seite nach dem Deckblatt, so groß wie möglich. Ohne Bild keine Seite.
async function drawCoverPhoto(r: ReportContext, settings: Partial<ReportSettings>) {
  if (!settings.coverPhoto) return;
  const page = addPage(r);
  const photo = await r.doc.embedJpg(settings.coverPhoto);
  const top = r.top - 16;
  const bottom = BOTTOM + 8;
  const size = fit(photo.width, photo.height, CONTENT_W, top - bottom);
  // oben bündig, waagerecht in der Mitte
  page.drawImage(photo, { x: MARGIN + (CONTENT_W - size.width) / 2, y: top - size.height, ...size });
}

// =============================================================
// Begehungen
// =============================================================

// Je Begehung eine Tabelle: Kopf "Teilnehmer am …" und "Amt / Büro / Firma",
// darunter Name und Firma. Älteste Begehung zuerst. Eine Tabelle wird nur zerteilt, wenn sie länger als
// eine Seite ist, und wiederholt dann auf der nächsten ihren Kopf. Ohne Begehungen keine Seite.
function drawInspections(r: ReportContext, inspections: Inspection[]) {
  if (!inspections.length) return;
  const SIZE = 11;
  const LINE = 14;
  const HEAD_H = 22;
  const PAD = 4; // über und unter jeder Zeile
  const ORG_X = MARGIN + CONTENT_W * 0.48;
  const nameWidth = ORG_X - MARGIN - 16;
  const orgWidth = MARGIN + CONTENT_W - ORG_X - 8;
  const HEAD_FILL = rgb(0.87, 0.86, 0.95);
  const BORDER = rgb(0.6, 0.66, 0.74);
  const HEAD_TEXT = rgb(0.165, 0.145, 0.439);

  let page = addPage(r);
  let y = drawHeading(r, page, 'Teilnehmer der Begehungen') - 10;

  for (const inspection of inspections) {
    const rows = inspection.participants.length
      ? inspection.participants.map(({ name, org }) => {
          const nameLines = wrapText(r, name, r.regular, SIZE, nameWidth).filter(Boolean);
          const orgLines = wrapText(r, org, r.regular, SIZE, orgWidth).filter(Boolean);
          return { nameLines, orgLines, height: Math.max(nameLines.length, orgLines.length, 1) * LINE + PAD * 2 };
        })
      : [{ nameLines: ['keine Teilnehmer eingetragen'], orgLines: [], height: LINE + PAD * 2, empty: true }];

    // Passt die Tabelle nicht mehr ganz auf die Seite, aber auf eine neue, kommt sie ganz auf die
    // nächste. Nur längere Tabellen werden zerteilt, dann bleiben wenigstens Kopf und erste Zeile zusammen.
    const tableHeight = HEAD_H + rows.reduce((sum, row) => sum + row.height, 0) + 2;
    const fitsOnNewPage = tableHeight <= r.top - 16 - 10 - BOTTOM - 20;
    if (y - (fitsOnNewPage ? tableHeight : HEAD_H + rows[0].height) < BOTTOM) {
      page = addPage(r);
      y = drawHeading(r, page, 'Teilnehmer der Begehungen (Fortsetzung)') - 10;
    }

    let tableTop = y;
    const drawHead = (suffix: string) => {
      page.drawRectangle({ x: MARGIN, y: y - HEAD_H, width: CONTENT_W, height: HEAD_H, color: HEAD_FILL });
      const textY = y - HEAD_H + 7;
      const title = `Teilnehmer am ${formatDate(inspection.date)}${suffix}`;
      drawText(r, page, title, MARGIN + 8, textY, { font: r.bold, size: SIZE, color: HEAD_TEXT });
      drawText(r, page, 'Amt / Büro / Firma', ORG_X, textY, { font: r.bold, size: SIZE, color: HEAD_TEXT });
      y -= HEAD_H;
    };
    const drawBorder = () =>
      page.drawRectangle({
        x: MARGIN,
        y,
        width: CONTENT_W,
        height: tableTop - y,
        borderColor: BORDER,
        borderWidth: 0.8,
      });

    drawHead('');
    for (const row of rows) {
      if (y - row.height < BOTTOM) {
        drawBorder();
        page = addPage(r);
        y = drawHeading(r, page, 'Teilnehmer der Begehungen (Fortsetzung)') - 10;
        tableTop = y;
        drawHead(' (Fortsetzung)');
      }
      let lineY = y - PAD - SIZE + 1;
      const color = 'empty' in row ? COLOR.muted : COLOR.text;
      row.nameLines.forEach((line, i) => drawText(r, page, line, MARGIN + 8, lineY - i * LINE, { size: SIZE, color }));
      row.orgLines.forEach((line, i) => drawText(r, page, line, ORG_X, lineY - i * LINE, { size: SIZE }));
      y -= row.height;
    }
    y -= 2;
    drawBorder();
    y -= 24;
  }
}

// =============================================================
// Legende und Tabelle
// =============================================================

function planLabel(pin: Defect, plans: Plan[]) {
  const plan = plans.find((p) => p.id === pin.planId);
  return (plan?.pageCount ?? 0) > 1 ? `${plan!.name}, Seite ${pin.page}` : plan?.name ?? '';
}

function drawLegend(r: ReportContext, plans: Plan[], pins: Defect[], levels: Importance[]) {
  let page = addPage(r);
  let y = drawHeading(r, page, 'Legende') - 8;

  // Nur die Punkttypen, die im Bericht vorkommen dürfen
  const openPins = pins.filter((p) => !p.done);
  for (const importance of IMPORTANCE.filter((level) => levels.includes(level))) {
    const count = openPins.filter((p) => p.importance === importance).length;
    drawPin(r, page, MARGIN + 9, y + 4, 9, 1, { importance, done: false });
    drawText(r, page, `${IMPORTANCE_TEXT[importance]}: ${count} offen`, MARGIN + 26, y, { size: 12 });
    y -= 26;
  }
  drawPin(r, page, MARGIN + 9, y + 4, 9, 1, { done: true });
  drawText(
    r,
    page,
    `Erledigt: ${pins.length - openPins.length} (Haken statt Nummer, die Art bleibt angegeben)`,
    MARGIN + 26,
    y,
    { size: 12 }
  );
  y -= 26;
  const overdueCount = pins.filter((p) => isOverdue(p, r.reportDate)).length;
  if (overdueCount > 0) {
    drawText(r, page, `Davon überfällig: ${overdueCount} (Frist vor dem Berichtsdatum abgelaufen)`, MARGIN, y, {
      font: r.bold,
      size: 12,
      color: COLOR.mangel,
    });
    y -= 26;
  }
  y -= 8;

  y = drawHeading(r, page, 'Übersicht der Mängel', y) - 2;

  if (pins.length === 0) {
    drawText(r, page, 'Es wurden keine Mängel erfasst.', MARGIN, y, { color: COLOR.muted });
    return;
  }

  const columns = [
    { title: 'Nr.', x: MARGIN + 6, width: 28 },
    { title: 'Überschrift', x: MARGIN + 40, width: 158 },
    { title: 'Plan', x: MARGIN + 204, width: 84 },
    { title: 'Gewerk / Firma', x: MARGIN + 294, width: 88 },
    { title: 'Frist', x: MARGIN + 386, width: 56 },
    { title: 'Art', x: MARGIN + 448, width: 60 },
  ];
  const lineHeight = 13;

  const drawHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 22, color: COLOR.brand });
    for (const column of columns) {
      drawText(r, page, column.title, column.x, y, { font: r.bold, size: 10, color: COLOR.white });
    }
    y -= 24;
  };
  drawHeader();

  const bandGap = 10; // Abstand zur Zeile darüber, deren Hintergrund sonst überdeckt würde
  const bandHeight = 24;
  const doneCount = pins.filter((p) => p.done).length;

  sortForReport(pins).forEach((pin, index, sorted) => {
    const titleLines = wrapText(r, pin.title || 'Ohne Überschrift', r.regular, 10, columns[1].width);
    const planLines = wrapText(r, planLabel(pin, plans), r.regular, 10, columns[2].width);
    const who = [pin.trade, pin.company].filter(Boolean).join(' / ');
    const whoLines = wrapText(r, who, r.regular, 10, columns[3].width);
    const height = Math.max(titleLines.length, planLines.length, whoLines.length) * lineHeight + 8;
    const startsDone = pin.done && !sorted[index - 1]?.done;

    if (y - height - (startsDone ? bandGap + bandHeight : 0) < BOTTOM) {
      page = addPage(r);
      y = r.top - 16;
      drawHeader();
    }

    // Eigener Abschnitt für die erledigten Mängel
    if (startsDone) {
      y -= bandGap;
      page.drawRectangle({ x: MARGIN, y: y - 6, width: CONTENT_W, height: 22, color: COLOR.erledigt });
      drawCheck(page, MARGIN + 12, y + 4, 10, COLOR.white);
      drawText(r, page, `Erledigte Mängel (${doneCount})`, MARGIN + 24, y, {
        font: r.bold,
        size: 10,
        color: COLOR.white,
      });
      y -= bandHeight;
    }

    if (index % 2 === 1) {
      page.drawRectangle({ x: MARGIN, y: y - height + 10, width: CONTENT_W, height, color: COLOR.zebra });
    }
    drawText(r, page, String(pin.number), columns[0].x, y, { font: r.bold, size: 10 });
    if (pin.done) drawCheck(page, columns[0].x + 24, y + 3.5, 9, COLOR.erledigt);
    const textColor = pin.done || !pin.title ? COLOR.muted : COLOR.text;
    titleLines.forEach((line, i) =>
      drawText(r, page, line, columns[1].x, y - i * lineHeight, { size: 10, color: textColor })
    );
    planLines.forEach((line, i) =>
      drawText(r, page, line, columns[2].x, y - i * lineHeight, {
        size: 10,
        color: pin.done ? COLOR.muted : COLOR.text,
      })
    );
    whoLines.forEach((line, i) =>
      drawText(r, page, line, columns[3].x, y - i * lineHeight, {
        size: 10,
        color: pin.done ? COLOR.muted : COLOR.text,
      })
    );
    const overdue = isOverdue(pin, r.reportDate);
    drawText(r, page, formatDate(pin.dueDate), columns[4].x, y, {
      font: overdue ? r.bold : r.regular,
      size: 10,
      color: overdue ? COLOR.mangel : pin.done ? COLOR.muted : COLOR.text,
    });
    // Form und Farbe wie auf dem Plan, die Schrift bleibt dunkel
    drawLevelShape(page, pin.importance, columns[5].x + 4, y + 3.5, 4);
    drawText(r, page, IMPORTANCE_TEXT[pin.importance], columns[5].x + 12, y, { font: r.bold, size: 10 });
    y -= height;
  });
}

// Trennseite vor den erledigten Mängeln
function drawDoneSection(r: ReportContext, count: number) {
  const page = addPage(r);
  page.drawRectangle({ x: MARGIN, y: r.top - 44, width: CONTENT_W, height: 44, color: COLOR.erledigt });
  drawCheck(page, MARGIN + 24, r.top - 22, 20, COLOR.white);
  drawText(r, page, `Erledigte Mängel (${count})`, MARGIN + 46, r.top - 29, {
    font: r.bold,
    size: 20,
    color: COLOR.white,
  });

  const text =
    (count === 1 ? 'Der folgende Mangel ist' : 'Die folgenden Mängel sind') +
    ' als erledigt markiert und nur noch zur Dokumentation aufgeführt. ' +
    'Nummer und Art (Mangel, Hinweis, Intern) bleiben angegeben.';
  let y = r.top - 72;
  for (const line of wrapText(r, text, r.regular, 12, CONTENT_W)) {
    drawText(r, page, line, MARGIN, y, { size: 12 });
    y -= 17;
  }
}

// =============================================================
// Übersichtsplan
// =============================================================

async function drawOverview(
  r: ReportContext,
  { plan, page: pageNumber, pageCount }: Overview,
  pins: Defect[],
  pdfs: PdfCache
) {
  const pdf = await pdfs.get(plan.id);
  const pdfPage = await pdf.getPage(pageNumber);
  const { width, height } = pdfPage.getViewport({ scale: 1 });
  const image = await r.doc.embedJpg(
    await renderRegion(pdfPage, { x: 0, y: 0, width, height }, OVERVIEW_PIXELS)
  );

  const page = addPage(r);
  const title = `Übersichtsplan: ${plan.name}` + (pageCount > 1 ? `, Seite ${pageNumber}` : '');
  const y = drawHeading(r, page, title);

  // Direkt unter der Überschrift, auch wenn ein Plan im Querformat nicht die ganze Seite füllt
  const size = fit(image.width, image.height, CONTENT_W, y + 6 - BOTTOM);
  const rect = { x: MARGIN + (CONTENT_W - size.width) / 2, y: y + 6 - size.height, ...size };
  page.drawImage(image, rect);
  page.drawRectangle({ ...rect, borderColor: COLOR.line, borderWidth: 0.75 });

  drawPins(r, page, pins, 7.5, (pin) =>
    pin.planId === plan.id && pin.page === pageNumber
      ? { x: rect.x + pin.x * rect.width, y: rect.y + rect.height * (1 - pin.y) }
      : null
  );
}

// =============================================================
// Seite pro Mangel
// =============================================================

function getCropRegion(pin: Defect, pageWidth: number, pageHeight: number): Region {
  // Gewünschter Ausschnitt im Seitenverhältnis des Platzes im Bericht
  const longSide = Math.max(pageWidth, pageHeight);
  const width = Math.min(longSide * CROP_PORTION, pageWidth);
  const height = Math.min((width * CROP_H) / CONTENT_W, pageHeight);
  // Der Ausschnitt rutscht am Planrand nach innen, der Punkt ist dann nicht mittig
  return {
    x: Math.min(pageWidth - width, Math.max(0, pin.x * pageWidth - width / 2)),
    y: Math.min(pageHeight - height, Math.max(0, pin.y * pageHeight - height / 2)),
    width,
    height,
  };
}

async function drawDefect(r: ReportContext, pin: Defect, pins: Defect[], plans: Plan[], pdfs: PdfCache) {
  const plan = plans.find((p) => p.id === pin.planId);
  const number = pin.number;
  const pdf = await pdfs.get(pin.planId);
  const pdfPage = await pdf.getPage(Math.min(pin.page, pdf.numPages));
  const { width: pageWidth, height: pageHeight } = pdfPage.getViewport({ scale: 1 });

  const region = getCropRegion(pin, pageWidth, pageHeight);
  const image = await r.doc.embedJpg(await renderRegion(pdfPage, region, CROP_PIXELS));

  let page = addPage(r);
  let y = r.top;

  // Planausschnitt mit Punkt
  const rect = drawImageInBox(page, image, MARGIN, y - CROP_H, CONTENT_W, CROP_H);
  const toX = (x: number) => rect.x + ((x * pageWidth - region.x) / region.width) * rect.width;
  const toY = (value: number) => rect.y + rect.height * (1 - (value * pageHeight - region.y) / region.height);

  // Andere Punkte im Ausschnitt klein zeigen, am Bildrand abgeschnitten
  page.pushOperators(
    pushGraphicsState(),
    rectangle(rect.x, rect.y, rect.width, rect.height),
    clip(),
    endPath()
  );
  drawPins(
    r,
    page,
    pins,
    7.5,
    (other) =>
      other.planId === pin.planId && other.page === pin.page ? { x: toX(other.x), y: toY(other.y) } : null,
    pin
  );
  page.pushOperators(popGraphicsState());
  page.drawRectangle({ ...rect, borderColor: COLOR.line, borderWidth: 0.75 });

  // Der Punkt selbst mit deutlichem Ring
  const color = pin.done ? COLOR.erledigt : COLOR[pin.importance];
  const x = toX(pin.x);
  const markerY = toY(pin.y);
  page.drawCircle({ x, y: markerY, size: 21, borderColor: COLOR.white, borderWidth: 5.5 });
  page.drawCircle({ x, y: markerY, size: 21, borderColor: color, borderWidth: 3 });
  drawPin(r, page, x, markerY, 12, number, pin as PinLook);

  y = y - CROP_H - 13;
  drawText(r, page, `Plan: ${planLabel(pin, plans)}`, MARGIN, y, { size: 9, color: COLOR.muted });
  y -= 30;

  // Nummer, Wichtigkeit und bei Bedarf "Erledigt"
  drawText(r, page, `Mangel ${number}`, MARGIN, y, { font: r.bold, size: 18, color: COLOR.brand });
  const badgeLeft = drawBadge(
    r,
    page,
    IMPORTANCE_TEXT[pin.importance],
    PAGE_W - MARGIN,
    y,
    COLOR[pin.importance],
    COLOR.white
  );
  if (pin.done) drawBadge(r, page, 'Erledigt', badgeLeft - 6, y, COLOR.erledigt, COLOR.white, true);
  y -= 22;

  const continuation = () => {
    page = addPage(r);
    const heading = `Mangel ${number} (Fortsetzung${pin.done ? ', erledigt' : ''})`;
    drawText(r, page, heading, MARGIN, r.top - 14, { font: r.bold, size: 13, color: COLOR.brand });
    y = r.top - 38;
  };

  // Überschrift und Notizen laufen bei Bedarf auf der nächsten Seite weiter
  const drawFlowing = (text: string, font: PDFFont, size: number, lineHeight: number, color2: Color) => {
    for (const line of wrapText(r, text, font, size, CONTENT_W)) {
      if (y - lineHeight < BOTTOM) continuation();
      drawText(r, page, line, MARGIN, y, { font, size, color: color2 });
      y -= lineHeight;
    }
  };
  drawFlowing(pin.title || 'Ohne Überschrift', r.bold, 14, 18, pin.title ? COLOR.text : COLOR.muted);
  y -= 2;

  // Gewerk, Firma und Termine, leere Angaben entfallen
  const joinParts = (parts: (string | false | null)[]) => parts.filter(Boolean).join('  ·  ');
  const who = joinParts([pin.trade && `Gewerk: ${pin.trade}`, pin.company && `Firma: ${pin.company}`]);
  const dates = joinParts([
    pin.foundAt && `Festgestellt: ${formatDate(pin.foundAt)}`,
    pin.createdBy && `Erfasst von: ${pin.createdBy}`,
    pin.doneAt && `Erledigt: ${formatDate(pin.doneAt)}`,
  ]);
  if (who) drawFlowing(who, r.regular, 10, 14, COLOR.muted);
  if (dates) drawFlowing(dates, r.regular, 10, 14, COLOR.muted);
  if (pin.dueDate) {
    const overdue = isOverdue(pin, r.reportDate);
    const text = `Frist: ${formatDate(pin.dueDate)}${overdue ? ' (überfällig)' : ''}`;
    drawFlowing(text, overdue ? r.bold : r.regular, 10, 14, overdue ? COLOR.mangel : COLOR.muted);
  }
  y -= 6;
  if (pin.notes) drawFlowing(pin.notes, r.regular, 11, 15, COLOR.text);
  y -= 8;

  // Fotos: eins groß, mehrere als Raster mit zwei Spalten
  const photos = await store.getPhotos(pin.id);
  const gap = 12;
  const columns = photos.length === 1 ? 1 : 2;
  const cellWidth = (CONTENT_W - gap * (columns - 1)) / columns;
  const cellHeight = photos.length === 1 ? 300 : 190;
  const minSingleHeight = 170;

  for (const [index, photo] of photos.entries()) {
    const column = index % columns;
    let height = cellHeight;
    if (photos.length === 1) {
      height = Math.min(cellHeight, y - BOTTOM); // ein Einzelfoto nutzt den Rest der Seite
      if (height < minSingleHeight) {
        continuation();
        height = cellHeight;
      }
    } else if (column === 0 && y - cellHeight < BOTTOM) {
      continuation();
    }

    const cellX = MARGIN + column * (cellWidth + gap);
    const cellY = y - height;
    page.drawRectangle({ x: cellX, y: cellY, width: cellWidth, height, color: COLOR.zebra });

    // Die Bildunterschrift steht unten in der Zelle, das Foto nutzt den Platz darüber
    const captionLines = photo.caption ? wrapText(r, photo.caption, r.regular, 9, cellWidth - 12) : [];
    const captionHeight = captionLines.length > 0 ? captionLines.length * 12 + 6 : 0;
    captionLines.forEach((line, i) =>
      drawText(r, page, line, cellX + 6, cellY + captionHeight - 11 - i * 12, { size: 9 })
    );

    try {
      const shrunk = await shrinkPhoto(
        new Blob([photo.data], { type: 'image/jpeg' }),
        PHOTO_SIDE,
        PHOTO_QUALITY,
        photo.marks
      );
      const image = await r.doc.embedJpg(shrunk);
      drawImageInBox(page, image, cellX, cellY + captionHeight, cellWidth, height - captionHeight);
    } catch (err) {
      console.error(err);
      drawText(r, page, 'Foto konnte nicht gelesen werden.', cellX + 10, cellY + height / 2, {
        size: 10,
        color: COLOR.muted,
      });
    }
    if (column === columns - 1 || index === photos.length - 1) y -= height + gap;
  }
}

// =============================================================
// Kopf- und Fußzeile (nicht auf dem Deckblatt)
// =============================================================

// Legt die Kopfzeile fest, bevor die erste Seite entsteht: Ihre Höhe bestimmt, wo der Inhalt beginnt.
// Mit dem Standardlogo passen Projektnummer, Name sowie Datum und Ersteller neben das Logo,
// die Kopfzeile wird dann nicht höher als das Logo selbst.
function layoutHeader(
  r: ReportContext,
  name: string,
  settings: Partial<ReportSettings>,
  dateText: string,
  office: string
): Header {
  const logo = r.logo ? fit(r.logo.width, r.logo.height, LOGO_BOX.width, LOGO_BOX.height) : null;
  const officeWidth = office ? textWidth(r, office, r.regular, OFFICE_SIZE) : 0;
  const rightWidth = Math.max(logo?.width ?? 0, officeWidth);
  const width = CONTENT_W - (rightWidth ? rightWidth + 20 : 0);
  const lines: HeaderLine[] = [];

  // Zu langer Text wird nach maxLines Zeilen mit " …" gekürzt
  const add = (text: string, font: PDFFont, size: number, color: Color, maxLines: number) => {
    const wrapped = wrapText(r, text, font, size, width).filter(Boolean);
    if (wrapped.length > maxLines) {
      wrapped.splice(maxLines - 1, Infinity, shorten(r, wrapped.slice(maxLines - 1).join(' '), font, size, width));
    }
    for (const line of wrapped) lines.push({ text: line, font, size, color });
  };

  // Projektnummer über dem Namen, ohne Bezeichnung, beide blau und fett
  add(settings.projectNumber?.trim() ?? '', r.bold, 12, COLOR.brand, 1);
  add(name, r.bold, 12, COLOR.brand, 2);
  const meta = [dateText && `Datum: ${dateText}`, settings.creator && `Ersteller: ${settings.creator}`];
  add(meta.filter(Boolean).join('   ·   '), r.regular, 8.5, COLOR.muted, 1);

  const textHeight = lines.reduce((sum, line) => sum + line.size * HEADER_LINE_HEIGHT, 0);
  const rightHeight = (logo?.height ?? 0) + (office ? OFFICE_GAP + 3 : 0);
  return { lines, logo, office, lineY: TOP - Math.max(rightHeight, textHeight) - 10 };
}

const OFFICE_SIZE = 9; // Schriftgröße der Büro-Adresse unter dem Logo
const OFFICE_GAP = 13; // Abstand ihrer Grundlinie zur Unterkante des Logos

// Logo oben rechts und darunter rechtsbündig die Adresse des Büros, auf jeder Seite an derselben Stelle.
// Liefert die Breite und die Unterkante des Ganzen.
function drawLogoAndOffice(r: ReportContext, page: PDFPage) {
  let width = 0;
  let bottom = TOP;
  if (r.logo) {
    const size = fit(r.logo.width, r.logo.height, LOGO_BOX.width, LOGO_BOX.height);
    page.drawImage(r.logo, { x: PAGE_W - MARGIN - size.width, y: TOP - size.height, ...size });
    width = size.width;
    bottom = TOP - size.height;
  }
  const office = r.header!.office;
  if (office) {
    const officeWidth = textWidth(r, office, r.regular, OFFICE_SIZE);
    bottom -= OFFICE_GAP;
    drawText(r, page, office, PAGE_W - MARGIN - officeWidth, bottom, { size: OFFICE_SIZE, color: COLOR.muted });
    width = Math.max(width, officeWidth);
  }
  return { width, bottom };
}

function drawHeadersAndFooters(r: ReportContext) {
  const { lines } = r.header!;
  const pages = r.doc.getPages();
  pages.forEach((page, index) => {
    if (index === 0) return;

    // Kopfzeile: Logo und Büro-Adresse an derselben Stelle wie auf dem Deckblatt, Text oben bündig daneben
    drawLogoAndOffice(r, page);
    let y = TOP;
    for (const line of lines) {
      drawText(r, page, line.text, MARGIN, y - line.size * 0.8, line);
      y -= line.size * HEADER_LINE_HEIGHT;
    }

    // Fußzeile: nur die Seitenzahl, rechts unten
    const pageText = `Seite ${index + 1} von ${pages.length}`;
    const pageWidth = textWidth(r, pageText, r.regular, 9);
    drawText(r, page, pageText, PAGE_W - MARGIN - pageWidth, 28, { size: 9, color: COLOR.muted });
  });
}
