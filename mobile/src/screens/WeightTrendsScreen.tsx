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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getUserProfile,
  getScaleWeights,
  getDailySummariesRange,
  logScaleWeight,
} from '../db/queries';
import { recalculateUserTdee, formatDate } from '../services/tdee';
import { UserProfile, ScaleWeight, DailySummary } from '../types';

export function WeightTrendsScreen() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [weights, setWeights] = useState<ScaleWeight[]>([]);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Modal
  const [modalVisible, setModalVisible] = useState(false);
  const [weightDate, setWeightDate] = useState(formatDate(new Date()));
  const [weightValue, setWeightValue] = useState('');

  const loadData = useCallback(async () => {
    try {
      const u = await getUserProfile('victor');
      setProfile(u);

      const w = await getScaleWeights('victor', 60);
      setWeights(w);

      const s = await getDailySummariesRange('victor', 60);
      setSummaries(s);
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

  // Compute projections
  const latestSummary = summaries[0];
  const trendW = latestSummary?.trend_weight ?? null;
  const targetW = profile?.target_weight_kg ?? 85.0;
  const targetRateMonthly = profile?.target_monthly_rate_kg ?? -2.0;

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
    if (summaries.length >= 30 && summaries[29]?.trend_weight) {
      const pastTrend = summaries[29].trend_weight!;
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

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* Header Summary Card */}
        <View style={styles.trendHeroCard}>
          <Text style={styles.heroSub}>Current Trend Weight</Text>
          <Text style={styles.heroWeight}>
            {trendW ? `${trendW.toFixed(1)} kg` : '--'}
          </Text>
          <Text style={styles.heroGoal}>
            Goal: {targetW} kg ({targetRateMonthly} kg/month)
          </Text>
        </View>

        {/* Projections Card */}
        <View style={styles.card}>
          <Text style={styles.cardHeader}>Goal Projections</Text>
          <View style={styles.projRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.projTitle}>At Target Rate ({targetRateMonthly} kg/mo)</Text>
              <Text style={styles.projDate}>{targetProjDateStr}</Text>
            </View>
            <Ionicons name="calendar-outline" size={24} color="#2563eb" />
          </View>
          <View style={[styles.projRow, { borderTopWidth: 1, borderTopColor: '#f1f5f9', marginTop: 12, paddingTop: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.projTitle}>At Actual 30-Day Rate</Text>
              <Text style={styles.projDate}>{actualProjDateStr}</Text>
            </View>
            <Ionicons name="speedometer-outline" size={24} color="#10b981" />
          </View>
        </View>

        {/* Weight History Table */}
        <View style={styles.card}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
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
            weights.map((w, idx) => (
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
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  heroSub: {
    fontSize: 14,
    color: '#94a3b8',
    fontWeight: '500',
  },
  heroWeight: {
    fontSize: 36,
    fontWeight: '900',
    color: '#ffffff',
    marginVertical: 6,
  },
  heroGoal: {
    fontSize: 14,
    color: '#38bdf8',
    fontWeight: '600',
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
    marginBottom: 12,
  },
  projRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projTitle: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  projDate: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    marginTop: 2,
  },
  logBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2563eb',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  logBtnText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13,
    marginLeft: 4,
  },
  emptyText: {
    textAlign: 'center',
    color: '#94a3b8',
    marginVertical: 16,
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
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
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
  modalInputDate: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 12,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 12,
    fontSize: 22,
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
