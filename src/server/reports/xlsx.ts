// Gerador de planilhas .xlsx (Office Open XML) sem dependências além do JSZip.
import JSZip from 'jszip';

export type CellType = 'text' | 'date' | 'number' | 'percent';
export interface SheetSpec {
  name: string;
  columns: Array<{ header: string; width?: number; type?: CellType }>;
  rows: Array<Array<string | number | null | undefined>>;
}

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let s = '';
  let n = i + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Data AAAA-MM-DD → número de série do Excel (base 1899-12-30). */
export function excelSerial(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// estilos: 0 normal · 1 cabeçalho · 2 data · 3 texto com quebra · 4 porcentagem · 5 número
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="2"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0B4336"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9E2DE"/></left><right style="thin"><color rgb="FFD9E2DE"/></right><top style="thin"><color rgb="FFD9E2DE"/></top><bottom style="thin"><color rgb="FFD9E2DE"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"><alignment horizontal="center" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetXml(s: SheetSpec): string {
  const lastCol = colName(s.columns.length - 1);
  const lastRow = s.rows.length + 1;
  const cols = s.columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width ?? 18}" customWidth="1"/>`).join('');
  const header = `<row r="1" ht="22" customHeight="1">${s.columns.map((c, i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t>${xml(c.header)}</t></is></c>`).join('')}</row>`;
  const body = s.rows
    .map((row, ri) => {
      const r = ri + 2;
      const cells = row
        .map((v, ci) => {
          const ref = `${colName(ci)}${r}`;
          const type = s.columns[ci]?.type ?? 'text';
          if (v === null || v === undefined || v === '') return `<c r="${ref}" s="0"/>`;
          if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return `<c r="${ref}" s="2"><v>${excelSerial(v)}</v></c>`;
          if (type === 'percent' && typeof v === 'number') return `<c r="${ref}" s="4"><v>${v}</v></c>`;
          if (type === 'number' && typeof v === 'number') return `<c r="${ref}" s="5"><v>${v}</v></c>`;
          return `<c r="${ref}" s="3" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${header}${body}</sheetData>
${s.rows.length ? `<autoFilter ref="A1:${lastCol}${lastRow}"/>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
}

export async function buildXlsx(sheets: SheetSpec[]): Promise<Buffer> {
  const zip = new JSZip();
  const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>ASTRAL Smart Agenda</dc:title><dc:creator>ASTRAL Smart Agenda</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`,
  );
  zip.file('docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>ASTRAL Smart Agenda</Application></Properties>`);
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${(() => {
  const dn = sheets
    .map((s, i) => (s.rows.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(names[i])}'!$A$1:$${colName(s.columns.length - 1)}$${s.rows.length + 1}</definedName>` : ''))
    .filter(Boolean);
  return dn.length ? `<definedNames>${dn.join('')}</definedNames>` : '';
})()}
</workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file('xl/styles.xml', STYLES);
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
