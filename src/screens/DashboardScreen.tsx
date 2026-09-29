import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  TextInput,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getUserProfile,
  getDailySummary,
  getLatestDailySummary,
  getMealsByDate,
  deleteMeal,
  logScaleWeight,
} from '../db/queries';
import { recalculateUserTdee, formatDate, parseDate } from '../services/tdee';
import { UserProfile, DailySummary, MealLog } from '../types';

interface DashboardScreenProps {
  onOpenQuickLog: () => void;
  refreshTrigger?: number;
  currentDate?: string;
  onDateChange?: (date: string) => void;
}

export function DashboardScreen({
  onOpenQuickLog,
  refreshTrigger,
  currentDate: propDate,
  onDateChange,
}: DashboardScreenProps) {
  const [currentDate, setCurrentDate] = useState<string>(propDate || formatDate(new Date()));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [summary, setSummary] = useState<DailySummary | null>(null);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (propDate && propDate !== currentDate) {
      setCurrentDate(propDate);
    }
  }, [propDate]);

  const updateDate = (newDate: string) => {
    setCurrentDate(newDate);
    onDateChange?.(newDate);
  };

  // Weight Logging Modal State
  const [isWeightModalVisible, setIsWeightModalVisible] = useState(false);
  const [weightInput, setWeightInput] = useState('');

  const loadData = useCallback(async () => {
    try {
      const user = await getUserProfile('victor');
      setProfile(user);

      let daySummary = await getDailySummary('victor', currentDate);
      if (!daySummary) {
        daySummary = await getLatestDailySummary('victor', currentDate);
      }
      setSummary(daySummary);

      const dayMeals = await getMealsByDate('victor', currentDate);
      setMeals(dayMeals);
    } catch (e: any) {
      console.error('Error loading dashboard data:', e);
    }
  }, [currentDate]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshTrigger]);

  const onRefresh = async () => {
    setRefreshing(true);
    await recalculateUserTdee('victor');
    await loadData();
    setRefreshing(false);
  };

  const handlePrevDay = () => {
    const d = parseDate(currentDate);
    d.setDate(d.getDate() - 1);
    updateDate(formatDate(d));
  };

  const handleNextDay = () => {
    const d = parseDate(currentDate);
    d.setDate(d.getDate() + 1);
    updateDate(formatDate(d));
  };

  const handleToday = () => {
    updateDate(formatDate(new Date()));
  };

  const handleDeleteMeal = (mealId: number) => {
    Alert.alert('Delete Meal', 'Are you sure you want to remove this meal?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMeal(mealId);
          await recalculateUserTdee('victor');
          await loadData();
        },
      },
    ]);
  };

  const handleSaveWeight = async () => {
    const val = parseFloat(weightInput);
    if (isNaN(val) || val <= 30 || val >= 300) {
      Alert.alert('Invalid Weight', 'Please enter a valid weight in kg (e.g. 84.5)');
      return;
    }
    await logScaleWeight('victor', currentDate, val);
    setIsWeightModalVisible(false);
    setWeightInput('');
    await recalculateUserTdee('victor');
    await loadData();
  };

  // Real-time calculations directly from logged meals for instant UI response
  const mealCals = meals.reduce((acc, m) => acc + (m.calories || 0), 0);
  const mealProtein = meals.reduce((acc, m) => acc + (m.protein || 0), 0);
  const mealCarbs = meals.reduce((acc, m) => acc + (m.carbs || 0), 0);
  const mealFat = meals.reduce((acc, m) => acc + (m.fat || 0), 0);

  const consumedCals = meals.length > 0 ? mealCals : (summary?.total_calories ?? 0);
  const proteinConsumed = meals.length > 0 ? mealProtein : (summary?.total_protein ?? 0);
  const carbsConsumed = meals.length > 0 ? mealCarbs : (summary?.total_carbs ?? 0);
  const fatConsumed = meals.length > 0 ? mealFat : (summary?.total_fat ?? 0);

  const deficitKcal = profile
    ? Math.round((profile.target_monthly_rate_kg * 7700.0) / 30.4375)
    : 0;
  const maintenanceTdee = summary?.tdee ? Math.round(summary.tdee) : null;

  const targetCals = summary?.target_calories ?? (profile?.min_daily_calories ? profile.min_daily_calories + 300 : 2000);
  const remainingCals = Math.round(targetCals - consumedCals);

  const proteinTargetG = profile ? Math.round((targetCals * profile.protein_ratio) / 4) : 150;
  const carbsTargetG = profile ? Math.round((targetCals * profile.carbs_ratio) / 4) : 200;
  const fatTargetG = profile ? Math.round((targetCals * profile.fat_ratio) / 9) : 65;

  return (
    <View style={styles.container}>
      {/* Date Navigation Header */}
      <View style={styles.dateHeader}>
        <TouchableOpacity onPress={handlePrevDay} style={styles.dateNavBtn}>
          <Ionicons name="chevron-back" size={24} color="#0f172a" />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleToday}>
          <Text style={styles.dateTitle}>
            {currentDate === formatDate(new Date()) ? 'Today' : currentDate}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleNextDay} style={styles.dateNavBtn}>
          <Ionicons name="chevron-forward" size={24} color="#0f172a" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Calorie Ring / Budget Card */}
        <View style={styles.calorieCard}>
          <View style={styles.calorieRow}>
            <View>
              <Text style={styles.calorieLabel}>Consumed</Text>
              <Text style={styles.calorieValue}>{Math.round(consumedCals)}</Text>
              <Text style={styles.calorieUnit}>kcal</Text>
            </View>
            <View style={[styles.remainingCircle, remainingCals < 0 && styles.overTargetCircle]}>
              <Text style={[styles.remainingVal, remainingCals < 0 && styles.overTargetVal]}>
                {Math.abs(remainingCals)}
              </Text>
              <Text style={[styles.remainingLabel, remainingCals < 0 && styles.overTargetLabel]}>
                {remainingCals >= 0 ? 'Remaining' : 'Over Target'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.calorieLabel}>Daily Target</Text>
              <Text style={styles.calorieValue}>{Math.round(targetCals)}</Text>
              <Text style={styles.calorieUnit}>kcal</Text>
            </View>
          </View>

          {/* Goal & Deficit Explanation Breakdown */}
          <View style={styles.targetBreakdownRow}>
            <View style={styles.targetBreakdownItem}>
              <Text style={styles.targetBreakdownLabel}>Maintenance TDEE</Text>
              <Text style={styles.targetBreakdownVal}>
                {maintenanceTdee ? `${maintenanceTdee} kcal` : '--'}
              </Text>
            </View>
            <View style={styles.targetBreakdownDivider} />
            <View style={styles.targetBreakdownItem}>
              <Text style={styles.targetBreakdownLabel}>Goal Deficit</Text>
              <Text
                style={[
                  styles.targetBreakdownVal,
                  { color: deficitKcal < 0 ? '#10b981' : deficitKcal > 0 ? '#ef4444' : '#0f172a' },
                ]}
              >
                {deficitKcal !== 0
                  ? `${deficitKcal > 0 ? '+' : ''}${deficitKcal} kcal`
                  : 'Maintenance'}
              </Text>
            </View>
            <View style={styles.targetBreakdownDivider} />
            <View style={styles.targetBreakdownItem}>
              <Text style={styles.targetBreakdownLabel}>Target Budget</Text>
              <Text style={[styles.targetBreakdownVal, { color: '#2563eb', fontWeight: '700' }]}>
                {Math.round(targetCals)} kcal
              </Text>
            </View>
          </View>

          {summary?.is_rate_capped_by_safety_floor ? (
            <View style={styles.safetyFloorBadge}>
              <Ionicons name="shield-checkmark" size={14} color="#b45309" />
              <Text style={styles.safetyFloorText}>
                Safety Floor Active ({profile?.min_daily_calories} kcal min). Target intake adjusted for health.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Macros Breakdown Card */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Macronutrients</Text>
          <View style={styles.macroRow}>
            <MacroProgress
              name="Protein"
              consumed={proteinConsumed}
              target={proteinTargetG}
              color="#3b82f6"
            />
            <MacroProgress
              name="Carbs"
              consumed={carbsConsumed}
              target={carbsTargetG}
              color="#10b981"
            />
            <MacroProgress
              name="Fat"
              consumed={fatConsumed}
              target={fatTargetG}
              color="#f59e0b"
            />
          </View>
        </View>

        {/* TDEE & Weight Snapshot Card */}
        <View style={styles.metricsRow}>
          <View style={[styles.card, { flex: 1, marginRight: 8 }]}>
            <Text style={styles.cardHeader}>Maintenance TDEE</Text>
            <Text style={styles.metricVal}>
              {summary?.tdee ? `${Math.round(summary.tdee)}` : '--'}
            </Text>
            <Text style={styles.metricSub}>kcal/day (burn rate)</Text>
          </View>

          <TouchableOpacity
            style={[styles.card, { flex: 1, marginLeft: 8 }]}
            onPress={() => setIsWeightModalVisible(true)}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.cardHeader}>Scale Weight</Text>
              <Ionicons name="add-circle" size={18} color="#2563eb" />
            </View>
            <Text style={styles.metricVal}>
              {summary?.raw_weight ? `${summary.raw_weight.toFixed(1)} kg` : 'Log +'}
            </Text>
            <Text style={styles.metricSub}>
              Trend: {summary?.trend_weight ? `${summary.trend_weight.toFixed(1)} kg` : '--'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Logged Meals Section */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={styles.cardHeader}>Meals ({meals.length})</Text>
            <TouchableOpacity onPress={onOpenQuickLog} style={styles.addMealBtn}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addMealBtnText}>Log Food</Text>
            </TouchableOpacity>
          </View>

          {meals.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name="fast-food-outline" size={40} color="#cbd5e1" />
              <Text style={styles.emptyText}>No food logged for this day yet.</Text>
            </View>
          ) : (
            meals.map((m) => (
              <View key={m.id} style={styles.mealItem}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.mealName}>{m.food_name}</Text>
                  <Text style={styles.mealDetails}>
                    {m.serving_size ? `${m.serving_size} • ` : ''}
                    P: {Math.round(m.protein)}g | C: {Math.round(m.carbs)}g | F: {Math.round(m.fat)}g
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', marginRight: 12 }}>
                  <Text style={styles.mealCalories}>{Math.round(m.calories)}</Text>
                  <Text style={styles.mealCalSub}>kcal</Text>
                </View>
                <TouchableOpacity onPress={() => m.id && handleDeleteMeal(m.id)}>
                  <Ionicons name="trash-outline" size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Weight Modal */}
      <Modal visible={isWeightModalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Log Weight for {currentDate}</Text>
            <TextInput
              style={styles.modalInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 84.5"
              value={weightInput}
              onChangeText={setWeightInput}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#e2e8f0' }]}
                onPress={() => setIsWeightModalVisible(false)}
              >
                <Text style={{ color: '#334155', fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#2563eb' }]}
                onPress={handleSaveWeight}
              >
                <Text style={{ color: '#fff', fontWeight: '600' }}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MacroProgress({
  name,
  consumed,
  target,
  color,
}: {
  name: string;
  consumed: number;
  target: number;
  color: string;
}) {
  const percent = target > 0 ? Math.min(100, Math.round((consumed / target) * 100)) : 0;
  return (
    <View style={styles.macroCol}>
      <Text style={styles.macroName}>{name}</Text>
      <View style={styles.macroTrack}>
        <View style={[styles.macroFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.macroNumbers}>
        {Math.round(consumed)} / {target}g
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  dateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  dateNavBtn: {
    padding: 6,
  },
  dateTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  calorieCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    elevation: 2,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  calorieRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  calorieLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  calorieValue: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  calorieUnit: {
    fontSize: 11,
    color: '#94a3b8',
  },
  remainingCircle: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 3,
    borderColor: '#3b82f6',
  },
  remainingVal: {
    fontSize: 28,
    fontWeight: '900',
    color: '#1d4ed8',
  },
  remainingLabel: {
    fontSize: 12,
    color: '#3b82f6',
    fontWeight: '600',
  },
  overTargetCircle: {
    backgroundColor: '#fff7ed',
    borderColor: '#f97316',
  },
  overTargetVal: {
    color: '#ea580c',
  },
  overTargetLabel: {
    color: '#ea580c',
  },
  targetBreakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  targetBreakdownItem: {
    flex: 1,
    alignItems: 'center',
  },
  targetBreakdownDivider: {
    width: 1,
    height: 26,
    backgroundColor: '#cbd5e1',
  },
  targetBreakdownLabel: {
    fontSize: 10,
    color: '#64748b',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  targetBreakdownVal: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0f172a',
  },
  safetyFloorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3c7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 14,
    alignSelf: 'center',
  },
  safetyFloorText: {
    fontSize: 12,
    color: '#92400e',
    fontWeight: '600',
    marginLeft: 6,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
    marginBottom: 10,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroCol: {
    flex: 1,
    marginHorizontal: 4,
  },
  macroName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
  },
  macroTrack: {
    height: 8,
    backgroundColor: '#f1f5f9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  macroFill: {
    height: '100%',
    borderRadius: 4,
  },
  macroNumbers: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 6,
    fontWeight: '500',
  },
  metricsRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  metricVal: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 4,
  },
  metricSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  addMealBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addMealBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  emptyText: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 8,
  },
  mealItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  mealName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  mealDetails: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  mealCalories: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  mealCalSub: {
    fontSize: 10,
    color: '#94a3b8',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
    textAlign: 'center',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    fontSize: 20,
    textAlign: 'center',
    fontWeight: '700',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
});
