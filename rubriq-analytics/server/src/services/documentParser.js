const fs = require('fs');
const path = require('path');

async function parseDocument(filePath, mimeType) {
  const ext = path.extname(filePath).toLowerCase();

  // PDF
  if (ext === '.pdf' || mimeType === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return { text: data.text, type: 'pdf', pages: data.numpages };
  }

  // Word DOCX
  if (ext === '.docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value, type: 'docx' };
  }

  // Excel
  if (['.xlsx', '.xls'].includes(ext) || mimeType?.includes('spreadsheet')) {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    let text = '';
    workbook.eachSheet(sheet => {
      text += `\n--- Sheet: ${sheet.name} ---\n`;
      sheet.eachRow(row => {
        const vals = [];
        row.eachCell(cell => { if (cell.value !== null && cell.value !== undefined) vals.push(String(cell.value)); });
        if (vals.length) text += vals.join('\t') + '\n';
      });
    });
    return { text, type: 'excel' };
  }

  // Images — return as base64 for Claude vision
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(ext) || mimeType?.startsWith('image/')) {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const mediaType = mimeType || (ext === '.png' ? 'image/png' : 'image/jpeg');
    return { text: null, type: 'image', base64, mediaType };
  }

  // Plain text fallback
  const text = fs.readFileSync(filePath, 'utf8');
  return { text, type: 'text' };
}

module.exports = { parseDocument };
