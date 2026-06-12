import { Jimp } from 'jimp';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsQR = require('jsqr') as (
  data: Uint8ClampedArray,
  width: number,
  height: number
) => { data: string } | null;
import Tesseract from 'tesseract.js';
import path from 'path';
import fs from 'fs';

export interface OcrBatteryResult {
  barcode: string | null;
  percentage: number | null;
  plateNumber: string | null;
  rawText: string;
  confidence: 'high' | 'medium' | 'low';
}

const BARCODE_PATTERNS = [
  /BATT[-\s]?(\d{3,6})/i,
  /(BATT\d{3,6})/i,
  /([A-Z]{2,5}-\d{4,8})/i,
];

const PCT_PATTERNS = [
  /(\d{1,3})\s*%/,
  /charge[:\s]*(\d{1,3})/i,
  /soc[:\s]*(\d{1,3})/i,
  /(\d{1,3})\s*percent/i,
];

const PLATE_PATTERNS = [
  /\b([K][A-Z]{1,2}\s?\d{3}[A-Z]{1,2})\b/i,
  /\b([K][A-Z]{2}\s\d{3}[A-Z])\b/i,
  /\b([A-Z]{3}\s?\d{3,4}[A-Z]?)\b/,
];

async function imageToRgba(filePath: string) {
  const image = await Jimp.read(filePath);
  const resized = image.resize({ w: Math.min(image.width, 1200) });
  const { width, height } = resized.bitmap;
  const buffer = resized.bitmap.data;
  return {
    width,
    height,
    data: new Uint8ClampedArray(buffer),
  };
}

function decodeQrFromImage(data: Uint8ClampedArray, width: number, height: number): string | null {
  const code = jsQR(data, width, height);
  return code?.data?.trim() ?? null;
}

function extractBarcode(text: string, qr: string | null): string | null {
  if (qr) {
    const normalized = qr.toUpperCase().replace(/\s/g, '');
    if (normalized.length >= 4) return normalized;
  }
  for (const re of BARCODE_PATTERNS) {
    const m = text.match(re);
    if (m) return (m[1] ? `BATT-${m[1]}` : m[0]).toUpperCase().replace(/\s/g, '');
  }
  return null;
}

function extractPercentage(text: string): number | null {
  for (const re of PCT_PATTERNS) {
    const m = text.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 0 && n <= 100) return n;
    }
  }
  const nums = text.match(/\b(\d{1,3})\b/g);
  if (nums) {
    const candidates = nums.map(Number).filter((n) => n >= 1 && n <= 100);
    if (candidates.length === 1) return candidates[0];
    const likely = candidates.find((n) => n <= 99 && n !== 0);
    if (likely) return likely;
  }
  return null;
}

function extractPlate(text: string): string | null {
  for (const re of PLATE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1].toUpperCase().replace(/\s+/g, ' ').trim();
  }
export async function analyzeBatteryImage(
  filePath: string,
  mode: 'incoming' | 'outgoing'
): Promise<OcrBatteryResult> {
  const { width, height, data } = await imageToRgba(filePath);
  const qr = decodeQrFromImage(data, width, height);

  const { data: ocr } = await Tesseract.recognize(filePath, 'eng', {
    logger: () => {},
  });
  const rawText = ocr.text;

  const barcode = extractBarcode(rawText, qr);
  const percentage = extractPercentage(rawText);
  const plateNumber = mode === 'outgoing' ? extractPlate(rawText) : null;

  let confidence: OcrBatteryResult['confidence'] = 'low';
  if (barcode && percentage != null) confidence = 'high';
  else if (barcode || percentage != null) confidence = 'medium';

  return { barcode, percentage, plateNumber, rawText, confidence };
}

export function uploadsUrl(filename: string): string {
  return `/uploads/${path.basename(filename)}`;
}
