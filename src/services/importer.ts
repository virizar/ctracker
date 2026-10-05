import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { getDatabase } from '../db/database';
import { logMeal, logScaleWeight } from '../db/queries';
import { recalculateUserTdee } from './tdee';
import { getGeminiApiKey, getGeminiModel } from './keychain';
import { DEFAULT_USERNAME } from '../types';

export interface ImportPreview {
  fileName: string;
  sourceFormat: string;
  weightsCount: number;
  mealsCount: number;
  startDate?: string;
  endDate?: string;
  executeImport: () => Promise<{ weightsImported: number; mealsImported: number }>;
}

export interface ColumnMapping {
  dataType: 'weights' | 'meals' | 'both';
  dateColumn: string;
  dateFormat: string; // 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'ISO'
  foodNameColumn?: string;
  servingSizeColumn?: string;
  caloriesColumn?: string;
  caloriesUnit?: 'kcal' | 'kJ';
  proteinColumn?: string;
  carbsColumn?: string;
  fatColumn?: string;
  weightColumn?: string;
  weightUnit?: 'kg' | 'lbs';
}

export function normalizeDate(rawDate: any, formatHint?: string): string | null {
  if (!rawDate) return null;
  const str = String(rawDate).trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Handle Excel Serial Dates (e.g. 45521)
  if (typeof rawDate === 'number' || /^\d{5}$/.test(str)) {
    const num = typeof rawDate === 'number' ? rawDate : parseInt(str, 10);
    const dateObj = new Date((num - (25567 + 2)) * 86400 * 1000);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toISOString().split('T')[0];
    }
  }

  // Handle MM/DD/YYYY or DD/MM/YYYY
  const parts = str.split(/[/.-]/);
  if (parts.length === 3) {
    let [p1, p2, p3] = parts;
    if (p3.length === 4) {
      // p3 is year
      const y = parseInt(p3, 10);
      let m = parseInt(p1, 10);
      let d = parseInt(p2, 10);

      if (formatHint === 'DD/MM/YYYY' || m > 12) {
        d = parseInt(p1, 10);
        m = parseInt(p2, 10);
      }

      if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }
  }

  // Fallback to Date parser
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

export function findRowDate(row: Record<string, any>): any {
  for (const k of Object.keys(row)) {
    const cleaned = k.replace(/^[ï»¿\uFEFF\"']+|[\"']+$/g, '').trim().toLowerCase();
    if (cleaned.includes('date')) {
      return row[k];
    }
  }
  return null;
}

export function buildServingSize(row: Record<string, any>, preferredUnitCol?: string): string {
  const qty =
    row['Serving Qty'] ??
    row['Serving Quantity'] ??
    row['Quantity'] ??
    row['quantity'] ??
    row['qty'];
  const unit =
    (preferredUnitCol ? row[preferredUnitCol] : undefined) ??
    row['Serving Size'] ??
    row['Serving'] ??
    row['Unit'] ??
    row['unit'];
  const weightG =
    row['Serving Weight (g)'] ??
    row['Weight (g)'] ??
    row['weight_g'] ??
    row['weight'];

  const parts: string[] = [];
  const unitStr = unit !== undefined && unit !== null ? String(unit).trim() : '';
  const isUnitGram = ['g', 'gram', 'grams', 'gr'].includes(unitStr.toLowerCase());

  if (qty !== undefined && qty !== null && String(qty).trim() !== '' && unitStr) {
    parts.push(`${qty} ${unitStr}`);
  } else if (unitStr) {
    parts.push(unitStr);
  } else if (qty !== undefined && qty !== null && String(qty).trim() !== '') {
    parts.push(String(qty));
  }

  if (!isUnitGram && weightG !== undefined && weightG !== null && !isNaN(parseFloat(weightG))) {
    const rounded = Math.round(parseFloat(weightG) * 10) / 10;
    if (rounded > 0) {
      if (parts.length > 0) {
        parts.push(`(${rounded}g)`);
      } else {
        parts.push(`${rounded}g`);
      }
    }
  }

  return parts.length > 0 ? parts.join(' ') : '1 serving';
}

export async function askGeminiForColumnMapping(
  headers: string[],
  sampleRows: Record<string, any>[]
): Promise<ColumnMapping> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is required to detect custom spreadsheet formats.');
  }

  const model = await getGeminiModel();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const prompt = `You are a data migration expert. Analyze the headers and sample rows from an exported fitness/health spreadsheet.
Identify the semantic mapping to our internal data model.

Headers: ${JSON.stringify(headers)}
Sample Rows: ${JSON.stringify(sampleRows.slice(0, 3))}

Determine:
1. dataType: 'weights' (only scale weights), 'meals' (food log with calories), or 'both'.
2. dateColumn: Exact name of the column containing the date.
3. dateFormat: Likely format (e.g. 'YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'ExcelSerial', 'ISO').
4. If meals present: foodNameColumn, servingSizeColumn, caloriesColumn, caloriesUnit ('kcal' or 'kJ'), proteinColumn, carbsColumn, fatColumn.
5. If weights present: weightColumn, weightUnit ('kg' or 'lbs').

Return ONLY a valid JSON object matching the ColumnMapping schema.`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Gemini mapping failed (${response.status})`);
  }

  const result = await response.json();
  const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
  return JSON.parse(jsonText);
}

async function readUriAsText(uri: string): Promise<string> {
  let text = '';
  try {
    const res = await fetch(uri);
    text = await res.text();
  } catch {
    const file = new File(uri);
    text = await file.text();
  }
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }
  return text;
}

async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  try {
    const res = await fetch(uri);
    if (typeof res.arrayBuffer === 'function') {
      return await res.arrayBuffer();
    }
    const blob = await res.blob();
    if (typeof blob.arrayBuffer === 'function') {
      return await blob.arrayBuffer();
    }
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
  } catch {
    const file = new File(uri);
    return await file.arrayBuffer();
  }
}

export async function pickAndInspectFile(
  targetUsername: string = DEFAULT_USERNAME
): Promise<ImportPreview | null> {
  const pickerResult = await DocumentPicker.getDocumentAsync({
    type: [
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      '*/*',
    ],
    copyToCacheDirectory: true,
  });

  if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
    return null;
  }

  const asset = pickerResult.assets[0];
  const fileName = asset.name || 'imported_file';
  const fileExt = fileName.split('.').pop()?.toLowerCase() || '';

  let weightsToInsert: Array<{ date: string; weight: number }> = [];
  let mealsToInsert: Array<{
    date: string;
    food_name: string;
    canonical_name?: string;
    serving_size?: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }> = [];

  let sourceFormat = 'Unknown Format';

  // 1. JSON Import (CTRACKER format or backup)
  if (fileExt === 'json') {
    const fileStr = await readUriAsText(asset.uri);
    const parsed = JSON.parse(fileStr);

    if (Array.isArray(parsed.weights)) {
      for (const w of parsed.weights) {
        if (w.date && typeof w.raw_weight === 'number') {
          weightsToInsert.push({ date: w.date, weight: w.raw_weight });
        }
      }
    }

    if (Array.isArray(parsed.meals)) {
      for (const m of parsed.meals) {
        if (m.date && m.food_name && typeof m.calories === 'number') {
          mealsToInsert.push({
            date: m.date,
            food_name: m.food_name,
            canonical_name: m.canonical_name,
            serving_size: m.serving_size,
            calories: m.calories,
            protein: m.protein || 0,
            carbs: m.carbs || 0,
            fat: m.fat || 0,
          });
        }
      }
    }
    sourceFormat = 'CTRACKER JSON Export';
  }

  // 2. Excel Import (.xlsx, .xls)
  else if (fileExt === 'xlsx' || fileExt === 'xls') {
    const arrayBuffer = await readUriAsArrayBuffer(asset.uri);
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });

    // Check for Multi-Sheet Fitness Log Pattern
    const sheetNames = workbook.SheetNames;
    const isMultiSheetFitness =
      sheetNames.some((s) => s.toLowerCase().includes('scale weight')) ||
      sheetNames.some((s) => s.toLowerCase().includes('nutrition'));

    if (isMultiSheetFitness) {
      sourceFormat = 'Multi-Sheet Fitness Spreadsheet';

      // Parse Scale Weight sheet
      const weightSheetName = sheetNames.find((s) =>
        s.toLowerCase().includes('scale weight')
      );
      if (weightSheetName) {
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[weightSheetName]);
        for (const row of rows) {
          const rawDate = row['Date'] || row['date'];
          const rawW = row['Weight'] || row['weight'] || row['Weight (kg)'];
          const normDate = normalizeDate(rawDate);
          if (normDate && rawW) {
            weightsToInsert.push({ date: normDate, weight: parseFloat(rawW) });
          }
        }
      }

      // Parse Nutrition sheet
      const foodSheetName = sheetNames.find((s) =>
        s.toLowerCase().includes('nutrition') || s.toLowerCase().includes('food')
      );
      if (foodSheetName) {
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[foodSheetName]);
        for (const row of rows) {
          const rawDate = row['Date'] || row['date'] || findRowDate(row);
          const normDate = normalizeDate(rawDate);
          const name = row['Food Name'] || row['Name'] || row['food_name'];
          const cals = row['Calories (kcal)'] || row['Calories'] || row['Energy (kcal)'];
          if (normDate && name && cals !== undefined) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              serving_size: buildServingSize(row),
              calories: parseFloat(cals) || 0,
              protein: parseFloat(row['Protein (g)'] || row['Protein'] || 0),
              carbs: parseFloat(row['Carbs (g)'] || row['Carbs'] || 0),
              fat: parseFloat(row['Fat (g)'] || row['Fat'] || 0),
            });
          }
        }
      }
    } else {
      // General single-sheet Excel -> Use AI Mapping
      const firstSheet = workbook.Sheets[sheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(firstSheet);
      if (rows.length > 0) {
        const headers = Object.keys(rows[0]);
        const mapping = await askGeminiForColumnMapping(headers, rows.slice(0, 3));
        sourceFormat = `Smart Excel (${mapping.dataType})`;
        processRowsWithMapping(rows, mapping, weightsToInsert, mealsToInsert);
      }
    }
  }

  // 3. CSV Import
  else {
    const csvStr = await readUriAsText(asset.uri);
    const parsedCsv = Papa.parse<Record<string, any>>(csvStr, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^[ï»¿\uFEFF\"']+|[\"']+$/g, '').trim(),
    });

    const rows = parsedCsv.data;
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);

      // Check for Standard Calorie & Macro CSV signature
      const isStandardNutritionCsv =
        headers.some((h) => h.toLowerCase() === 'food name') &&
        headers.some(
          (h) =>
            h.toLowerCase().includes('serving qty') ||
            h.toLowerCase().includes('calories (kcal)')
        );

      if (isStandardNutritionCsv) {
        sourceFormat = 'Standard Nutrition CSV';
        for (const row of rows) {
          const normDate = normalizeDate(row['Date'] || findRowDate(row));
          const name = row['Food Name'] || row['food_name'];
          const cals = parseFloat(row['Calories (kcal)'] ?? row['Calories'] ?? 0);
          if (normDate && name && !isNaN(cals)) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              serving_size: buildServingSize(row),
              calories: Math.round(cals),
              protein: parseFloat(row['Protein (g)'] || row['Protein'] || 0),
              carbs: parseFloat(row['Carbs (g)'] || row['Carbs'] || 0),
              fat: parseFloat(row['Fat (g)'] || row['Fat'] || 0),
            });
          }
        }
      }
      // Check for MyFitnessPal CSV signature
      else if (headers.includes('Meal') && headers.includes('Calories')) {
        sourceFormat = 'MyFitnessPal CSV';
        for (const row of rows) {
          const normDate = normalizeDate(row['Date'] || findRowDate(row));
          const name = row['Meal'] || row['Food Name'] || 'Food';
          const cals = parseFloat(row['Calories']);
          if (normDate && !isNaN(cals)) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              serving_size: buildServingSize(row),
              calories: cals,
              protein: parseFloat(row['Protein (g)'] || 0),
              carbs: parseFloat(row['Carbohydrates (g)'] || 0),
              fat: parseFloat(row['Fat (g)'] || 0),
            });
          }
        }
      }
      // Check for Cronometer CSV signature
      else if (
        headers.some((h) => h.toLowerCase().includes('energy (kcal)')) &&
        headers.some((h) => h.toLowerCase().includes('date'))
      ) {
        sourceFormat = 'Cronometer CSV';
        for (const row of rows) {
          const normDate = normalizeDate(row['Date'] || findRowDate(row));
          const cals = parseFloat(row['Energy (kcal)'] || 0);
          const name = row['Food Name'] || 'Meal';
          if (normDate && !isNaN(cals)) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              serving_size: buildServingSize(row),
              calories: cals,
              protein: parseFloat(row['Protein (g)'] || 0),
              carbs: parseFloat(row['Carbs (g)'] || 0),
              fat: parseFloat(row['Fat (g)'] || 0),
            });
          }
        }
      }
      // Check for Scale Weights CSV
      else if (
        headers.some((h) => h.toLowerCase().includes('weight')) &&
        (headers.length <= 5 || headers.some((h) => h.toLowerCase().includes('fat percent')))
      ) {
        sourceFormat = 'Scale Weight CSV';
        const wCol =
          headers.find((h) => h.toLowerCase() === 'weight (kg)' || h.toLowerCase() === 'weight') ||
          headers.find((h) => h.toLowerCase().includes('weight')) ||
          'Weight';
        const dCol = headers.find((h) => h.toLowerCase().includes('date')) || 'Date';
        for (const row of rows) {
          const normDate = normalizeDate(row[dCol] || findRowDate(row));
          const wVal = parseFloat(row[wCol]);
          if (normDate && !isNaN(wVal)) {
            weightsToInsert.push({ date: normDate, weight: wVal });
          }
        }
      }
      // Unrecognized CSV -> Use Gemini AI Schema Detection
      else {
        sourceFormat = 'Smart CSV (AI Detected)';
        const mapping = await askGeminiForColumnMapping(headers, rows.slice(0, 3));
        processRowsWithMapping(rows, mapping, weightsToInsert, mealsToInsert);
      }
    }
  }

  // Find date ranges
  const allDates = [
    ...weightsToInsert.map((w) => w.date),
    ...mealsToInsert.map((m) => m.date),
  ].sort();

  const startDate = allDates[0];
  const endDate = allDates[allDates.length - 1];

  return {
    fileName,
    sourceFormat,
    weightsCount: weightsToInsert.length,
    mealsCount: mealsToInsert.length,
    startDate,
    endDate,
    executeImport: async () => {
      const db = await getDatabase();
      let weightsImported = 0;
      let mealsImported = 0;

      await db.withTransactionAsync(async () => {
        // 1. Batch Insert Weights Idempotently
        if (weightsToInsert.length > 0) {
          const weightStmt = await db.prepareAsync(
            `INSERT INTO scale_weights (username, date, raw_weight)
             VALUES (?, ?, ?)
             ON CONFLICT(username, date) DO UPDATE SET raw_weight = excluded.raw_weight`
          );
          try {
            for (const w of weightsToInsert) {
              await weightStmt.executeAsync([targetUsername, w.date, w.weight]);
              weightsImported++;
            }
          } finally {
            await weightStmt.finalizeAsync();
          }
        }

        // 2. Cleanly replace any previous import for this exact date range so repeat foods (e.g. eating 2 eggs or 2 slices of bread) are NOT falsely discarded
        if (mealsToInsert.length > 0 && startDate && endDate) {
          await db.runAsync(
            `DELETE FROM meal_logs WHERE username = ? AND date >= ? AND date <= ?`,
            [targetUsername, startDate, endDate]
          );
        }

        // 3. Batch insert ALL meals from the export
        const uniqueCatalogMap = new Map<string, any>();
        if (mealsToInsert.length > 0) {
          const mealStmt = await db.prepareAsync(
            `INSERT INTO meal_logs (
              username, date, food_name, canonical_name, serving_size,
              calories, protein, carbs, fat
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          try {
            for (const m of mealsToInsert) {
              await mealStmt.executeAsync([
                targetUsername,
                m.date,
                m.food_name,
                m.canonical_name || m.food_name,
                m.serving_size || null,
                m.calories,
                m.protein || 0,
                m.carbs || 0,
                m.fat || 0,
              ]);
              mealsImported++;

              const canonical = m.canonical_name || m.food_name;
              if (!uniqueCatalogMap.has(canonical)) {
                uniqueCatalogMap.set(canonical, m);
              }
            }
          } finally {
            await mealStmt.finalizeAsync();
          }
        }

        // 4. Upsert food catalog & FTS5 index only ONCE per UNIQUE food item (cuts FTS index rebuilds by 95%!)
        if (uniqueCatalogMap.size > 0) {
          const catalogStmt = await db.prepareAsync(
            `INSERT INTO food_catalog (
              username, canonical_name, default_serving, calories, protein, carbs, fat, usage_count
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(username, canonical_name) DO UPDATE SET
              default_serving = COALESCE(excluded.default_serving, food_catalog.default_serving),
              calories = excluded.calories,
              protein = excluded.protein,
              carbs = excluded.carbs,
              fat = excluded.fat,
              usage_count = food_catalog.usage_count + 1,
              last_used_at = datetime('now')`
          );
          try {
            for (const [canonical, m] of uniqueCatalogMap) {
              await catalogStmt.executeAsync([
                targetUsername,
                canonical,
                m.serving_size || null,
                m.calories,
                m.protein || 0,
                m.carbs || 0,
                m.fat || 0,
              ]);
            }
          } finally {
            await catalogStmt.finalizeAsync();
          }
        }
      });

      // 5. Recalculate TDEE across the whole dataset
      await recalculateUserTdee(targetUsername);

      return { weightsImported, mealsImported };
    },
  };
}

function processRowsWithMapping(
  rows: any[],
  mapping: ColumnMapping,
  weightsOut: Array<{ date: string; weight: number }>,
  mealsOut: Array<any>
) {
  for (const row of rows) {
    const normDate = normalizeDate(row[mapping.dateColumn] || findRowDate(row), mapping.dateFormat);
    if (!normDate) continue;

    // Weight processing
    if (mapping.weightColumn && row[mapping.weightColumn] !== undefined) {
      let wVal = parseFloat(row[mapping.weightColumn]);
      if (!isNaN(wVal)) {
        if (mapping.weightUnit === 'lbs') {
          wVal = wVal / 2.20462;
        }
        weightsOut.push({ date: normDate, weight: Math.round(wVal * 10) / 10 });
      }
    }

    // Meal processing
    if (mapping.caloriesColumn && row[mapping.caloriesColumn] !== undefined) {
      let calVal = parseFloat(row[mapping.caloriesColumn]);
      if (!isNaN(calVal)) {
        if (mapping.caloriesUnit === 'kJ') {
          calVal = calVal / 4.184;
        }
        const foodName = mapping.foodNameColumn ? String(row[mapping.foodNameColumn] || 'Meal') : 'Meal';
        const serving = buildServingSize(row, mapping.servingSizeColumn);

        mealsOut.push({
          date: normDate,
          food_name: foodName,
          canonical_name: foodName,
          serving_size: serving,
          calories: Math.round(calVal),
          protein: mapping.proteinColumn ? parseFloat(row[mapping.proteinColumn]) || 0 : 0,
          carbs: mapping.carbsColumn ? parseFloat(row[mapping.carbsColumn]) || 0 : 0,
          fat: mapping.fatColumn ? parseFloat(row[mapping.fatColumn]) || 0 : 0,
        });
      }
    }
  }
}
