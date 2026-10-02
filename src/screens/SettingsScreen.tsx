import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import appConfig from '../../app.json';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
} from '../services/keychain';
import { getUserProfile, updateUserProfile, getScaleWeights } from '../db/queries';
import { wipeAllUserData } from '../db/database';
import {
  recalculateUserTdee,
  mifflinStJeor,
  calculateAgeYears,
  formatDate,
} from '../services/tdee';
import { pickAndInspectFile, ImportPreview } from '../services/importer';
import { runFoodCatalogOptimization } from '../services/catalogOptimizer';
import { UserProfile } from '../types';

interface SettingsScreenProps {
  onDatabaseWiped?: () => void;
  onGoBack?: () => void;
}

export function SettingsScreen({ onDatabaseWiped, onGoBack }: SettingsScreenProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);

  // Physiology & Demographics Form States
  const [name, setName] = useState('Victor');
  const [dob, setDob] = useState('1987-12-07');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('185');
  const [activity, setActivity] = useState(1.2);

  // Goal & Strategy Form States
  const [targetWeight, setTargetWeight] = useState('85.0');
  const [targetRate, setTargetRate] = useState('2.0');
  const [minCalories, setMinCalories] = useState('1500');

  // Import State
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  // AI Catalog Optimizer State
  const [isOptimizingCatalog, setIsOptimizingCatalog] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState({ current: 0, total: 0 });
  const optimizerAbortRef = React.useRef<AbortController | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const key = await getGeminiApiKey();
    if (key) setApiKey(key);

    const m = await getGeminiModel();
    if (m) setModel(m);

    const u = await getUserProfile();
    if (u) {
      setProfile(u);
      setName(u.name || u.username || 'Victor');
      setDob(u.dob || '1987-12-07');
      setSex(u.sex || 'male');
      setHeight(u.height_cm ? u.height_cm.toString() : '185');
      setActivity(u.activity_multiplier || 1.2);
      setTargetWeight(u.target_weight_kg ? u.target_weight_kg.toString() : '85.0');
      setTargetRate(
        u.target_monthly_rate_kg ? Math.abs(u.target_monthly_rate_kg).toString() : '2.0'
      );
      setMinCalories(u.min_daily_calories ? u.min_daily_calories.toString() : '1500');

      const weights = await getScaleWeights(u.username || 'victor', 1);
      if (weights.length > 0) {
        setCurrentWeight(weights[0].raw_weight);
      }
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      Alert.alert('Empty Key', 'Please enter a valid Gemini API key.');
      return;
    }
    await setGeminiApiKey(apiKey.trim());
    await setGeminiModel(model.trim());
    Alert.alert('Success', 'Gemini API settings saved securely.');
  };

  // Live calculations for BMR, Age, and Baseline TDEE
  const ageYears =
    dob && dob.match(/^\d{4}-\d{2}-\d{2}$/)
      ? Math.round(calculateAgeYears(dob, formatDate(new Date())))
      : 38;
  const parsedHeight = parseFloat(height) || 180;
  const parsedWeight = currentWeight || parseFloat(targetWeight) || 80;
  const baselineBmr = Math.round(mifflinStJeor(parsedWeight, parsedHeight, ageYears, sex));
  const startingTdee = Math.round(baselineBmr * activity);

  // Smart Goal Inference
  const parsedTw = parseFloat(targetWeight);
  const parsedRate = Math.abs(parseFloat(targetRate) || 0);
  const referenceWeight = currentWeight ?? (profile?.target_weight_kg ?? 80);

  let goalMode: 'loss' | 'gain' | 'maintain' = 'maintain';
  let dailyDeltaCals = 0;
  let smartRateSigned = 0;

  if (!isNaN(parsedTw) && referenceWeight) {
    if (parsedTw < referenceWeight - 0.2) {
      goalMode = 'loss';
      smartRateSigned = -parsedRate;
      dailyDeltaCals = Math.round((parsedRate * 7700) / 30.4375);
    } else if (parsedTw > referenceWeight + 0.2) {
      goalMode = 'gain';
      smartRateSigned = parsedRate;
      dailyDeltaCals = Math.round((parsedRate * 7700) / 30.4375);
    } else {
      goalMode = 'maintain';
      smartRateSigned = 0;
      dailyDeltaCals = 0;
    }
  }

  const handleSaveProfile = async () => {
    const tw = parseFloat(targetWeight);
    const mc = parseFloat(minCalories);
    const h = parseFloat(height);

    if (isNaN(tw) || isNaN(mc) || isNaN(h)) {
      Alert.alert('Invalid Input', 'Please enter valid numbers for weight, height, and calories.');
      return;
    }

    if (!dob.match(/^\d{4}-\d{2}-\d{2}$/)) {
      Alert.alert(
        'Invalid Date of Birth',
        'Please enter your date of birth in YYYY-MM-DD format (e.g. 1987-12-07).'
      );
      return;
    }

    const effectiveUsername = profile?.username || 'victor';

    await updateUserProfile(effectiveUsername, {
      name: name.trim() || effectiveUsername,
      dob: dob.trim(),
      sex,
      height_cm: h,
      activity_multiplier: activity,
      target_weight_kg: tw,
      target_monthly_rate_kg: smartRateSigned,
      min_daily_calories: mc,
    });

    await recalculateUserTdee(effectiveUsername);
    await loadSettings();
    Alert.alert(
      'Profile Updated! 🎯',
      'Physiology, baseline TDEE, and adaptive goals have been recalculated successfully.'
    );
  };

  const handlePickFile = async () => {
    try {
      setIsAnalyzingFile(true);
      const preview = await pickAndInspectFile();
      if (preview) {
        setImportPreview(preview);
      }
    } catch (err: any) {
      Alert.alert('Import Analysis Failed', err?.message || 'Could not parse the selected file.');
    } finally {
      setIsAnalyzingFile(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!importPreview) return;
    try {
      setIsImporting(true);
      const result = await importPreview.executeImport();
      setImportPreview(null);
      Alert.alert(
        'Import Successful! 🎉',
        `Imported ${result.mealsImported} new meals and ${result.weightsImported} weigh-ins. TDEE curves and historical trends have been updated.\n\nWould you like AI to clean and standardize your food library now?`,
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Optimize Library (AI)',
            onPress: () => handleRunCatalogOptimization(),
          },
        ]
      );
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'An error occurred while saving the imported data.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRunCatalogOptimization = async () => {
    const uname = profile?.username || 'victor';
    const controller = new AbortController();
    optimizerAbortRef.current = controller;
    setIsOptimizingCatalog(true);
    setOptimizationProgress({ current: 0, total: 0 });

    try {
      const result = await runFoodCatalogOptimization(
        uname,
        (current, total) => {
          setOptimizationProgress({ current, total });
        },
        controller.signal
      );

      if (result.aborted) {
        Alert.alert(
          'Optimization Stopped ⏸️',
          `Stopped as requested. Progress safely saved:\n\n• ${result.updatedCount} foods standardized\n• ${result.mergedCount} duplicates merged\n• ${result.migratedMealsCount} historical meal logs updated.`
        );
      } else if (result.totalProcessed === 0) {
        Alert.alert('Catalog Empty', 'There are no foods in your catalog to optimize yet.');
      } else {
        Alert.alert(
          'Optimization Complete! ✨',
          `Processed ${result.totalProcessed} food items:\n\n• ${result.updatedCount} foods standardized & normalized\n• ${result.mergedCount} duplicate items merged\n• ${result.migratedMealsCount} historical meal logs updated to clean names.\n\nAll historical daily calorie sums remain intact.`
        );
      }
    } catch (err: any) {
      Alert.alert('Optimization Error', err?.message || 'Failed to optimize food catalog.');
    } finally {
      setIsOptimizingCatalog(false);
      optimizerAbortRef.current = null;
    }
  };

  const handleStopCatalogOptimization = () => {
    if (optimizerAbortRef.current) {
      optimizerAbortRef.current.abort();
    }
  };

  const handleRecalculateAll = async () => {
    const uname = profile?.username || 'victor';
    await recalculateUserTdee(uname);
    Alert.alert('Recalculated', 'Full TDEE and exponential weight trends updated.');
  };

  const handleWipeDatabase = () => {
    Alert.alert(
      'Wipe All Data?',
      'Are you sure you want to permanently erase all meals, scale weights, daily summaries, and food catalog items? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Yes, Wipe Everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await wipeAllUserData();
              await loadSettings();
              onDatabaseWiped?.();
              Alert.alert('Database Wiped', 'All meals, weigh-ins, and trends have been reset to clean defaults.');
            } catch (err: any) {
              Alert.alert('Wipe Failed', err?.message || 'Could not reset database.');
            }
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <View style={styles.header}>
        {onGoBack ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={onGoBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color="#0f172a" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      {/* Smart Import Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="cloud-upload" size={20} color="#7c3aed" />
          <Text style={styles.cardTitle}>Smart Data Import</Text>
        </View>
        <Text style={styles.infoText}>
          Import historical data from multi-sheet spreadsheets (.xlsx), MyFitnessPal, Cronometer (.csv), or JSON. If the format is unknown, Gemini AI will automatically detect the columns and units.
        </Text>

        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: '#7c3aed' }, isAnalyzingFile && { opacity: 0.7 }]}
          onPress={handlePickFile}
          disabled={isAnalyzingFile}
        >
          {isAnalyzingFile ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="document-text-outline" size={18} color="#fff" />
              <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>Select File to Import</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* AI Food Library Optimizer Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="sparkles" size={20} color="#059669" />
          <Text style={styles.cardTitle}>AI Food Library Optimizer</Text>
        </View>
        <Text style={styles.infoText}>
          Standardize messy or verbose food names into clean generic titles, calculate 1-unit baseline portions, and merge duplicate catalog entries. Historical daily calorie totals are never altered.
        </Text>

        {isOptimizingCatalog ? (
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
            <View
              style={[
                styles.saveBtn,
                { backgroundColor: '#059669', flex: 1, opacity: 0.9, marginTop: 0 },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#ffffff" style={{ marginRight: 8 }} size="small" />
                <Text style={styles.saveBtnText}>
                  {optimizationProgress.total > 0
                    ? `Optimizing (${optimizationProgress.current}/${optimizationProgress.total})...`
                    : 'Optimizing Library...'}
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[
                styles.saveBtn,
                { backgroundColor: '#ef4444', paddingHorizontal: 18, marginTop: 0 },
              ]}
              onPress={handleStopCatalogOptimization}
              activeOpacity={0.7}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="stop-circle-outline" size={18} color="#fff" />
                <Text style={[styles.saveBtnText, { marginLeft: 6 }]}>Stop</Text>
              </View>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: '#059669' }]}
            onPress={handleRunCatalogOptimization}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="sparkles-outline" size={18} color="#fff" />
              <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>Clean & Optimize Library</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Gemini AI Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="sparkles" size={20} color="#2563eb" />
          <Text style={styles.cardTitle}>Gemini AI Integration</Text>
        </View>

        <Text style={styles.label}>Google Gemini API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="AIzaSy..."
          secureTextEntry
          value={apiKey}
          onChangeText={setApiKey}
          placeholderTextColor="#94a3b8"
        />

        <Text style={styles.label}>Model Name</Text>
        <TextInput
          style={styles.input}
          placeholder="gemini-2.5-flash"
          value={model}
          onChangeText={setModel}
          placeholderTextColor="#94a3b8"
        />

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveApiKey}>
          <Text style={styles.saveBtnText}>Save AI Settings</Text>
        </TouchableOpacity>
      </View>

      {/* 1. Profile & Physiology Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="person" size={20} color="#2563eb" />
          <Text style={styles.cardTitle}>Profile & Physiology</Text>
        </View>

        <Text style={styles.label}>Display Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Victor"
          value={name}
          onChangeText={setName}
          placeholderTextColor="#94a3b8"
        />

        <View style={styles.twoColRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <View style={styles.labelWithBadgeRow}>
              <Text style={styles.label}>Date of Birth</Text>
              <Text style={styles.ageBadge}>{ageYears} yrs</Text>
            </View>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={dob}
              onChangeText={setDob}
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.label}>Biological Sex</Text>
            <View style={styles.segmentedRow}>
              <TouchableOpacity
                style={[styles.segmentBtn, sex === 'male' && styles.segmentBtnActive]}
                onPress={() => setSex('male')}
              >
                <Text style={[styles.segmentBtnText, sex === 'male' && styles.segmentBtnTextActive]}>
                  Male
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segmentBtn, sex === 'female' && styles.segmentBtnActive]}
                onPress={() => setSex('female')}
              >
                <Text style={[styles.segmentBtnText, sex === 'female' && styles.segmentBtnTextActive]}>
                  Female
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <Text style={styles.label}>Height (cm)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="185"
          value={height}
          onChangeText={setHeight}
        />

        <Text style={styles.label}>Daily Physical Activity Level</Text>
        <View style={styles.activityOptionsContainer}>
          {[
            { mult: 1.2, title: 'Sedentary (1.2)', desc: 'Desk job, little intentional exercise' },
            { mult: 1.375, title: 'Lightly Active (1.375)', desc: '1–3 workouts/wk or active job' },
            { mult: 1.55, title: 'Moderately Active (1.55)', desc: '3–5 moderate workouts/wk' },
            { mult: 1.725, title: 'Very Active (1.725)', desc: '6–7 intense workouts/wk' },
          ].map((act) => (
            <TouchableOpacity
              key={act.mult}
              style={[styles.activityCard, activity === act.mult && styles.activityCardActive]}
              onPress={() => setActivity(act.mult)}
            >
              <View style={styles.activityCardContent}>
                <Text
                  style={[
                    styles.activityCardTitle,
                    activity === act.mult && styles.activityCardTitleActive,
                  ]}
                >
                  {act.title}
                </Text>
                <Text style={styles.activityCardDesc}>{act.desc}</Text>
              </View>
              {activity === act.mult && (
                <Ionicons name="checkmark-circle" size={18} color="#2563eb" />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Live Baseline Preview Box */}
        <View style={styles.baselinePreviewBox}>
          <View style={styles.baselineHeaderRow}>
            <Ionicons name="flash" size={15} color="#d97706" />
            <Text style={styles.baselinePreviewTitle}>Baseline Estimation (Mifflin-St Jeor)</Text>
          </View>
          <View style={styles.baselineStatsRow}>
            <View style={styles.baselineStatItem}>
              <Text style={styles.baselineStatLabel}>Baseline BMR</Text>
              <Text style={styles.baselineStatVal}>{baselineBmr} kcal</Text>
            </View>
            <View style={styles.baselineStatDivider} />
            <View style={styles.baselineStatItem}>
              <Text style={styles.baselineStatLabel}>Starting TDEE</Text>
              <Text style={[styles.baselineStatVal, { color: '#2563eb' }]}>{startingTdee} kcal</Text>
            </View>
          </View>
          <Text style={styles.baselineNote}>
            Used as initial metabolic reference until your logged meals and weigh-ins establish your true expenditure.
          </Text>
        </View>
      </View>

      {/* 2. Goals & Strategy Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="flag" size={20} color="#10b981" />
          <Text style={styles.cardTitle}>Goals & Strategy</Text>
        </View>

        <View style={styles.twoColRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.label}>Target Weight (kg)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              value={targetWeight}
              onChangeText={setTargetWeight}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.label}>Desired Pace (kg/mo)</Text>
            <TextInput
              style={styles.input}
              keyboardType="decimal-pad"
              placeholder="1.5"
              value={targetRate}
              onChangeText={setTargetRate}
            />
          </View>
        </View>

        {/* Smart Inferred Goal Badge */}
        <View
          style={[
            styles.smartGoalBadge,
            goalMode === 'loss' && styles.smartGoalLoss,
            goalMode === 'gain' && styles.smartGoalGain,
            goalMode === 'maintain' && styles.smartGoalMaintain,
          ]}
        >
          <Ionicons
            name={
              goalMode === 'loss'
                ? 'trending-down'
                : goalMode === 'gain'
                ? 'trending-up'
                : 'reorder-two'
            }
            size={18}
            color={
              goalMode === 'loss'
                ? '#059669'
                : goalMode === 'gain'
                ? '#2563eb'
                : '#475569'
            }
          />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text
              style={[
                styles.smartGoalTitle,
                goalMode === 'loss' && { color: '#065f46' },
                goalMode === 'gain' && { color: '#1d4ed8' },
                goalMode === 'maintain' && { color: '#334155' },
              ]}
            >
              {goalMode === 'loss'
                ? `Weight Loss Target (-${parsedRate} kg/mo)`
                : goalMode === 'gain'
                ? `Weight Gain / Bulk Target (+${parsedRate} kg/mo)`
                : 'Weight Maintenance'}
            </Text>
            <Text style={styles.smartGoalSub}>
              {goalMode === 'loss'
                ? `~${dailyDeltaCals} kcal/day deficit below TDEE (${currentWeight ? currentWeight.toFixed(1) : '--'} → ${parsedTw.toFixed(1)} kg)`
                : goalMode === 'gain'
                ? `~${dailyDeltaCals} kcal/day surplus above TDEE (${currentWeight ? currentWeight.toFixed(1) : '--'} → ${parsedTw.toFixed(1)} kg)`
                : `Target matches current weight (${parsedTw.toFixed(1)} kg)`}
            </Text>
          </View>
        </View>

        <Text style={[styles.label, { marginTop: 14 }]}>Minimum Daily Calories (Safety Floor)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="1500"
          value={minCalories}
          onChangeText={setMinCalories}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
          <Text style={styles.saveBtnText}>Save Profile & Goals</Text>
        </TouchableOpacity>
      </View>

      {/* Recalculate / Sync */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="sync" size={20} color="#64748b" />
          <Text style={styles.cardTitle}>Maintenance & Recalculation</Text>
        </View>
        <Text style={styles.infoText}>
          Re-runs the exponential weight smoothing, 14-day rolling expenditure window, and safety floor calculations over all historical data.
        </Text>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: '#475569' }]}
          onPress={handleRecalculateAll}
        >
          <Text style={styles.saveBtnText}>Recalculate TDEE Engine</Text>
        </TouchableOpacity>
      </View>

      {/* Danger Zone: Wipe Database */}
      <View style={[styles.card, { borderColor: '#fecaca', backgroundColor: '#fff5f5' }]}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="trash-bin" size={20} color="#dc2626" />
          <Text style={[styles.cardTitle, { color: '#dc2626' }]}>Danger Zone</Text>
        </View>
        <Text style={[styles.infoText, { color: '#7f1d1d' }]}>
          Permanently delete all logged meals, scale weights, daily summaries, and food catalog. Use this if you want a clean slate or to re-import your data from scratch.
        </Text>
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: '#dc2626' }]}
          onPress={handleWipeDatabase}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="trash-outline" size={18} color="#fff" />
            <Text style={[styles.saveBtnText, { marginLeft: 8 }]}>Wipe Database & Reset All Data</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* About CTracker Section */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="information-circle-outline" size={20} color="#2563eb" />
          <Text style={styles.cardTitle}>About CTracker</Text>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>App Version</Text>
          <View style={styles.aboutBadge}>
            <Text style={styles.aboutBadgeText}>v{appConfig.expo.version}</Text>
          </View>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Build Profile</Text>
          <Text style={styles.aboutValue}>
            {__DEV__ ? 'Development (Debug)' : 'Standalone (Release)'}
          </Text>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Platform</Text>
          <Text style={styles.aboutValue}>
            {Platform.OS === 'web'
              ? 'Web (Browser)'
              : Platform.OS === 'android'
              ? 'Android (Native)'
              : 'iOS (Native)'}
          </Text>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Runtime Engine</Text>
          <Text style={styles.aboutValue}>
            {(global as any).HermesInternal ? 'Hermes Engine' : 'JavaScriptCore (JSC)'}
          </Text>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Package ID</Text>
          <Text style={styles.aboutValue}>{appConfig.expo.android?.package || 'com.victor.ctracker'}</Text>
        </View>

        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Active AI Model</Text>
          <Text style={styles.aboutValue}>{model || 'gemini-2.5-flash'}</Text>
        </View>

        <View style={[styles.aboutRow, { borderBottomWidth: 0 }]}>
          <Text style={styles.aboutLabel}>Database</Text>
          <Text style={styles.aboutValue}>Embedded SQLite (Local-First)</Text>
        </View>

        <View style={styles.aboutFooter}>
          <Text style={styles.aboutFooterText}>
            CTracker • 100% Private, Local-First Health & Nutrition
          </Text>
        </View>
      </View>

      {/* Import Preview Modal */}
      {importPreview && (
        <Modal visible transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Import Preview</Text>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>File:</Text>
                <Text style={styles.previewValue}>{importPreview.fileName}</Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Detected Format:</Text>
                <Text style={[styles.previewValue, { color: '#7c3aed', fontWeight: '700' }]}>
                  {importPreview.sourceFormat}
                </Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Meals Found:</Text>
                <Text style={styles.previewValue}>{importPreview.mealsCount}</Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Weigh-Ins Found:</Text>
                <Text style={styles.previewValue}>{importPreview.weightsCount}</Text>
              </View>

              {importPreview.startDate && (
                <View style={styles.previewInfoRow}>
                  <Text style={styles.previewLabel}>Date Range:</Text>
                  <Text style={styles.previewValue}>
                    {importPreview.startDate} to {importPreview.endDate}
                  </Text>
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#e2e8f0' }]}
                  onPress={() => setImportPreview(null)}
                  disabled={isImporting}
                >
                  <Text style={{ color: '#334155', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#16a34a' }]}
                  onPress={handleExecuteImport}
                  disabled={isImporting}
                >
                  {isImporting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Confirm Import</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  headerSpacer: {
    width: 36,
    height: 36,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginLeft: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
  },
  infoText: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 12,
  },
  saveBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 16,
  },
  saveBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
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
    padding: 22,
    width: '100%',
    maxWidth: 340,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
    marginBottom: 16,
    textAlign: 'center',
  },
  previewInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  previewLabel: {
    fontSize: 13,
    color: '#64748b',
  },
  previewValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0f172a',
    maxWidth: 180,
    textAlign: 'right',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  aboutLabel: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  aboutValue: {
    fontSize: 13,
    color: '#0f172a',
    fontWeight: '600',
  },
  aboutBadge: {
    backgroundColor: '#eff6ff',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  aboutBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  aboutFooter: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    alignItems: 'center',
  },
  aboutFooterText: {
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    fontWeight: '500',
  },
  twoColRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  labelWithBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    marginTop: 8,
  },
  ageBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
    backgroundColor: '#eff6ff',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  segmentedRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    height: 42,
    alignItems: 'center',
  },
  segmentBtn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentBtnActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
  },
  segmentBtnTextActive: {
    color: '#0f172a',
    fontWeight: '700',
  },
  activityOptionsContainer: {
    marginTop: 4,
    gap: 8,
  },
  activityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
  },
  activityCardActive: {
    backgroundColor: '#eff6ff',
    borderColor: '#3b82f6',
  },
  activityCardContent: {
    flex: 1,
  },
  activityCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  activityCardTitleActive: {
    color: '#1d4ed8',
  },
  activityCardDesc: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 1,
  },
  baselinePreviewBox: {
    backgroundColor: '#fefce8',
    borderRadius: 12,
    padding: 12,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  baselineHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  baselinePreviewTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#854d0e',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  baselineStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: '#fef08a',
  },
  baselineStatItem: {
    alignItems: 'center',
    flex: 1,
  },
  baselineStatLabel: {
    fontSize: 10.5,
    fontWeight: '600',
    color: '#713f12',
    textTransform: 'uppercase',
  },
  baselineStatVal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0f172a',
    marginTop: 2,
  },
  baselineStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#fef08a',
  },
  baselineNote: {
    fontSize: 11,
    color: '#a16207',
    marginTop: 8,
    lineHeight: 15,
  },
  smartGoalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
  },
  smartGoalLoss: {
    backgroundColor: '#ecfdf5',
    borderColor: '#a7f3d0',
  },
  smartGoalGain: {
    backgroundColor: '#eff6ff',
    borderColor: '#bfdbfe',
  },
  smartGoalMaintain: {
    backgroundColor: '#f8fafc',
    borderColor: '#cbd5e1',
  },
  smartGoalTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  smartGoalSub: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 2,
  },
});
