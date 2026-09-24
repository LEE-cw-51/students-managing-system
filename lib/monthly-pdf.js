import PDFDocument from 'pdfkit';
import fs from 'node:fs';
import path from 'node:path';

const FONT_CANDIDATES = [
  path.join(process.cwd(), 'public', 'fonts', 'NotoSansKR-Regular.otf'),
  path.join(process.cwd(), 'public', 'fonts', 'NotoSansCJKkr-Regular.otf')
];

const FONT_URL =
  'https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/Korean/NotoSansCJKkr-Regular.otf';

let cachedFont = null;

async function loadKoreanFont() {
  if (cachedFont) return cachedFont;
  for (const file of FONT_CANDIDATES) {
    if (fs.existsSync(file)) {
      cachedFont = fs.readFileSync(file);
      return cachedFont;
    }
  }
  const res = await fetch(FONT_URL);
  if (!res.ok) {
    throw new Error('한글 PDF 폰트를 불러오지 못했습니다. public/fonts/ 에 OTF 파일을 추가해 주세요.');
  }
  cachedFont = Buffer.from(await res.arrayBuffer());
  return cachedFont;
}

function writeLines(doc, text, opts) {
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((line) => {
    doc.text(line || ' ', opts);
  });
}

/**
 * @param {{ title: string, metaLines: string[], body: string }} input
 * @returns {Promise<Buffer>}
 */
export async function renderMonthlyReportPdf(input) {
  const font = await loadKoreanFont();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.registerFont('body', font);
    doc.font('body');

    doc.fontSize(18).text(input.title || '월간 학습 보고서', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#555555');
    (input.metaLines || []).forEach((line) => {
      doc.text(line, { align: 'center' });
    });
    doc.moveDown(1);
    doc.fillColor('#000000').fontSize(11);
    writeLines(doc, input.body, { lineGap: 4 });

    doc.end();
  });
}
