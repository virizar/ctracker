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
  getFoodCatalogItem,
  updateMealLog,
  upsertFoodCatalog,
} from '../db/queries';
import { recalculateUserTdee, formatDate, parseDate } from '../services/tdee';
import { UserProfile, DailySummary, MealLog, FoodCatalogItem } from '../types';
import { FoodServingModal } from '../components/FoodServingModal';
import { parseServingString } from '../services/serving';
import { DateCalendarModal } from '../components/DateCalendarModal';

interface DashboardScreenProps {
  onOpenQuickLog: () => void;
  onOpenSettings?: () => void;
  refreshTrigger?: number;
  currentDate?: string;
  onDateChange?: (date: string) => void;
}

export function DashboardScreen({
  onOpenQuickLog,
  onOpenSettings,
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

  // Calendar Date Navigation Modal State
  const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false);

  // Meal Editing Modal State
  const [editingMeal, setEditingMeal] = useState<MealLog | null>(null);
  const [editingCatalogItem, setEditingCatalogItem] = useState<FoodCatalogItem | null>(null);
  const [editingInitialServing, setEditingInitialServing] = useState<
    { quantity?: number; unit?: string } | undefined
  >(undefined);

  const loadData = useCallback(async () => {
    try {
      const user = await getUserProfile();
      setProfile(user);
      const uname = user?.username || 'victor';

      let daySummary = await getDailySummary(uname, currentDate);
      if (!daySummary) {
        daySummary = await getLatestDailySummary(uname, currentDate);
      }
      setSummary(daySummary);

      const dayMeals = await getMealsByDate(uname, currentDate);
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
    const uname = profile?.username || 'victor';
    await recalculateUserTdee(uname);
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
          const uname = profile?.username || 'victor';
          await deleteMeal(mealId);
          await recalculateUserTdee(uname);
          await loadData();
        },
      },
    ]);
  };

  const handleOpenEditMeal = async (m: MealLog) => {
    const uname = profile?.username || 'victor';
    const canonical = m.canonical_name || m.food_name;
    let catalogItem = await getFoodCatalogItem(uname, canonical);

    if (!catalogItem) {
      catalogItem = {
        username: uname,
        canonical_name: m.food_name,
        default_serving: m.serving_size || '1 serving',
        calories: m.calories,
        protein: m.protein,
        carbs: m.carbs,
        fat: m.fat,
        usage_count: 1,
      };
    }

    const parsed = parseServingString(m.serving_size);
    setEditingInitialServing({
      quantity: parsed.initialQty,
      unit: parsed.initialUnit,
    });
    setEditingMeal(m);
    setEditingCatalogItem(catalogItem);
  };

  const handleConfirmEditMeal = async (result: {
    foodName: string;
    originalCanonicalName: string;
    servingSizeStr: string;
    quantity: number;
    unit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }) => {
    if (!editingMeal?.id) return;
    const uname = profile?.username || 'victor';

    try {
      await updateMealLog(editingMeal.id, {
        food_name: result.foodName,
        canonical_name: result.foodName,
        serving_size: result.servingSizeStr,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
      });

      // Keep catalog synced with the food
      await upsertFoodCatalog({
        username: uname,
        canonical_name: result.foodName,
        default_serving: result.servingSizeStr,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        usage_count: 1,
        last_used_qty: result.quantity,
        last_used_unit: result.unit,
      });

      await recalculateUserTdee(uname);
      setEditingMeal(null);
      setEditingCatalogItem(null);
      await loadData();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to update meal.');
    }
  };

  const handleSaveWeight = async () => {
    const val = parseFloat(weightInput);
    if (isNaN(val) || val <= 30 || val >= 300) {
      Alert.alert('Invalid Weight', 'Please enter a valid weight in kg (e.g. 84.5)');
      return;
    }
    const uname = profile?.username || 'victor';
    await logScaleWeight(uname, currentDate, val);
    setIsWeightModalVisible(false);
    setWeightInput('');
    await recalculateUserTdee(uname);
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

  // Identify trajectory
  const isWeightLossJourney =
    (profile?.target_monthly_rate_kg ?? 0) < 0 ||
    (maintenanceTdee !== null && targetCals < maintenanceTdee);

  const isWeightGainJourney =
    (profile?.target_monthly_rate_kg ?? 0) > 0 ||
    (maintenanceTdee !== null && targetCals > maintenanceTdee);

  // Status Calculation
  let statusTier:
    | 'target_pace'
    | 'deficit_buffer'
    | 'surplus'
    | 'gain_under_burn'
    | 'gain_steady_surplus'
    | 'gain_target_reached'
    | 'over_target' = 'target_pace';
  let circleValue = Math.abs(remainingCals);
  let circleLabel = remainingCals >= 0 ? 'Remaining' : 'Over Target';

  const deficitBelowTdee = maintenanceTdee !== null ? Math.round(maintenanceTdee - consumedCals) : null;
  const surplusOverTdee = maintenanceTdee !== null ? Math.round(consumedCals - maintenanceTdee) : null;

  if (isWeightLossJourney && maintenanceTdee !== null) {
    if (consumedCals <= targetCals) {
      statusTier = 'target_pace';
      circleValue = Math.max(0, remainingCals);
      circleLabel = 'Remaining';
    } else if (consumedCals <= maintenanceTdee) {
      statusTier = 'deficit_buffer';
      circleValue = Math.round(consumedCals - targetCals);
      circleLabel = 'Over Budget';
    } else {
      statusTier = 'surplus';
      circleValue = Math.round(consumedCals - maintenanceTdee);
      circleLabel = 'Surplus';
    }
  } else if (isWeightGainJourney && maintenanceTdee !== null) {
    if (consumedCals < maintenanceTdee) {
      statusTier = 'gain_under_burn';
      circleValue = Math.max(0, Math.round(targetCals - consumedCals));
      circleLabel = 'To Target';
    } else if (consumedCals <= targetCals) {
      statusTier = 'gain_steady_surplus';
      circleValue = Math.max(0, Math.round(targetCals - consumedCals));
      circleLabel = 'To Target';
    } else {
      statusTier = 'gain_target_reached';
      circleValue = Math.round(consumedCals - targetCals);
      circleLabel = 'Above Goal';
    }
  } else {
    if (consumedCals <= targetCals) {
      statusTier = 'target_pace';
      circleValue = Math.max(0, remainingCals);
      circleLabel = 'Remaining';
    } else {
      statusTier = 'over_target';
      circleValue = Math.round(consumedCals - targetCals);
      circleLabel = 'Over Target';
    }
  }

  // Energy Balance Gauge calculations
  const maxBenchmark = Math.max(
    targetCals,
    maintenanceTdee ?? targetCals,
    consumedCals,
    1500
  );
  const gaugeMax = Math.round(maxBenchmark * 1.15);
  const gaugeFillPct = Math.min(100, Math.max(0, (consumedCals / gaugeMax) * 100));
  const targetPct = Math.min(95, Math.max(5, (targetCals / gaugeMax) * 100));
  const tdeePct = maintenanceTdee
    ? Math.min(95, Math.max(5, (maintenanceTdee / gaugeMax) * 100))
    : null;

  let gaugeColor = '#3b82f6';
  if (statusTier === 'deficit_buffer' || statusTier === 'gain_steady_surplus') {
    gaugeColor = '#f59e0b';
  } else if (statusTier === 'surplus' || statusTier === 'over_target') {
    gaugeColor = '#ef4444';
  } else if (statusTier === 'gain_target_reached') {
    gaugeColor = '#10b981';
  }

  const proteinTargetG = profile ? Math.round((targetCals * profile.protein_ratio) / 4) : 150;
  const carbsTargetG = profile ? Math.round((targetCals * profile.carbs_ratio) / 4) : 200;
  const fatTargetG = profile ? Math.round((targetCals * profile.fat_ratio) / 9) : 65;

  const displayName = profile?.name || profile?.username || 'Victor';

  return (
    <View style={styles.container}>
      {/* Date Navigation Header */}
      <View style={styles.dateHeader}>
        {currentDate !== formatDate(new Date()) ? (
          <TouchableOpacity
            onPress={handleToday}
            style={styles.returnTodayChip}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-undo" size={13} color="#2563eb" />
            <Text style={styles.returnTodayText}>Today</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSideSpacer} />
        )}

        <View style={styles.dateNavContainer}>
          <TouchableOpacity onPress={handlePrevDay} style={styles.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-back" size={22} color="#0f172a" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setIsCalendarModalVisible(true)}
            style={styles.dateTitleBtn}
            activeOpacity={0.7}
          >
            <Text style={styles.dateTitle}>
              {currentDate === formatDate(new Date()) ? 'Today' : currentDate}
            </Text>
            <Ionicons name="calendar-outline" size={16} color="#2563eb" style={{ marginLeft: 5 }} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleNextDay} style={styles.dateNavBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="chevron-forward" size={22} color="#0f172a" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={onOpenSettings}
          style={styles.headerSideBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          activeOpacity={0.7}
        >
          <Ionicons name="settings-outline" size={22} color="#475569" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Personalized Greeting & Goal Mode */}
        <View style={styles.welcomeRow}>
          <Text style={styles.welcomeText}>
            Hello, <Text style={{ fontWeight: '800', color: '#0f172a' }}>{displayName}</Text>
          </Text>
          <View
            style={[
              styles.goalModeChip,
              isWeightLossJourney && styles.goalModeChipLoss,
              isWeightGainJourney && styles.goalModeChipGain,
            ]}
          >
            <Text
              style={[
                styles.goalModeChipText,
                isWeightLossJourney && { color: '#065f46' },
                isWeightGainJourney && { color: '#1d4ed8' },
              ]}
            >
              {isWeightLossJourney
                ? '📉 Loss Goal'
                : isWeightGainJourney
                ? '📈 Gain Goal'
                : '⚖️ Maintenance'}
            </Text>
          </View>
        </View>

        {/* Calorie Ring / Budget Card */}
        <View style={styles.calorieCard}>
          <View style={styles.calorieRow}>
            <View>
              <Text style={styles.calorieLabel}>Consumed</Text>
              <Text style={styles.calorieValue}>{Math.round(consumedCals)}</Text>
              <Text style={styles.calorieUnit}>kcal</Text>
            </View>
            <View
              style={[
                styles.remainingCircle,
                statusTier === 'deficit_buffer' && styles.amberCircle,
                statusTier === 'surplus' && styles.surplusCircle,
                statusTier === 'over_target' && styles.overTargetCircle,
              ]}
            >
              <Text
                style={[
                  styles.remainingVal,
                  statusTier === 'deficit_buffer' && styles.amberVal,
                  statusTier === 'surplus' && styles.surplusVal,
                  statusTier === 'over_target' && styles.overTargetVal,
                ]}
              >
                {circleValue}
              </Text>
              <Text
                style={[
                  styles.remainingLabel,
                  statusTier === 'deficit_buffer' && styles.amberLabel,
                  statusTier === 'surplus' && styles.surplusLabel,
                  statusTier === 'over_target' && styles.overTargetLabel,
                ]}
              >
                {circleLabel}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.calorieLabel}>Daily Target</Text>
              <Text style={styles.calorieValue}>{Math.round(targetCals)}</Text>
              <Text style={styles.calorieUnit}>kcal</Text>
            </View>
          </View>

          {/* Energy Balance Status Banner */}
          {statusTier === 'deficit_buffer' ? (
            <View style={styles.deficitBufferBanner}>
              <Ionicons name="trending-down" size={18} color="#d97706" style={{ marginTop: 1 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.deficitBufferTitle}>
                  Still in Deficit: -{deficitBelowTdee} kcal below TDEE
                </Text>
                <Text style={styles.deficitBufferSub}>
                  Over target budget by {Math.round(consumedCals - targetCals)} kcal, but still losing weight today!
                </Text>
              </View>
            </View>
          ) : statusTier === 'surplus' ? (
            <View style={styles.surplusBanner}>
              <Ionicons name="alert-circle" size={18} color="#dc2626" style={{ marginTop: 1 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.surplusTitle}>
                  Caloric Surplus: +{surplusOverTdee} kcal
                </Text>
                <Text style={styles.surplusSub}>
                  Exceeded maintenance burn ({maintenanceTdee} kcal) for today.
                </Text>
              </View>
            </View>
          ) : statusTier === 'gain_under_burn' && consumedCals > 0 ? (
            <View style={styles.deficitBufferBanner}>
              <Ionicons name="flame" size={18} color="#d97706" style={{ marginTop: 1 }} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.deficitBufferTitle}>
                  Below Maintenance: {Math.round(maintenanceTdee! - consumedCals)} kcal to burn line
                </Text>
                <Text style={styles.deficitBufferSub}>
                  Eat past your {maintenanceTdee} kcal burn line to achieve caloric surplus and fuel weight gain.
                </Text>
              </View>
            </View>
          ) : statusTier === 'gain_steady_surplus' ? (
            <View style={styles.targetPaceBanner}>
              <Ionicons name="trending-up" size={18} color="#059669" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.targetPaceText}>
                  In Surplus: +{Math.round(consumedCals - maintenanceTdee!)} kcal above TDEE (Gaining weight)
                </Text>
              </View>
            </View>
          ) : statusTier === 'gain_target_reached' ? (
            <View style={styles.targetPaceBanner}>
              <Ionicons name="checkmark-circle" size={18} color="#059669" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.targetPaceText}>
                  Bulk Target Achieved! (+{Math.round(consumedCals - maintenanceTdee!)} kcal surplus)
                </Text>
              </View>
            </View>
          ) : statusTier === 'target_pace' && consumedCals > 0 ? (
            <View style={styles.targetPaceBanner}>
              <Ionicons name="checkmark-circle" size={16} color="#059669" />
              <Text style={styles.targetPaceText}>
                On Track: {remainingCals} kcal remaining to hit your target deficit.
              </Text>
            </View>
          ) : null}

          {/* Energy Balance Visual Gauge (Option B) */}
          <View style={styles.gaugeContainer}>
            <View style={styles.gaugeHeader}>
              <Text style={styles.gaugeTitle}>Energy Balance</Text>
              <Text style={styles.gaugeSubtitle}>
                {maintenanceTdee
                  ? `${Math.round(consumedCals)} / ${maintenanceTdee} kcal burn`
                  : `${Math.round(consumedCals)} / ${Math.round(targetCals)} kcal target`}
              </Text>
            </View>
            <View style={styles.gaugeTrack}>
              <View
                style={[
                  styles.gaugeFill,
                  {
                    width: `${gaugeFillPct}%`,
                    backgroundColor: gaugeColor,
                  },
                ]}
              />
              {/* Target Milestone Marker */}
              <View
                style={[
                  styles.gaugeMilestone,
                  { left: `${targetPct}%` },
                ]}
              >
                <View style={styles.milestoneIndicator} />
              </View>
              {/* TDEE Milestone Marker */}
              {tdeePct !== null && (
                <View
                  style={[
                    styles.gaugeMilestone,
                    { left: `${tdeePct}%` },
                  ]}
                >
                  <View style={[styles.milestoneIndicator, { backgroundColor: '#475569' }]} />
                </View>
              )}
            </View>
            {/* Gauge Milestones Text Row */}
            <View style={styles.gaugeLabelsRow}>
              <Text style={styles.gaugeLabelText}>0</Text>
              <Text style={[styles.gaugeLabelText, { color: '#2563eb', fontWeight: '700' }]}>
                Target: {Math.round(targetCals)}
              </Text>
              {maintenanceTdee && (
                <Text style={[styles.gaugeLabelText, { color: '#475569', fontWeight: '700' }]}>
                  Burn: {maintenanceTdee}
                </Text>
              )}
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
              <Text style={styles.targetBreakdownLabel}>
                {deficitKcal < 0 ? 'Goal Deficit' : deficitKcal > 0 ? 'Goal Surplus' : 'Goal Delta'}
              </Text>
              <Text
                style={[
                  styles.targetBreakdownVal,
                  { color: deficitKcal < 0 ? '#10b981' : deficitKcal > 0 ? '#2563eb' : '#0f172a' },
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
                <TouchableOpacity
                  style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                  onPress={() => handleOpenEditMeal(m)}
                  activeOpacity={0.7}
                >
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
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => m.id && handleDeleteMeal(m.id)}
                  style={{ padding: 6 }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={20} color="#94a3b8" />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Edit Logged Meal Modal */}
      <FoodServingModal
        visible={editingMeal !== null && editingCatalogItem !== null}
        item={editingCatalogItem}
        initialServing={editingInitialServing}
        title="Edit Logged Meal"
        submitLabel="Update Meal"
        onClose={() => {
          setEditingMeal(null);
          setEditingCatalogItem(null);
        }}
        onConfirm={handleConfirmEditMeal}
      />

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

      {/* Date & Adherence Calendar Picker Modal */}
      <DateCalendarModal
        visible={isCalendarModalVisible}
        currentDate={currentDate}
        onSelectDate={updateDate}
        onClose={() => setIsCalendarModalVisible(false)}
      />
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
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  dateNavContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSideSpacer: {
    width: 36,
    height: 36,
  },
  headerSideBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  dateNavBtn: {
    padding: 6,
  },
  dateTitleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  dateTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
    marginRight: 2,
  },
  returnTodayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  returnTodayText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  welcomeText: {
    fontSize: 16,
    fontWeight: '500',
    color: '#64748b',
  },
  goalModeChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  goalModeChipLoss: {
    backgroundColor: '#ecfdf5',
  },
  goalModeChipGain: {
    backgroundColor: '#eff6ff',
  },
  goalModeChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
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
  amberCircle: {
    backgroundColor: '#fffbeb',
    borderColor: '#f59e0b',
  },
  amberVal: {
    color: '#d97706',
  },
  amberLabel: {
    color: '#d97706',
  },
  surplusCircle: {
    backgroundColor: '#fef2f2',
    borderColor: '#ef4444',
  },
  surplusVal: {
    color: '#dc2626',
  },
  surplusLabel: {
    color: '#dc2626',
  },
  deficitBufferBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  deficitBufferTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#92400e',
  },
  deficitBufferSub: {
    fontSize: 11.5,
    color: '#b45309',
    marginTop: 2,
    lineHeight: 16,
  },
  surplusBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#fef2f2',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  surplusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991b1b',
  },
  surplusSub: {
    fontSize: 11.5,
    color: '#b91c1c',
    marginTop: 2,
    lineHeight: 16,
  },
  targetPaceBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#a7f3d0',
    gap: 6,
  },
  targetPaceText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#065f46',
  },
  gaugeContainer: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  gaugeHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  gaugeTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  gaugeSubtitle: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '500',
  },
  gaugeTrack: {
    height: 10,
    backgroundColor: '#e2e8f0',
    borderRadius: 5,
    overflow: 'hidden',
    position: 'relative',
    marginVertical: 4,
  },
  gaugeFill: {
    height: '100%',
    borderRadius: 5,
  },
  gaugeMilestone: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
  milestoneIndicator: {
    width: 2,
    height: '100%',
    backgroundColor: '#1d4ed8',
  },
  gaugeLabelsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 3,
  },
  gaugeLabelText: {
    fontSize: 10.5,
    color: '#64748b',
    fontWeight: '500',
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
