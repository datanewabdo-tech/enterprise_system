import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../server/db.js';
import { generateAnalyticsExport } from '../server/analyticsExporter.js';

describe('Analytics export formats', () => {
  test('generates CSV, Excel, PDF, Word, and multi-analysis ZIP files', async () => {
    initDatabase();

    const analysis = {
      title: 'Mission counts',
      table: 'missions',
      dimensions: ['mission'],
      metrics: [{ id: 'mission_count', label: 'Count', aggregation: 'COUNT' }],
      limit: 5,
      chartImage: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=',
    };

    const analysisWithoutImage = { ...analysis, chartImage: undefined };
    const csv = await generateAnalyticsExport({ format: 'csv', analyses: [analysisWithoutImage] });
    assert.match(csv.mime, /text\/csv/);
    assert.equal(csv.buffer.subarray(0, 3).toString('utf8'), '\uFEFF');

    const plainExcel = await generateAnalyticsExport({ format: 'xlsx', analyses: [analysisWithoutImage] });
    const excel = await generateAnalyticsExport({ format: 'xlsx', analyses: [analysis] });
    assert.equal(excel.buffer.subarray(0, 2).toString('ascii'), 'PK');
    assert.ok(excel.buffer.length > plainExcel.buffer.length, 'Excel workbook should contain the embedded chart image');

    const pdf = await generateAnalyticsExport({ format: 'pdf', analyses: [analysis] });
    assert.equal(pdf.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
    assert.ok(pdf.buffer.toString('latin1').includes('/Subtype /Image'));

    const plainWord = await generateAnalyticsExport({ format: 'docx', analyses: [analysisWithoutImage] });
    const word = await generateAnalyticsExport({ format: 'docx', analyses: [analysis] });
    assert.equal(word.buffer.subarray(0, 2).toString('ascii'), 'PK');
    assert.equal(word.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.ok(word.buffer.length > plainWord.buffer.length, 'Word report should contain the embedded chart image');

    const zip = await generateAnalyticsExport({
      format: 'zip',
      analyses: [analysis, { ...analysis, title: 'Mission counts second' }],
    });
    assert.equal(zip.buffer.subarray(0, 2).toString('ascii'), 'PK');
  });
});
