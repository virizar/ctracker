import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { getDatabase } from '../db/database';
import { logMeal, logScaleWeight } from '../db/queries';
import { recalculateUserTdee } from './tdee';
import { getGeminiApiKey, getGeminiModel } from './keychain';

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

function normalizeDate(rawDate: any, formatHint?: string): string | null {
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

export async function pickAndInspectFile(): Promise<ImportPreview | null> {
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
    const fileStr = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
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
    const base64 = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const workbook = XLSX.read(base64, { type: 'base64' });

    // Check for FitnessLog Multi-Sheet Pattern
    const sheetNames = workbook.SheetNames;
    const isFitnessLog =
      sheetNames.some((s) => s.toLowerCase().includes('scale weight')) ||
      sheetNames.some((s) => s.toLowerCase().includes('nutrition'));

    if (isFitnessLog) {
      sourceFormat = 'FitnessLog Spreadsheet';

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
          const rawDate = row['Date'] || row['date'];
          const normDate = normalizeDate(rawDate);
          const name = row['Food Name'] || row['Name'] || row['food_name'];
          const cals = row['Calories (kcal)'] || row['Calories'] || row['Energy (kcal)'];
          if (normDate && name && cals !== undefined) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              serving_size: row['Serving'] || row['Serving Size'] || '1 serving',
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
    const csvStr = await FileSystem.readAsStringAsync(asset.uri, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    const parsedCsv = Papa.parse<Record<string, any>>(csvStr, {
      header: true,
      skipEmptyLines: true,
    });

    const rows = parsedCsv.data;
    if (rows.length > 0) {
      const headers = Object.keys(rows[0]);

      // Check for MyFitnessPal CSV signature
      if (headers.includes('Meal') && headers.includes('Calories')) {
        sourceFormat = 'MyFitnessPal CSV';
        for (const row of rows) {
          const normDate = normalizeDate(row['Date']);
          const name = row['Meal'] || row['Food Name'] || 'Food';
          const cals = parseFloat(row['Calories']);
          if (normDate && !isNaN(cals)) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              calories: cals,
              protein: parseFloat(row['Protein (g)'] || 0),
              carbs: parseFloat(row['Carbohydrates (g)'] || 0),
              fat: parseFloat(row['Fat (g)'] || 0),
            });
          }
        }
      }
      // Check for Cronometer CSV signature
      else if (headers.includes('Energy (kcal)') && headers.includes('Date')) {
        sourceFormat = 'Cronometer CSV';
        for (const row of rows) {
          const normDate = normalizeDate(row['Date']);
          const cals = parseFloat(row['Energy (kcal)']);
          const name = row['Food Name'] || 'Meal';
          if (normDate && !isNaN(cals)) {
            mealsToInsert.push({
              date: normDate,
              food_name: String(name),
              canonical_name: String(name),
              calories: cals,
              protein: parseFloat(row['Protein (g)'] || 0),
              carbs: parseFloat(row['Carbs (g)'] || 0),
              fat: parseFloat(row['Fat (g)'] || 0),
            });
          }
        }
      }
      // Check for Scale Weights CSV
      else if (headers.length <= 4 && (headers.includes('Weight') || headers.includes('weight'))) {
        sourceFormat = 'Scale Weight CSV';
        const wCol = headers.find((h) => h.toLowerCase().includes('weight')) || 'Weight';
        const dCol = headers.find((h) => h.toLowerCase().includes('date')) || 'Date';
        for (const row of rows) {
          const normDate = normalizeDate(row[dCol]);
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

      // 1. Insert Weights Idempotently
      for (const w of weightsToInsert) {
        await logScaleWeight('victor', w.date, w.weight);
        weightsImported++;
      }

      // 2. Insert Meals Idempotently (skip if same date, food_name, calories exists)
      for (const m of mealsToInsert) {
        const existing = await db.getFirstAsync(
          `SELECT id FROM meal_logs WHERE username = ? AND date = ? AND food_name = ? AND calories = ?`,
          ['victor', m.date, m.food_name, m.calories]
        );
        if (!existing) {
          await logMeal('victor', m);
          mealsImported++;
        }
      }

      // 3. Recalculate TDEE across the whole dataset
      await recalculateUserTdee('victor');

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
    const normDate = normalizeDate(row[mapping.dateColumn], mapping.dateFormat);
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
        const serving = mapping.servingSizeColumn ? String(row[mapping.servingSizeColumn] || '') : '1 serving';

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
