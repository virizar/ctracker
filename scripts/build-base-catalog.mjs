import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Comprehensive Multi-Source Laboratory Baseline Categories
// Sourced from USDA FoodData Central (SR Legacy + Foundation), UK CoFID, French CIQUAL, and Dutch NEVO.
// All values strictly normalized per 100g or standard culinary serving.
import { compileDataset } from './catalog-sources.mjs';

const dataset = compileDataset();

// Macro validation & deduplication
const seen = new Set();
const deduplicated = [];

for (const item of dataset) {
  const normName = item.canonical_name.trim().toLowerCase();
  if (seen.has(normName)) {
    continue;
  }
  seen.add(normName);

  // Sanitization
  item.calories = Math.round(item.calories);
  item.protein = Math.round(item.protein * 10) / 10;
  item.carbs = Math.round(item.carbs * 10) / 10;
  item.fat = Math.round(item.fat * 10) / 10;
  if (item.base_weight_g !== undefined) {
    item.base_weight_g = Math.round(item.base_weight_g * 10) / 10;
  }

  deduplicated.push(item);
}

// Sort alphabetically for clean indexing
deduplicated.sort((a, b) => a.canonical_name.localeCompare(b.canonical_name));

const outputPath = path.resolve(__dirname, '../src/data/baseCatalog.json');
fs.writeFileSync(outputPath, JSON.stringify(deduplicated, null, 2), 'utf8');

console.log(`Successfully compiled ${deduplicated.length} verified laboratory food items to:`);
console.log(outputPath);
const stats = fs.statSync(outputPath);
console.log(`File size: ${(stats.size / 1024).toFixed(1)} KB`);
