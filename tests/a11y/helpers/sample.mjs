// 접근성 시험에 쓰는 샘플 파일
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { workDir } from './workdir.mjs';

/** 서류 단계에 올릴 한 쪽짜리 PDF (화면 캡처와 같다). 서버는 확장자가 아니라 파일 머리(%PDF-)를 본다. */
export function samplePdf() {
  const text = 'BT /F1 18 Tf 72 720 Td (School record - a11y test) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objs.map((o, i) => {
    const at = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const dir = workDir('a11y');
  const file = path.join(dir, 'school-record.pdf');
  writeFileSync(file, pdf);
  return file;
}
