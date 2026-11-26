// Kleine Excel-Dateien für die Tests bauen, in den zwei Arten, die vorkommen:
// - 'excel': wie Excel speichert (Texte zentral in sharedStrings.xml, relative Pfade)
// - 'inline': wie manche Programme und Bibliotheken (Text direkt in der Zelle, absolute Pfade)
import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';

export type Cell = string | number | null;
export type SheetData = [name: string, rows: (Cell[] | null)[]]; // null = leere Zeile

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function column(index: number): string {
  let name = '';
  for (let i = index + 1; i > 0; i = Math.floor((i - 1) / 26)) name = String.fromCharCode(65 + ((i - 1) % 26)) + name;
  return name;
}

export async function buildXlsx(sheets: SheetData[], style: 'excel' | 'inline' = 'excel'): Promise<Blob> {
  const shared: string[] = [];
  const sharedIndex = (text: string) => {
    if (!shared.includes(text)) shared.push(text);
    return shared.indexOf(text);
  };
  const sheetXml = sheets.map(([, rows]) => {
    const body = rows
      .map((row, r) => {
        if (!row) return '';
        const cells = row
          .map((value, c) => {
            if (value === null || value === '') return '';
            const ref = `${column(c)}${r + 1}`;
            if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
            if (style === 'inline') return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`;
            return `<c r="${ref}" t="s"><v>${sharedIndex(value)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });

  const ns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const workbook =
    `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ns}"><sheets>` +
    sheets.map(([name], i) => `<sheet name="${escape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
    '</sheets></workbook>';
  const target = (i: number) => (style === 'inline' ? `/xl/worksheets/sheet${i + 1}.xml` : `worksheets/sheet${i + 1}.xml`);
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/worksheet" Target="${target(i)}"/>`).join('') +
    (style === 'excel' ? `<Relationship Id="rIdS" Type="${ns}/sharedStrings" Target="sharedStrings.xml"/>` : '') +
    '</Relationships>';
  const rootRels =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `<Relationship Id="rId1" Type="${ns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const zip = new ZipWriter(new BlobWriter());
  await zip.add('_rels/.rels', new TextReader(rootRels));
  await zip.add('xl/workbook.xml', new TextReader(workbook));
  await zip.add('xl/_rels/workbook.xml.rels', new TextReader(rels));
  for (const [i, xml] of sheetXml.entries()) await zip.add(`xl/worksheets/sheet${i + 1}.xml`, new TextReader(xml));
  if (style === 'excel') {
    // Ein Text aus zwei Stücken mit eigener Formatierung, wie Excel ihn bei gemischter Schrift ablegt
    const items = shared.map((text) => {
      const [a, b] = text.split('|');
      return b !== undefined
        ? `<si><r><rPr><b/></rPr><t>${escape(a)}</t></r><r><t xml:space="preserve">${escape(b)}</t></r></si>`
        : `<si><t xml:space="preserve">${escape(text)}</t></si>`;
    });
    await zip.add(
      'xl/sharedStrings.xml',
      new TextReader(`<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${items.join('')}</sst>`)
    );
  }
  return zip.close();
}
