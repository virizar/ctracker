export interface UserProfile {
  id?: number;
  username: string;
  dob: string; // YYYY-MM-DD
  height_cm: float;
  sex: 'male' | 'female';
  activity_multiplier: number;
  target_weight_kg: number | null;
  target_monthly_rate_kg: number;
  min_daily_calories: number;
  protein_ratio: number;
  carbs_ratio: number;
  fat_ratio: number;
  created_at?: string;
  updated_at?: string;
}

export type float = number;

export interface ScaleWeight {
  id?: number;
  username: string;
  date: string; // YYYY-MM-DD
  raw_weight: number;
  created_at?: string;
}

export interface MealLog {
  id?: number;
  username: string;
  date: string; // YYYY-MM-DD
  food_name: string;
  canonical_name?: string | null;
  serving_size?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  client_event_id?: string | null;
  created_at?: string;
}

export interface DailySummary {
  id?: number;
  username: string;
  date: string; // YYYY-MM-DD
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  raw_weight: number | null;
  trend_weight: number | null;
  tdee: number | null;
  target_calories: number | null;
  is_rate_capped_by_safety_floor: boolean;
  updated_at?: string;
}

export interface FoodCatalogItem {
  id?: number;
  username: string;
  canonical_name: string;
  default_serving?: string | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  usage_count: number;
  base_weight_g?: number | null;
  last_used_qty?: number | null;
  last_used_unit?: string | null;
  last_used_at?: string;
  created_at?: string;
}

export interface DashboardSummaryResponse {
  date: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  raw_weight: number | null;
  trend_weight: number | null;
  tdee: number | null;
  target_calories: number | null;
  protein_target_g: number;
  carbs_target_g: number;
  fat_target_g: number;
  target_weight_kg: number | null;
  target_monthly_rate_kg: number;
  min_daily_calories: number;
  is_rate_capped_by_safety_floor: boolean;
  projected_date_target_rate: string | null;
  projected_date_actual_rate: string | null;
  actual_monthly_rate_kg: number | null;
}

export interface ParsedFoodItem {
  food_name: string;
  canonical_name: string;
  serving_size: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}
