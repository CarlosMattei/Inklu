import HTMLtoDOCX from 'html-to-docx';
import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, sanitizeDocument } from './document-parser.service';
import { FormatoPlano } from '../models/plano.model';

export class DocumentGeneratorService {
  async generateFromHtml(html: string, format: FormatoPlano, name = 'Plano'): Promise<Buffer> {
    const safe = sanitizeDocument(html);
    const styled = `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(name)}</title><style>
      body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; margin: 0; }
      h1 { font-size: 16pt; text-align: center; } h2 { font-size: 13pt; } h3 { font-size: 11pt; }
      h1,h2,h3 { break-after: avoid; } p { margin: 0 0 8pt; } img { max-width: 100%; }
      table { border-collapse: collapse; width: 100%; } td,th { border: 1px solid #888; padding: 6pt; }
      @page { size: A4; } div[data-plan-field] { margin-bottom: 14pt; }
    </style></head><body>${safe}</body></html>`;
    if (format === 'html') return Buffer.from(styled);
    if (format === 'docx') {
      const output = await HTMLtoDOCX(styled, null, {
        title: name, font: 'Arial', fontSize: 22,
        pageSize: { width: 11906, height: 16838 },
        margins: { top: 1417, bottom: 1417, left: 1417, right: 1417 },
        table: { row: { cantSplit: true } }, lang: 'pt-BR',
      });
      return Buffer.from(output as ArrayBuffer);
    }
    const systemChrome = process.platform === 'win32' ? join(process.env['PROGRAMFILES'] || 'C:/Program Files', 'Google/Chrome/Application/chrome.exe') : '';
    const executablePath = process.env['PUPPETEER_EXECUTABLE_PATH'] || (systemChrome && existsSync(systemChrome) ? systemChrome : undefined);
    const browser = await puppeteer.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', request => {
        if (/^(data:|about:)/.test(request.url())) void request.continue(); else void request.abort();
      });
      await page.setContent(styled, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({
        format: 'A4', printBackground: true,
        margin: { top: '2.5cm', right: '2.5cm', bottom: '2.5cm', left: '2.5cm' },
      }));
    } finally { await browser.close(); }
  }
}
