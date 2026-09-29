import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, {
  Path,
  Line,
  Circle,
  Rect,
  Text as SvgText,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import {
  getUserProfile,
  getScaleWeights,
  getDailySummariesRange,
  logScaleWeight,
} from '../db/queries';
import { recalculateUserTdee, formatDate } from '../services/tdee';
import { UserProfile, ScaleWeight, DailySummary } from '../types';

type TimeframeOption = '30D' | '90D' | '180D' | 'All';

function formatShortDate(dStr: string): string {
  try {
    const [, m, d] = dStr.split('-');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const mIdx = parseInt(m, 10) - 1;
    return `${months[mIdx] || m} ${parseInt(d, 10)}`;
  } catch {
    return dStr;
  }
}

// -------------------------------------------------------------
// 1. Weight Trend Chart Component (FitnessLog Style)
// -------------------------------------------------------------
interface WeightTrendChartProps {
  data: DailySummary[];
  targetWeight: number | null;
  width: number;
}

function WeightTrendChart({ data, targetWeight, width }: WeightTrendChartProps) {
  if (data.length === 0) {
    return (
      <View style={styles.chartEmptyContainer}>
        <Text style={styles.chartEmptyText}>No weight data in this timeframe.</Text>
      </View>
    );
  }

  const height = 210;
  const padTop = 15;
  const padBottom = 28;
  const padLeft = 40;
  const padRight = 16;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);

  // Find min and max weight
  let minVal = Infinity;
  let maxVal = -Infinity;
  data.forEach((d) => {
    if (d.raw_weight && d.raw_weight > 0) {
      minVal = Math.min(minVal, d.raw_weight);
      maxVal = Math.max(maxVal, d.raw_weight);
    }
    if (d.trend_weight && d.trend_weight > 0) {
      minVal = Math.min(minVal, d.trend_weight);
      maxVal = Math.max(maxVal, d.trend_weight);
    }
  });

  if (targetWeight && targetWeight > 0) {
    // If target weight is within reasonable distance, include it in axis
    if (Math.abs(targetWeight - (minVal + maxVal) / 2) < 20) {
      minVal = Math.min(minVal, targetWeight);
      maxVal = Math.max(maxVal, targetWeight);
    }
  }

  if (!isFinite(minVal) || !isFinite(maxVal)) {
    minVal = 75;
    maxVal = 85;
  }

  const yMin = Math.floor(minVal - 0.8);
  const yMax = Math.ceil(maxVal + 0.8);
  const yRange = Math.max(1, yMax - yMin);

  const getX = (i: number) => padLeft + (i / Math.max(1, data.length - 1)) * plotW;
  const getY = (val: number) => padTop + plotH - ((val - yMin) / yRange) * plotH;

  // Grid lines
  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, idx) => {
    const val = yMin + (yRange / gridSteps) * idx;
    const y = getY(val);
    return { val: Math.round(val * 10) / 10, y };
  });

  // Trend line points & SVG path
  const trendPoints: Array<{ x: number; y: number }> = [];
  data.forEach((d, i) => {
    if (d.trend_weight && d.trend_weight > 0) {
      trendPoints.push({ x: getX(i), y: getY(d.trend_weight) });
    }
  });

  const trendLinePath = trendPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // Gradient area path
  let areaPath = '';
  if (trendPoints.length > 1) {
    const first = trendPoints[0];
    const last = trendPoints[trendPoints.length - 1];
    const bottomY = padTop + plotH;
    areaPath = `${trendLinePath} L ${last.x.toFixed(1)} ${bottomY} L ${first.x.toFixed(1)} ${bottomY} Z`;
  }

  // Target Goal Line
  let targetY: number | null = null;
  if (targetWeight && targetWeight >= yMin && targetWeight <= yMax) {
    targetY = getY(targetWeight);
  }

  // Date labels
  const firstDate = formatShortDate(data[0].date);
  const midIdx = Math.floor(data.length / 2);
  const midDate = formatShortDate(data[midIdx].date);
  const lastDate = formatShortDate(data[data.length - 1].date);

  return (
    <View style={styles.chartWrapper}>
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id="weightTrendGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor="#0284c7" stopOpacity="0.25" />
            <Stop offset="100%" stopColor="#0284c7" stopOpacity="0.0" />
          </LinearGradient>
        </Defs>

        {/* Horizontal Grid Lines & Y-Labels */}
        {gridLines.map((gl, idx) => (
          <React.Fragment key={idx}>
            <Line
              x1={padLeft}
              y1={gl.y}
              x2={padLeft + plotW}
              y2={gl.y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <SvgText
              x={padLeft - 6}
              y={gl.y + 4}
              fontSize={10}
              fill="#94a3b8"
              textAnchor="end"
              fontWeight="500"
            >
              {gl.val}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Goal Weight Line (Dashed) */}
        {targetY !== null && (
          <>
            <Line
              x1={padLeft}
              y1={targetY}
              x2={padLeft + plotW}
              y2={targetY}
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
            <SvgText
              x={padLeft + plotW}
              y={targetY - 4}
              fontSize={9}
              fill="#d97706"
              textAnchor="end"
              fontWeight="700"
            >
              Goal: {targetWeight} kg
            </SvgText>
          </>
        )}

        {/* Area Gradient under Trend Line */}
        {areaPath ? <Path d={areaPath} fill="url(#weightTrendGrad)" /> : null}

        {/* Scale Weight Scatter Dots */}
        {data.map((d, i) => {
          if (!d.raw_weight || d.raw_weight <= 0) return null;
          return (
            <Circle
              key={`dot-${i}`}
              cx={getX(i)}
              cy={getY(d.raw_weight)}
              r={2.5}
              fill="#94a3b8"
              opacity={0.8}
            />
          );
        })}

        {/* Smoothed Trend Weight Line */}
        {trendLinePath ? (
          <Path
            d={trendLinePath}
            fill="none"
            stroke="#0284c7"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* Date Labels on X-Axis */}
        <SvgText
          x={padLeft}
          y={height - 8}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="start"
          fontWeight="500"
        >
          {firstDate}
        </SvgText>
        {data.length > 5 && (
          <SvgText
            x={padLeft + plotW / 2}
            y={height - 8}
            fontSize={10}
            fill="#94a3b8"
            textAnchor="middle"
            fontWeight="500"
          >
            {midDate}
          </SvgText>
        )}
        <SvgText
          x={padLeft + plotW}
          y={height - 8}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="end"
          fontWeight="500"
        >
          {lastDate}
        </SvgText>
      </Svg>
    </View>
  );
}

// -------------------------------------------------------------
// 2. Expenditure (TDEE) & Calorie Intake Chart (FitnessLog Style)
// -------------------------------------------------------------
interface ExpenditureCalorieChartProps {
  data: DailySummary[];
  width: number;
}

function ExpenditureCalorieChart({ data, width }: ExpenditureCalorieChartProps) {
  if (data.length === 0) {
    return (
      <View style={styles.chartEmptyContainer}>
        <Text style={styles.chartEmptyText}>No expenditure data in this timeframe.</Text>
      </View>
    );
  }

  const height = 210;
  const padTop = 15;
  const padBottom = 28;
  const padLeft = 44;
  const padRight = 16;
  const plotW = Math.max(10, width - padLeft - padRight);
  const plotH = Math.max(10, height - padTop - padBottom);

  // Find min and max calories / TDEE
  let minVal = Infinity;
  let maxVal = -Infinity;
  data.forEach((d) => {
    if (d.total_calories && d.total_calories > 0) {
      minVal = Math.min(minVal, d.total_calories);
      maxVal = Math.max(maxVal, d.total_calories);
    }
    if (d.tdee && d.tdee > 0) {
      minVal = Math.min(minVal, d.tdee);
      maxVal = Math.max(maxVal, d.tdee);
    }
  });

  if (!isFinite(minVal) || !isFinite(maxVal)) {
    minVal = 1500;
    maxVal = 2500;
  }

  // Round grid to multiples of 250 or 500
  const yMin = Math.max(0, Math.floor((minVal - 150) / 250) * 250);
  const yMax = Math.ceil((maxVal + 150) / 250) * 250;
  const yRange = Math.max(500, yMax - yMin);

  const getX = (i: number) => padLeft + (i / Math.max(1, data.length - 1)) * plotW;
  const getY = (val: number) => padTop + plotH - ((val - yMin) / yRange) * plotH;

  // Grid steps (4 lines)
  const gridSteps = 4;
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, idx) => {
    const val = yMin + (yRange / gridSteps) * idx;
    const y = getY(val);
    return { val: Math.round(val), y };
  });

  // TDEE line path
  const tdeePoints: Array<{ x: number; y: number }> = [];
  data.forEach((d, i) => {
    if (d.tdee && d.tdee > 0) {
      tdeePoints.push({ x: getX(i), y: getY(d.tdee) });
    }
  });

  const tdeeLinePath = tdeePoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(' ');

  // Bar width calculation
  const rawBarW = (plotW / Math.max(1, data.length)) * 0.75;
  const barW = Math.max(2, Math.min(8, rawBarW));

  // Date labels
  const firstDate = formatShortDate(data[0].date);
  const midIdx = Math.floor(data.length / 2);
  const midDate = formatShortDate(data[midIdx].date);
  const lastDate = formatShortDate(data[data.length - 1].date);

  return (
    <View style={styles.chartWrapper}>
      <Svg width={width} height={height}>
        {/* Horizontal Grid Lines & Y-Labels */}
        {gridLines.map((gl, idx) => (
          <React.Fragment key={idx}>
            <Line
              x1={padLeft}
              y1={gl.y}
              x2={padLeft + plotW}
              y2={gl.y}
              stroke="#f1f5f9"
              strokeWidth={1}
            />
            <SvgText
              x={padLeft - 6}
              y={gl.y + 4}
              fontSize={10}
              fill="#94a3b8"
              textAnchor="end"
              fontWeight="500"
            >
              {gl.val}
            </SvgText>
          </React.Fragment>
        ))}

        {/* Daily Consumed Calorie Bars */}
        {data.map((d, i) => {
          if (!d.total_calories || d.total_calories <= 0) return null;
          const barX = getX(i) - barW / 2;
          const barY = getY(d.total_calories);
          const barH = padTop + plotH - barY;
          return (
            <Rect
              key={`bar-${i}`}
              x={barX}
              y={barY}
              width={barW}
              height={Math.max(1, barH)}
              fill="#10b981"
              opacity={0.55}
              rx={1.5}
            />
          );
        })}

        {/* Continuous TDEE Expenditure Line */}
        {tdeeLinePath ? (
          <Path
            d={tdeeLinePath}
            fill="none"
            stroke="#8b5cf6"
            strokeWidth={2.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}

        {/* Date Labels on X-Axis */}
        <SvgText
          x={padLeft}
          y={height - 8}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="start"
          fontWeight="500"
        >
          {firstDate}
        </SvgText>
        {data.length > 5 && (
          <SvgText
            x={padLeft + plotW / 2}
            y={height - 8}
            fontSize={10}
            fill="#94a3b8"
            textAnchor="middle"
            fontWeight="500"
          >
            {midDate}
          </SvgText>
        )}
        <SvgText
          x={padLeft + plotW}
          y={height - 8}
          fontSize={10}
          fill="#94a3b8"
          textAnchor="end"
          fontWeight="500"
        >
          {lastDate}
        </SvgText>
      </Svg>
    </View>
  );
}

// -------------------------------------------------------------
// Main WeightTrendsScreen
// -------------------------------------------------------------
export function WeightTrendsScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weights, setWeights] = useState<ScaleWeight[]>([]);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeOption>('90D');
  const [refreshing, setRefreshing] = useState(false);
  const [cardWidth, setCardWidth] = useState(Dimensions.get('window').width - 32);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [weightDate, setWeightDate] = useState(formatDate(new Date()));
  const [weightValue, setWeightValue] = useState('');

  const loadData = useCallback(async () => {
    try {
      const u = await getUserProfile('victor');
      setProfile(u);

      const w = await getScaleWeights('victor', 60);
      setWeights(w);

      // Load up to 1000 days of history and reverse to chronological order (oldest to newest)
      const s = await getDailySummariesRange('victor', 1000);
      setSummaries(s.reverse());
    } catch (err) {
      console.error('Error loading weight trends:', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await recalculateUserTdee('victor');
    await loadData();
    setRefreshing(false);
  };

  const handleSaveWeight = async () => {
    const val = parseFloat(weightValue);
    if (isNaN(val) || val <= 30 || val >= 300) {
      Alert.alert('Invalid Weight', 'Please enter a valid weight in kg (e.g. 84.5)');
      return;
    }
    await logScaleWeight('victor', weightDate, val);
    setModalVisible(false);
    setWeightValue('');
    await recalculateUserTdee('victor');
    await loadData();
  };

  // Slice summaries based on selected timeframe
  const getFilteredData = (): DailySummary[] => {
    if (summaries.length === 0) return [];
    switch (timeframe) {
      case '30D':
        return summaries.slice(-30);
      case '90D':
        return summaries.slice(-90);
      case '180D':
        return summaries.slice(-180);
      case 'All':
      default:
        return summaries;
    }
  };

  const filteredData = getFilteredData();

  // Summary Metrics
  const latestSummary = summaries[summaries.length - 1];
  const trendW = latestSummary?.trend_weight ?? null;
  const currentTdee = latestSummary?.tdee ? Math.round(latestSummary.tdee) : null;
  const targetW = profile?.target_weight_kg ?? 85.0;
  const targetRateMonthly = profile?.target_monthly_rate_kg ?? -2.0;

  // Weight Delta in selected timeframe
  let periodWeightDelta: number | null = null;
  if (filteredData.length >= 2) {
    const firstValid = filteredData.find((d) => d.trend_weight && d.trend_weight > 0);
    const lastValid = [...filteredData].reverse().find((d) => d.trend_weight && d.trend_weight > 0);
    if (firstValid?.trend_weight && lastValid?.trend_weight) {
      periodWeightDelta = Math.round((lastValid.trend_weight - firstValid.trend_weight) * 10) / 10;
    }
  }

  // Avg Intake in selected timeframe
  let avgPeriodIntake: number | null = null;
  const validIntakeDays = filteredData.filter((d) => d.total_calories && d.total_calories > 0);
  if (validIntakeDays.length > 0) {
    const sum = validIntakeDays.reduce((acc, d) => acc + d.total_calories, 0);
    avgPeriodIntake = Math.round(sum / validIntakeDays.length);
  }

  // Projections
  let targetProjDateStr = 'Target Reached';
  let actualProjDateStr = 'Needs more data';

  if (trendW && targetW && trendW > targetW && targetRateMonthly < 0) {
    const remainingKg = trendW - targetW;
    const dailyTargetLoss = Math.abs(targetRateMonthly) / 30.4375;
    const daysNeeded = Math.round(remainingKg / dailyTargetLoss);
    const projDate = new Date();
    projDate.setDate(projDate.getDate() + daysNeeded);
    targetProjDateStr = formatDate(projDate);

    // Actual 30d trend rate
    if (summaries.length >= 30) {
      const pastTrend = summaries[summaries.length - 30]?.trend_weight;
      if (pastTrend) {
        const actualDelta30 = pastTrend - trendW;
        if (actualDelta30 > 0) {
          const actualDailyLoss = actualDelta30 / 30.0;
          const daysActual = Math.round(remainingKg / actualDailyLoss);
          const actualProjDate = new Date();
          actualProjDate.setDate(actualProjDate.getDate() + daysActual);
          actualProjDateStr = formatDate(actualProjDate);
        }
      }
    }
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header Hero Card */}
        <View style={styles.trendHeroCard}>
          <Text style={styles.heroSub}>Current Trend Weight</Text>
          <Text style={styles.heroWeight}>
            {trendW ? `${trendW.toFixed(1)} kg` : '--'}
          </Text>
          <Text style={styles.heroGoal}>
            Goal: {targetW} kg ({targetRateMonthly > 0 ? '+' : ''}{targetRateMonthly} kg/month)
          </Text>
        </View>

        {/* Timeframe Selector Segmented Buttons */}
        <View style={styles.timeframeContainer}>
          {(['30D', '90D', '180D', 'All'] as TimeframeOption[]).map((tf) => (
            <TouchableOpacity
              key={tf}
              style={[styles.timeframeBtn, timeframe === tf && styles.timeframeBtnActive]}
              onPress={() => setTimeframe(tf)}
            >
              <Text
                style={[
                  styles.timeframeBtnText,
                  timeframe === tf && styles.timeframeBtnTextActive,
                ]}
              >
                {tf}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 1. Weight Trend Graph Card */}
        <View
          style={styles.card}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width - 32;
            if (w > 100) setCardWidth(w);
          }}
        >
          <View style={styles.chartHeaderRow}>
            <View>
              <Text style={styles.cardHeader}>Weight Trend</Text>
              <Text style={styles.chartSubtitle}>
                {trendW ? `${trendW.toFixed(1)} kg current` : ''}
                {periodWeightDelta !== null && (
                  <Text style={{ color: periodWeightDelta <= 0 ? '#10b981' : '#ef4444' }}>
                    {' '}• {periodWeightDelta > 0 ? '+' : ''}{periodWeightDelta} kg in {timeframe}
                  </Text>
                )}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.quickLogBtn}
              onPress={() => {
                setWeightDate(formatDate(new Date()));
                setModalVisible(true);
              }}
            >
              <Ionicons name="add" size={16} color="#2563eb" />
              <Text style={styles.quickLogBtnText}>Log</Text>
            </TouchableOpacity>
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#94a3b8' }]} />
              <Text style={styles.legendText}>Scale</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: '#0284c7' }]} />
              <Text style={styles.legendText}>Trend</Text>
            </View>
            {targetW && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDashed, { borderColor: '#f59e0b' }]} />
                <Text style={styles.legendText}>Goal ({targetW}kg)</Text>
              </View>
            )}
          </View>

          <WeightTrendChart
            data={filteredData}
            targetWeight={targetW}
            width={cardWidth}
          />
        </View>

        {/* 2. Expenditure (TDEE) & Calorie Intake Graph Card */}
        <View style={styles.card}>
          <View style={styles.chartHeaderRow}>
            <View>
              <Text style={styles.cardHeader}>Expenditure & Intake</Text>
              <Text style={styles.chartSubtitle}>
                {currentTdee ? `${currentTdee} kcal/day expenditure` : ''}
                {avgPeriodIntake ? ` • ${avgPeriodIntake} kcal/day avg intake` : ''}
              </Text>
            </View>
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendBar, { backgroundColor: '#10b981' }]} />
              <Text style={styles.legendText}>Intake</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendLine, { backgroundColor: '#8b5cf6' }]} />
              <Text style={styles.legendText}>Expenditure (TDEE)</Text>
            </View>
          </View>

          <ExpenditureCalorieChart
            data={filteredData}
            width={cardWidth}
          />
        </View>

        {/* Goal Projections Card */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Goal Projections</Text>
          <View style={styles.projRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.projTitle}>At Target Rate ({targetRateMonthly} kg/mo)</Text>
              <Text style={styles.projDate}>{targetProjDateStr}</Text>
            </View>
            <Ionicons name="calendar-outline" size={24} color="#2563eb" />
          </View>
          <View
            style={[
              styles.projRow,
              { borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: 12, paddingTop: 12 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.projTitle}>At Actual 30-Day Rate</Text>
              <Text style={styles.projDate}>{actualProjDateStr}</Text>
            </View>
            <Ionicons name="speedometer-outline" size={24} color="#10b981" />
          </View>
        </View>

        {/* Weight History Table */}
        <View style={styles.card}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <Text style={styles.cardHeader}>Recent Weigh-Ins</Text>
            <TouchableOpacity
              style={styles.logBtn}
              onPress={() => {
                setWeightDate(formatDate(new Date()));
                setModalVisible(true);
              }}
            >
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.logBtnText}>Log Weight</Text>
            </TouchableOpacity>
          </View>

          {weights.length === 0 ? (
            <Text style={styles.emptyText}>No weigh-ins recorded yet.</Text>
          ) : (
            weights.slice(0, 15).map((w, idx) => (
              <View key={w.id || idx} style={styles.weightRow}>
                <Text style={styles.weightDate}>{w.date}</Text>
                <Text style={styles.weightVal}>{w.raw_weight.toFixed(1)} kg</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Weight Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Log Scale Weight</Text>
            <TextInput
              style={styles.modalInputDate}
              value={weightDate}
              onChangeText={setWeightDate}
              placeholder="YYYY-MM-DD"
            />
            <TextInput
              style={styles.modalInput}
              keyboardType="decimal-pad"
              placeholder="e.g. 84.5"
              value={weightValue}
              onChangeText={setWeightValue}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: '#e2e8f0' }]}
                onPress={() => setModalVisible(false)}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  trendHeroCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 22,
    alignItems: 'center',
    marginBottom: 14,
  },
  heroSub: {
    fontSize: 13,
    color: '#94a3b8',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  heroWeight: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
    marginVertical: 4,
  },
  heroGoal: {
    fontSize: 13,
    color: '#38bdf8',
    fontWeight: '600',
  },
  timeframeContainer: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 3,
    marginBottom: 14,
  },
  timeframeBtn: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    borderRadius: 8,
  },
  timeframeBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  timeframeBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
  },
  timeframeBtnTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  chartHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  cardHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1e293b',
  },
  chartSubtitle: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
    marginTop: 2,
  },
  quickLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  quickLogBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
    marginLeft: 2,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
    gap: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 5,
  },
  legendLine: {
    width: 14,
    height: 3,
    borderRadius: 1.5,
    marginRight: 5,
  },
  legendDashed: {
    width: 14,
    height: 0,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginRight: 5,
  },
  legendBar: {
    width: 8,
    height: 10,
    borderRadius: 2,
    marginRight: 5,
  },
  legendText: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
  },
  chartWrapper: {
    alignItems: 'center',
    marginTop: 4,
  },
  chartEmptyContainer: {
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chartEmptyText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  projRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  projTitle: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  projDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  emptyText: {
    color: '#94a3b8',
    fontStyle: 'italic',
    textAlign: 'center',
    marginVertical: 12,
  },
  weightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  weightDate: {
    fontSize: 14,
    color: '#475569',
  },
  weightVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '85%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 16,
  },
  modalInputDate: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#334155',
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    fontWeight: '600',
    color: '#0f172a',
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  modalBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
});
