
import { executeDynamicAnalytics } from './analytics.js';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import archiver from 'archiver';
import { Writable } from 'node:stream';
import {
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  WidthType,
} from 'docx';

export interface AnalyticsExportAnalysis {
  title?: string;
  table: string;
  dimensions: string[];
  metrics?: Array<{
    id?: string;
    label?: string;
    aggregation: string;
    column?: string;
  }>;
  filters?: any;
  mission?: string;
  missionIds?: number[];
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
  aggregation?: string;
  dimensionCol?: string;
  metricCol?: string;
  chartImage?: string;
}

export interface AnalyticsExportOptions {
  format: 'csv' | 'xlsx' | 'pdf' | 'docx' | 'zip';
  language?: 'en' | 'ar';
  analyses: AnalyticsExportAnalysis[];
}

interface AnalysisResult {
  analysis: AnalyticsExportAnalysis;
  result: any;
}

function safeSheetName(name: string, used: Set<string>): string {
  const base =
    (name || 'Analysis')
      .replace(/[\\/*?[\]:]/g, '')
      .slice(0, 28) || 'Analysis';

  let candidate = base;
  let i = 2;

  while (used.has(candidate)) {
    candidate = `${base}_${i}`.slice(0, 31);
    i++;
  }

  used.add(candidate);
  return candidate;
}

/**
 * Execute one analytics query.
 *
 * executeDynamicAnalytics is asynchronous because it queries PostgreSQL
 * through Prisma. Always await its result before generating an export.
 */
async function runAnalysis(
  analysis: AnalyticsExportAnalysis
): Promise<any> {
  return await executeDynamicAnalytics({
    table: analysis.table,

    dimensions:
      analysis.dimensions?.length > 0
        ? analysis.dimensions
        : analysis.dimensionCol
          ? [analysis.dimensionCol]
          : [],

    dimensionCol: analysis.dimensionCol,
    metrics: analysis.metrics as any,
    metricCol: analysis.metricCol,
    aggregation: analysis.aggregation || 'COUNT',

    filters: analysis.filters,
    mission: analysis.mission,
    missionIds: analysis.missionIds,

    limit: analysis.limit ?? 1000,
    offset: analysis.offset ?? 0,

    sortBy: analysis.sortBy,
    sortOrder: analysis.sortOrder,
  });
}

function resultRows(result: any): any[] {
  return Array.isArray(result?.rows) ? result.rows : [];
}

/**
 * CSV export.
 */
function buildCsvForAnalysis(
  analysis: AnalyticsExportAnalysis,
  result: any
): string {
  const dimensions =
    result?.dimensions || analysis.dimensions || [];

  const metrics =
    result?.metrics || analysis.metrics || [];

  const metricLabels = metrics.map(
    (metric: any) =>
      metric.label || metric.id || metric.aggregation
  );

  const escape = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const header = [
    ...dimensions,
    ...metricLabels,
  ]
    .map(escape)
    .join(',');

  const rows = resultRows(result).map((row: any) => {
    const dimensionValues = dimensions.map(
      (dimension: string) => row[dimension]
    );

    const metricValues = metrics.map((metric: any) => {
      const key = metric.id || metric.label;
      return row[key] ?? '';
    });

    return [
      ...dimensionValues,
      ...metricValues,
    ]
      .map(escape)
      .join(',');
  });

  return '\uFEFF' + [header, ...rows].join('\r\n');
}

/**
 * Main export function.
 *
 * All analyses are executed and resolved before the selected export
 * format is generated.
 */
export async function generateAnalyticsExport(
  opts: AnalyticsExportOptions
): Promise<{
  buffer: Buffer;
  filename: string;
  mime: string;
}> {
  const lang = opts.language || 'en';
  const analyses = opts.analyses || [];

  if (!analyses.length) {
    throw new Error('No analyses provided');
  }

  if (!['csv', 'xlsx', 'pdf', 'docx', 'zip'].includes(opts.format)) {
    throw new Error(`Unsupported format: ${opts.format}`);
  }

  // Important: await PostgreSQL queries before generating documents.
  const results: AnalysisResult[] = await Promise.all(
    analyses.map(async (analysis) => ({
      analysis,
      result: await runAnalysis(analysis),
    }))
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);

  const baseName = `analytics_export_${timestamp}`;

  if (opts.format === 'csv') {
    if (results.length === 1) {
      const csv = buildCsvForAnalysis(
        results[0].analysis,
        results[0].result
      );

      return {
        buffer: Buffer.from(csv, 'utf8'),
        filename: `${baseName}.csv`,
        mime: 'text/csv; charset=utf-8',
      };
    }

    const zipBuffer = await buildZip(
      results.map((item, index) => ({
        name: makeCsvFilename(item.analysis, index),
        content: buildCsvForAnalysis(
          item.analysis,
          item.result
        ),
      }))
    );

    return {
      buffer: zipBuffer,
      filename: `${baseName}.zip`,
      mime: 'application/zip',
    };
  }

  if (opts.format === 'zip') {
    const zipBuffer = await buildZip(
      results.map((item, index) => ({
        name: makeCsvFilename(item.analysis, index),
        content: buildCsvForAnalysis(
          item.analysis,
          item.result
        ),
      }))
    );

    return {
      buffer: zipBuffer,
      filename: `${baseName}.zip`,
      mime: 'application/zip',
    };
  }

  if (opts.format === 'xlsx') {
    const workbook = new ExcelJS.Workbook();

    workbook.creator = 'Enterprise Analytics';
    workbook.created = new Date();

    const usedSheetNames = new Set<string>();

    for (const item of results) {
      const analysis = item.analysis;
      const result = item.result;

      const sheetName = safeSheetName(
        analysis.title || analysis.table || 'Analysis',
        usedSheetNames
      );

      const worksheet = workbook.addWorksheet(sheetName);

      const dimensions =
        result?.dimensions || analysis.dimensions || [];

      const metrics =
        result?.metrics || analysis.metrics || [];

      const metricLabels = metrics.map(
        (metric: any) =>
          metric.label || metric.id || metric.aggregation
      );

      const headers = [
        ...dimensions,
        ...metricLabels,
      ];

      let headerRowIndex = 1;

      const chartImage = decodeChartImage(
        analysis.chartImage
      );

      if (chartImage) {
        const { width, height } =
          getPngDimensions(chartImage);

        const imageId = workbook.addImage({
          base64: chartImage.toString('base64'),
          extension: 'png',
        });

        const imageWidth = 720;

        worksheet.addImage(imageId, {
          tl: { col: 0, row: 1 },
          ext: {
            width: imageWidth,
            height: imageWidth * height / width,
          },
        });

        headerRowIndex = 24;
      }

      const headerRow = worksheet.getRow(headerRowIndex);

      headerRow.values = headers;
      headerRow.font = {
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };

      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F46E5' },
      };

      for (const [rowIndex, row] of resultRows(result).entries()) {
        const values = [
          ...dimensions.map(
            (dimension: string) => row[dimension] ?? ''
          ),
          ...metrics.map((metric: any) => {
            const key = metric.id || metric.label;
            return row[key] ?? '';
          }),
        ];

        worksheet.getRow(
          headerRowIndex + rowIndex + 1
        ).values = values;
      }

      headers.forEach((header: string, index: number) => {
        const column = worksheet.getColumn(index + 1);
        column.width = Math.max(12, String(header).length + 4);
      });

      worksheet.views = [
        {
          state: 'frozen',
          ySplit: headerRowIndex,
        },
      ];
    }

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer: Buffer.from(buffer),
      filename: `${baseName}.xlsx`,
      mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  if (opts.format === 'pdf') {
    const pdfBuffer = await buildPdf(results, lang);

    return {
      buffer: pdfBuffer,
      filename: `${baseName}.pdf`,
      mime: 'application/pdf',
    };
  }

  if (opts.format === 'docx') {
    const docxBuffer = await buildWordDocument(results, lang);

    return {
      buffer: docxBuffer,
      filename: `${baseName}.docx`,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
  }

  throw new Error(`Unsupported format: ${opts.format}`);
}

function makeCsvFilename(
  analysis: AnalyticsExportAnalysis,
  index: number
): string {
  const base = (
    analysis.title ||
    analysis.table ||
    `analysis_${index + 1}`
  )
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 100);

  return `${base || `analysis_${index + 1}`}.csv`;
}

/**
 * Validate and decode a chart PNG data URL.
 */
function decodeChartImage(
  dataUrl?: string
): Buffer | undefined {
  if (!dataUrl) return undefined;

  const match =
    /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);

  if (!match) {
    throw new Error(
      'Chart image must be a base64 PNG data URL'
    );
  }

  const image = Buffer.from(match[1], 'base64');

  if (
    image.length === 0 ||
    image.length > 10 * 1024 * 1024 ||
    image.toString('hex', 0, 8) !== '89504e470d0a1a0a'
  ) {
    throw new Error(
      'Chart image is invalid or exceeds the 10 MB limit'
    );
  }

  return image;
}

function getPngDimensions(
  image: Buffer
): { width: number; height: number } {
  if (image.length < 24) {
    throw new Error('Chart image is incomplete');
  }

  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);

  if (!width || !height) {
    throw new Error('Chart image has invalid dimensions');
  }

  return { width, height };
}

/**
 * Create ZIP containing one CSV per analysis.
 */
function buildZip(
  entries: Array<{ name: string; content: string }>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', {
      zlib: { level: 9 },
    });

    const chunks: Buffer[] = [];

    const sink = new Writable({
      write(chunk: any, _encoding: any, callback: any) {
        chunks.push(Buffer.from(chunk));
        callback();
      },

      final(callback: any) {
        callback();
      },
    });

    sink.on('finish', () => {
      resolve(Buffer.concat(chunks));
    });

    sink.on('error', reject);
    archive.on('error', reject);

    archive.pipe(sink);

    for (const entry of entries) {
      archive.append(entry.content, {
        name: entry.name,
      });
    }

    archive.finalize().catch(reject);
  });
}

/**
 * Generate Word document.
 */
async function buildWordDocument(
  results: AnalysisResult[],
  lang: string
): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      text:
        lang === 'ar'
          ? 'تقرير التحليلات'
          : 'Analytics Report',
      heading: HeadingLevel.TITLE,
    }),

    new Paragraph({
      text: `${
        lang === 'ar'
          ? 'تاريخ الإنشاء'
          : 'Generated'
      }: ${new Date().toLocaleString()}`,
    }),
  ];

  for (const [index, item] of results.entries()) {
    const result = item.result;

    const dimensions =
      result?.dimensions || item.analysis.dimensions || [];

    const metrics =
      result?.metrics || item.analysis.metrics || [];

    const headers = [
      ...dimensions,
      ...metrics.map(
        (metric: any) =>
          metric.label || metric.id || metric.aggregation
      ),
    ];

    const rows = resultRows(result);

    children.push(
      new Paragraph({
        text:
          item.analysis.title ||
          `Analysis ${index + 1}`,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0,
      })
    );

    children.push(
      new Paragraph({
        text: `${
          lang === 'ar' ? 'الجدول' : 'Source table'
        }: ${item.analysis.table}`,
      })
    );

    const chartImage = decodeChartImage(
      item.analysis.chartImage
    );

    if (chartImage) {
      const { width, height } =
        getPngDimensions(chartImage);

      const imageWidth = Math.min(600, width);

      children.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: chartImage,
              transformation: {
                width: imageWidth,
                height: Math.min(
                  340,
                  imageWidth * height / width
                ),
              },
              type: 'png',
            }),
          ],
        })
      );
    }

    if (headers.length > 0) {
      const tableRows = [
        new TableRow({
          tableHeader: true,
          children: headers.map(
            (header: string) =>
              new TableCell({
                children: [
                  new Paragraph({
                    text: String(header),
                  }),
                ],
              })
          ),
        }),

        ...rows.map((row: any) =>
          new TableRow({
            children: [
              ...dimensions.map(
                (dimension: string) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        text: String(
                          row[dimension] ?? ''
                        ),
                      }),
                    ],
                  })
              ),

              ...metrics.map((metric: any) => {
                const key = metric.id || metric.label;

                return new TableCell({
                  children: [
                    new Paragraph({
                      text: String(
                        row[key] ??
                        row[metric.label] ??
                        ''
                      ),
                    }),
                  ],
                });
              }),
            ],
          })
        ),
      ];

      children.push(
        new Table({
          rows: tableRows,
          width: {
            size: 100,
            type: WidthType.PERCENTAGE,
          },
        })
      );
    }

    children.push(
      new Paragraph({
        text: `${
          lang === 'ar' ? 'عدد الصفوف' : 'Rows'
        }: ${rows.length}`,
      })
    );
  }

  const document = new Document({
    sections: [{ children }],
  });

  return Buffer.from(
    await Packer.toBuffer(document)
  );
}

/**
 * Generate PDF document.
 */
function buildPdf(
  results: AnalysisResult[],
  lang: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
    });

    const chunks: Buffer[] = [];

    doc.on('data', (chunk: any) => {
      chunks.push(Buffer.from(chunk));
    });

    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });

    doc.on('error', reject);

    const title =
      lang === 'ar'
        ? 'تقرير التحليلات'
        : 'Analytics Report';

    doc.fontSize(18).text(title, {
      align: 'center',
    });

    doc.moveDown(0.5);

    doc
      .fontSize(9)
      .fillColor('#666')
      .text(
        `${
          lang === 'ar' ? 'تاريخ الإنشاء' : 'Generated'
        }: ${new Date().toLocaleString()}`,
        { align: 'center' }
      );

    doc.moveDown(1);
    doc.fillColor('#000');

    results.forEach((item, index) => {
      if (index > 0) {
        doc.addPage();
      }

      const analysis = item.analysis;
      const result = item.result;

      const dimensions =
        result?.dimensions || analysis.dimensions || [];

      const metrics =
        result?.metrics || analysis.metrics || [];

      const metricLabels = metrics.map(
        (metric: any) =>
          metric.label || metric.id || metric.aggregation
      );

      const rows = resultRows(result);

      doc
        .fontSize(13)
        .fillColor('#4f46e5')
        .text(
          analysis.title || `Analysis ${index + 1}`,
          { underline: true }
        );

      doc.moveDown(0.3);

      doc.fontSize(9).fillColor('#333');

      doc.text(`Source table: ${analysis.table}`);
      doc.text(
        `Group by: ${dimensions.join(', ') || '-'}`
      );

      doc.text(
        `Metrics: ${
          metrics
            .map(
              (metric: any) =>
                `${metric.aggregation}${
                  metric.column
                    ? `(${metric.column})`
                    : ''
                }`
            )
            .join(', ') || '-'
        }`
      );

      if (
        analysis.filters &&
        Array.isArray(analysis.filters) &&
        analysis.filters.length > 0
      ) {
        doc.text(
          `Filters: ${analysis.filters.length} condition(s)`
        );
      }

      doc.moveDown(0.5);

      const chartImage = decodeChartImage(
        analysis.chartImage
      );

      if (chartImage) {
        const pageWidth = doc.page.width - 80;

        if (doc.y > doc.page.height - 300) {
          doc.addPage();
        }

        doc.image(chartImage, 40, doc.y, {
          fit: [pageWidth, 240],
          align: 'center',
        });

        doc.y += 250;
      }

      const columnCount =
        dimensions.length + metricLabels.length;

      const pageWidth = doc.page.width - 80;

      const columnWidth = Math.max(
        40,
        pageWidth / Math.max(1, columnCount)
      );

      const headers = [
        ...dimensions,
        ...metricLabels,
      ];

      doc.fontSize(8).fillColor('#fff');

      let x = 40;
      const headerY = doc.y;

      headers.forEach((header: string) => {
        doc
          .rect(x, headerY, columnWidth, 16)
          .fill('#4f46e5');

        doc
          .fillColor('#fff')
          .text(
            String(header),
            x + 2,
            headerY + 4,
            {
              width: columnWidth - 4,
              ellipsis: true,
            }
          );

        x += columnWidth;
      });

      doc.moveDown(1.1);
      doc.fillColor('#000');

      rows.slice(0, 200).forEach((row: any) => {
        if (doc.y > doc.page.height - 60) {
          doc.addPage();
        }

        x = 40;
        const rowY = doc.y;

        const values = [
          ...dimensions.map(
            (dimension: string) => row[dimension]
          ),
          ...metrics.map((metric: any) => {
            const key = metric.id || metric.label;
            return row[key];
          }),
        ].map((value: any) =>
          value === null || value === undefined
            ? ''
            : String(value)
        );

        values.forEach((value: string) => {
          doc.fontSize(8).text(
            value,
            x + 2,
            rowY,
            {
              width: columnWidth - 4,
              ellipsis: true,
            }
          );

          x += columnWidth;
        });

        doc.moveDown(0.9);
      });

      if (rows.length > 200) {
        doc.moveDown(0.5);

        doc
          .fontSize(8)
          .fillColor('#666')
          .text(
            `... and ${
              rows.length - 200
            } more rows (export CSV/XLSX for full data)`
          );

        doc.fillColor('#000');
      }

      doc.moveDown(0.5);

      doc
        .fontSize(9)
        .fillColor('#666')
        .text(`Rows: ${rows.length}`);

      doc.fillColor('#000');
    });

    doc.end();
  });
}
