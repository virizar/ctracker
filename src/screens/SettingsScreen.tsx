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
  Image,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import appConfig from '../../app.json';
import {
  getActiveAIProvider,
  setActiveAIProvider,
  getAIProviderApiKey,
  setAIProviderApiKey,
  getAIProviderModel,
  setAIProviderModel,
  getCustomAIBaseUrl,
  setCustomAIBaseUrl,
} from '../services/keychain';
import { AI_PROVIDERS, DEFAULT_AI_PROVIDER } from '../services/ai/constants';
import { AIProviderType, AIConnectionTestResult } from '../services/ai/types';
import { createAIClient } from '../services/ai/clientFactory';
import { getUserProfile, updateUserProfile, getScaleWeights } from '../db/queries';
import { wipeAllUserData } from '../db/database';
import {
  recalculateUserTdee,
  mifflinStJeor,
  calculateAgeYears,
  formatDate,
  calculatePhysiologicalDailyTarget,
} from '../services/tdee';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { pickAndInspectFile, ImportPreview } from '../services/importer';
import {
  exportBackupJson,
  saveBackupToDevice,
  exportCsvSpreadsheets,
  saveCsvToDevice,
  validateBackupPayload,
  restoreBackup,
  createAutoSafetySnapshot,
  getLatestAutoSafetySnapshot,
  restoreAutoSafetySnapshot,
  BackupValidationResult,
} from '../services/backupService';
import { runFoodCatalogOptimization } from '../services/catalogOptimizer';
import { useBackgroundTask } from '../context/BackgroundTaskContext';
import { UserProfile, DEFAULT_USERNAME } from '../types';

interface SettingsScreenProps {
  onDatabaseWiped?: () => void;
  onGoBack?: () => void;
}

export function SettingsScreen({ onDatabaseWiped, onGoBack }: SettingsScreenProps) {
  // AI Multi-Provider States
  const [activeProvider, setActiveProvider] = useState<AIProviderType>('gemini');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(AI_PROVIDERS.gemini.defaultModel);
  const [customBaseUrl, setCustomBaseUrl] = useState(AI_PROVIDERS.custom.defaultBaseUrl);
  const [showApiKey, setShowApiKey] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<AIConnectionTestResult | null>(null);
  const [showProviderDropdown, setShowProviderDropdown] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);

  // Physiology & Demographics Form States
  const [name, setName] = useState('User');
  const [dob, setDob] = useState('1987-12-07');
  const [sex, setSex] = useState<'male' | 'female'>('male');
  const [height, setHeight] = useState('185');
  const [activity, setActivity] = useState(1.2);

  // Goal & Strategy Form States
  const [targetWeight, setTargetWeight] = useState('85.0');
  const [lossPace, setLossPace] = useState<'gentle' | 'balanced' | 'ambitious'>('balanced');
  const [minCalories, setMinCalories] = useState('1500');

  // Import State
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  // Backup & Recovery State
  const [isExportingJson, setIsExportingJson] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<BackupValidationResult | null>(null);
  const [lastSnapshotInfo, setLastSnapshotInfo] = useState<{
    exists: boolean;
    date?: string;
    reason?: string;
    weightsCount?: number;
    mealsCount?: number;
  } | null>(null);

  // Global Background Task Hook
  const { activeTask, startTask, updateProgress, completeTask, failTask, stopTask, isTaskRunning } =
    useBackgroundTask();
  const isOptimizingCatalog = isTaskRunning('catalog_optimization');
  const optimizationProgress =
    activeTask?.id === 'catalog_optimization' && activeTask.progress
      ? activeTask.progress
      : { current: 0, total: 0 };

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const provider = await getActiveAIProvider();
    setActiveProvider(provider);

    const key = await getAIProviderApiKey(provider);
    if (key) setApiKey(key);

    const m = await getAIProviderModel(provider);
    if (m) setModel(m);

    const customUrl = await getCustomAIBaseUrl();
    if (customUrl) setCustomBaseUrl(customUrl);

    const u = await getUserProfile();
    if (u) {
      setProfile(u);
      setName(u.name || 'User');
      setDob(u.dob || '1987-12-07');
      setSex(u.sex || 'male');
      setHeight(u.height_cm ? u.height_cm.toString() : '185');
      setActivity(u.activity_multiplier || 1.2);
      setTargetWeight(u.target_weight_kg ? u.target_weight_kg.toString() : '85.0');
      setLossPace((u.loss_pace as any) || 'balanced');
      setMinCalories(u.min_daily_calories ? u.min_daily_calories.toString() : '1500');

      const weights = await getScaleWeights(u.username || DEFAULT_USERNAME, 1);
      if (weights.length > 0) {
        setCurrentWeight(weights[0].raw_weight);
      }
    }

    const snapshot = await getLatestAutoSafetySnapshot();
    setLastSnapshotInfo(snapshot);
  };

  const handleSelectProvider = async (provider: AIProviderType) => {
    setActiveProvider(provider);
    setTestResult(null);
    const key = (await getAIProviderApiKey(provider)) || '';
    const m = (await getAIProviderModel(provider)) || AI_PROVIDERS[provider].defaultModel;
    setApiKey(key);
    setModel(m);
    if (provider === 'custom') {
      const url = await getCustomAIBaseUrl();
      setCustomBaseUrl(url || AI_PROVIDERS.custom.defaultBaseUrl);
    }
  };

  const handleTestConnection = async () => {
    const meta = AI_PROVIDERS[activeProvider];
    if (meta.requiresApiKey && !apiKey.trim()) {
      Alert.alert('Missing API Key', `Please enter your ${meta.name} API key before testing connection.`);
      return;
    }

    setTestingConnection(true);
    setTestResult(null);

    try {
      const client = createAIClient({
        provider: activeProvider,
        apiKey: apiKey.trim() || null,
        model: model.trim() || meta.defaultModel,
        customBaseUrl: activeProvider === 'custom' ? customBaseUrl.trim() : null,
      });

      const result = await client.testConnection();
      setTestResult(result);
    } catch (err: any) {
      setTestResult({
        success: false,
        error: err.message || 'Connection test failed',
      });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveAiSettings = async () => {
    const meta = AI_PROVIDERS[activeProvider];
    if (meta.requiresApiKey && !apiKey.trim()) {
      Alert.alert('Empty Key', `Please enter a valid ${meta.name} API key.`);
      return;
    }
    if (!model.trim()) {
      Alert.alert('Empty Model', 'Please specify a valid model name.');
      return;
    }

    await setActiveAIProvider(activeProvider);
    await setAIProviderApiKey(activeProvider, apiKey.trim());
    await setAIProviderModel(activeProvider, model.trim());
    if (activeProvider === 'custom') {
      await setCustomAIBaseUrl(customBaseUrl.trim());
    }

    Alert.alert('Success', `${meta.name} settings saved securely.`);
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

  // Context-Aware Physiological Target Inference
  const parsedTw = parseFloat(targetWeight);
  const targetResult = calculatePhysiologicalDailyTarget({
    tdee: startingTdee,
    currentWeightKg: parsedWeight,
    targetWeightKg: isNaN(parsedTw) ? parsedWeight : parsedTw,
    heightCm: parsedHeight,
    ageYears,
    sex,
    pace: lossPace,
    userMinCalories: parseFloat(minCalories) || null,
  });

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

    const effectiveUsername = profile?.username || DEFAULT_USERNAME;

    await updateUserProfile(effectiveUsername, {
      name: name.trim() || effectiveUsername,
      dob: dob.trim(),
      sex,
      height_cm: h,
      activity_multiplier: activity,
      target_weight_kg: tw,
      target_monthly_rate_kg:
        targetResult.mode === 'loss'
          ? -targetResult.weeklyRateKg * 4.345
          : targetResult.weeklyRateKg * 4.345,
      loss_pace: lossPace,
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
    startTask({
      id: 'data_import',
      title: 'Importing Health Data',
      canStop: false,
    });

    try {
      setIsImporting(true);
      const result = await importPreview.executeImport();
      completeTask(`Imported ${result.mealsImported} meals, ${result.weightsImported} weigh-ins`);
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
      failTask(err?.message);
      Alert.alert('Import Failed', err?.message || 'An error occurred while saving the imported data.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRunCatalogOptimization = async () => {
    const uname = profile?.username || DEFAULT_USERNAME;
    const controller = startTask({
      id: 'catalog_optimization',
      title: 'Optimizing Food Library',
      canStop: true,
      progress: { current: 0, total: 0 },
    });

    try {
      const result = await runFoodCatalogOptimization(
        uname,
        (current, total) => {
          updateProgress({ current, total });
        },
        controller.signal
      );

      if (result.aborted) {
        Alert.alert(
          'Optimization Stopped ⏸️',
          `Stopped as requested. Progress safely saved:\n\n• ${result.updatedCount} foods standardized\n• ${result.mergedCount} duplicates merged\n• ${result.migratedMealsCount} historical meal logs updated.`
        );
      } else if (result.totalProcessed === 0) {
        completeTask('Catalog already clean');
        Alert.alert('Catalog Empty', 'There are no foods in your catalog to optimize yet.');
      } else {
        completeTask(`${result.updatedCount} foods standardized`);
        Alert.alert(
          'Optimization Complete! ✨',
          `Processed ${result.totalProcessed} food items:\n\n• ${result.updatedCount} foods standardized & normalized\n• ${result.mergedCount} duplicate items merged\n• ${result.migratedMealsCount} historical meal logs updated to clean names.\n\nAll historical daily calorie sums remain intact.`
        );
      }
    } catch (err: any) {
      failTask(err?.message);
      Alert.alert('Optimization Error', err?.message || 'Failed to optimize food catalog.');
    }
  };

  const handleStopCatalogOptimization = () => {
    stopTask();
  };

  const handleRecalculateAll = async () => {
    const uname = profile?.username || DEFAULT_USERNAME;
    await recalculateUserTdee(uname);
    Alert.alert('Recalculated', 'Full TDEE and exponential weight trends updated.');
  };

  const handlePromptExportJson = () => {
    if (Platform.OS === 'web') {
      handleExportJsonDirect('web');
      return;
    }

    Alert.alert(
      'Export Complete Backup',
      'Where would you like to save your backup file?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save to Phone (Files/Downloads)',
          onPress: () => handleExportJsonDirect('device'),
        },
        {
          text: 'Share to Apps (WhatsApp, Drive...)',
          onPress: () => handleExportJsonDirect('share'),
        },
      ]
    );
  };

  const handleExportJsonDirect = async (destination: 'device' | 'share' | 'web') => {
    try {
      setIsExportingJson(true);
      const uname = profile?.username || DEFAULT_USERNAME;

      if (destination === 'device') {
        const res = await saveBackupToDevice(uname);
        if (res.success) {
          Alert.alert(
            'Saved to Phone! 📁',
            `Backup successfully created in your selected folder:\n\n${res.filename}`
          );
        }
      } else {
        const res = await exportBackupJson(uname);
        if (Platform.OS === 'web') {
          Alert.alert('Backup Downloaded', `Saved backup file: ${res.filename}`);
        }
      }
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Could not export backup JSON.');
    } finally {
      setIsExportingJson(false);
    }
  };

  const handlePromptCsvExport = () => {
    Alert.alert(
      'Export Spreadsheets (CSV)',
      'Which data tables would you like to export?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Weigh-Ins Only', onPress: () => handleChooseCsvDestination('weights') },
        { text: 'Meals Only', onPress: () => handleChooseCsvDestination('meals') },
        { text: 'Both (Weights & Meals)', onPress: () => handleChooseCsvDestination('both') },
      ]
    );
  };

  const handleChooseCsvDestination = (mode: 'weights' | 'meals' | 'both') => {
    if (Platform.OS === 'web') {
      handleExportCsvDirect(mode, 'web');
      return;
    }

    Alert.alert(
      'Export Destination',
      'Where would you like to save the spreadsheet files?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save to Phone (Files/Downloads)',
          onPress: () => handleExportCsvDirect(mode, 'device'),
        },
        {
          text: 'Share to Apps (WhatsApp, Drive...)',
          onPress: () => handleExportCsvDirect(mode, 'share'),
        },
      ]
    );
  };

  const handleExportCsvDirect = async (
    mode: 'weights' | 'meals' | 'both',
    destination: 'device' | 'share' | 'web'
  ) => {
    try {
      setIsExportingCsv(true);
      const uname = profile?.username || DEFAULT_USERNAME;

      if (destination === 'device') {
        const res = await saveCsvToDevice(uname, mode);
        if (res.success) {
          Alert.alert(
            'Saved to Phone! 📁',
            `Spreadsheets saved in your selected folder:\n\n${res.filenames.join('\n')}`
          );
        }
      } else {
        const res = await exportCsvSpreadsheets(uname, mode);
        if (Platform.OS === 'web') {
          Alert.alert('Spreadsheets Downloaded', `Saved files: ${res.filenames.join(', ')}`);
        }
      }
    } catch (err: any) {
      Alert.alert('Export Failed', err?.message || 'Could not export CSV spreadsheets.');
    } finally {
      setIsExportingCsv(false);
    }
  };

  const handlePickBackupFile = async () => {
    try {
      const pickerResult = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'text/*', '*/*'],
        copyToCacheDirectory: true,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const asset = pickerResult.assets[0];
      let jsonText = '';
      try {
        const res = await fetch(asset.uri);
        jsonText = await res.text();
      } catch {
        const file = new File(asset.uri);
        jsonText = await file.text();
      }

      if (jsonText.charCodeAt(0) === 0xFEFF) {
        jsonText = jsonText.slice(1);
      }

      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        Alert.alert('Invalid File', 'The selected file is not a valid JSON document.');
        return;
      }

      const validation = validateBackupPayload(parsed);
      if (!validation.valid) {
        Alert.alert(
          'Cannot Restore Backup',
          validation.error || 'The backup file is invalid or incompatible with this version.'
        );
        return;
      }

      setRestoreCandidate(validation);
    } catch (err: any) {
      Alert.alert('File Error', err?.message || 'Failed to read the selected backup file.');
    }
  };

  const handleExecuteRestore = async (mode: 'merge' | 'replace') => {
    if (!restoreCandidate?.payload) return;
    try {
      setIsRestoringBackup(true);
      const uname = profile?.username || DEFAULT_USERNAME;
      const result = await restoreBackup(restoreCandidate.payload, uname, mode);
      setRestoreCandidate(null);
      await loadSettings();
      onDatabaseWiped?.();

      Alert.alert(
        'Restore Complete! 🎉',
        `Restored ${result.mealsRestored} meals, ${result.weightsRestored} weigh-ins, and ${result.customFoodsRestored} custom foods (${mode === 'replace' ? 'Clean Replace' : 'Merged'}). TDEE and exponential trends have been recalculated.`
      );
    } catch (err: any) {
      Alert.alert('Restore Failed', err?.message || 'An error occurred while restoring data.');
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleRestoreSafetySnapshot = async () => {
    Alert.alert(
      'Restore Auto-Safety Snapshot?',
      'This will restore your data to the automatic snapshot saved locally before the last wipe or restore.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore Snapshot',
          onPress: async () => {
            try {
              setIsRestoringBackup(true);
              const uname = profile?.username || DEFAULT_USERNAME;
              const result = await restoreAutoSafetySnapshot(uname, 'replace');
              await loadSettings();
              onDatabaseWiped?.();
              Alert.alert(
                'Snapshot Restored! 🛡️',
                `Recovered ${result.mealsRestored} meals and ${result.weightsRestored} weigh-ins.`
              );
            } catch (err: any) {
              Alert.alert('Recovery Failed', err?.message || 'Could not restore snapshot.');
            } finally {
              setIsRestoringBackup(false);
            }
          },
        },
      ]
    );
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
              await createAutoSafetySnapshot(profile?.username || DEFAULT_USERNAME, 'pre-wipe');
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
      {/* App Branding Card */}
      <View style={styles.appBrandCard}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.appBrandIcon}
        />
        <View style={{ marginLeft: 14 }}>
          <Text style={styles.appBrandTitle}>ctracker</Text>
          <Text style={styles.appBrandVersion}>Version {appConfig.expo.version || '1.4.0'}</Text>
        </View>
      </View>

      {/* Smart Import Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="cloud-upload" size={20} color="#7c3aed" />
          <Text style={styles.cardTitle}>Smart Data Import</Text>
        </View>
        <Text style={styles.infoText}>
          Import historical data from multi-sheet spreadsheets (.xlsx), MyFitnessPal, Cronometer (.csv), or JSON. If the format is unknown, AI will automatically detect the columns and units.
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

      {/* Backup & Data Recovery Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="shield-checkmark" size={20} color="#2563eb" />
          <Text style={styles.cardTitle}>Backup & Data Recovery</Text>
        </View>
        <Text style={styles.infoText}>
          Create full disaster-recovery backups of your weigh-ins, meals, and food library, or export clean spreadsheets for Excel or Google Sheets.
        </Text>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: '#2563eb', flex: 1, marginTop: 0 }]}
            onPress={handlePromptExportJson}
            disabled={isExportingJson}
          >
            {isExportingJson ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="download-outline" size={17} color="#fff" />
                <Text style={[styles.saveBtnText, { marginLeft: 6 }]}>Export Backup</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: '#0284c7', flex: 1, marginTop: 0 }]}
            onPress={handlePromptCsvExport}
            disabled={isExportingCsv}
          >
            {isExportingCsv ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="grid-outline" size={17} color="#fff" />
                <Text style={[styles.saveBtnText, { marginLeft: 6 }]}>Export CSV</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[
            styles.saveBtn,
            { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#cbd5e1', marginTop: 10 },
          ]}
          onPress={handlePickBackupFile}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-undo-outline" size={17} color="#0f172a" />
            <Text style={[styles.saveBtnText, { color: '#0f172a', marginLeft: 6 }]}>
              Restore from Backup File (.json)
            </Text>
          </View>
        </TouchableOpacity>

        {lastSnapshotInfo?.exists && (
          <View
            style={{
              marginTop: 14,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: '#f1f5f9',
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#475569' }}>
                  🛡️ Local Safety Snapshot
                </Text>
                <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Saved: {lastSnapshotInfo.date ? new Date(lastSnapshotInfo.date).toLocaleDateString() : 'Recent'} ({lastSnapshotInfo.mealsCount} meals, {lastSnapshotInfo.weightsCount} weigh-ins)
                </Text>
              </View>
              <TouchableOpacity
                style={{
                  backgroundColor: '#f1f5f9',
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderRadius: 8,
                }}
                onPress={handleRestoreSafetySnapshot}
                disabled={isRestoringBackup}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#334155' }}>
                  Restore Snapshot
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
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
          <View style={{ marginTop: 16 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
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

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, gap: 5 }}>
              <Ionicons name="sunny-outline" size={13} color="#059669" />
              <Text style={{ fontSize: 11.5, color: '#059669', fontWeight: '600' }}>
                Screen stay-awake active • Keep app open
              </Text>
            </View>
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

      {/* AI Engine & Providers Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="sparkles" size={20} color="#2563eb" />
          <Text style={styles.cardTitle}>AI Engine & Model Provider</Text>
        </View>

        <Text style={styles.infoText}>
          CTracker supports multi-provider "Bring Your Own Key" architecture. Choose your preferred AI provider or connect a local offline model.
        </Text>

        {/* Provider Dropdown Selector */}
        <Text style={styles.label}>AI Provider</Text>
        <TouchableOpacity
          style={styles.dropdownSelector}
          onPress={() => setShowProviderDropdown(!showProviderDropdown)}
          activeOpacity={0.7}
        >
          <Text style={styles.dropdownSelectorText}>
            {AI_PROVIDERS[activeProvider].name}
          </Text>
          <Ionicons
            name={showProviderDropdown ? 'chevron-up' : 'chevron-down'}
            size={18}
            color="#64748b"
          />
        </TouchableOpacity>

        {showProviderDropdown && (
          <View style={styles.dropdownMenu}>
            {(Object.keys(AI_PROVIDERS) as AIProviderType[]).map((pKey) => {
              const isSelected = activeProvider === pKey;
              return (
                <TouchableOpacity
                  key={pKey}
                  style={[
                    styles.dropdownItem,
                    isSelected && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    handleSelectProvider(pKey);
                    setShowProviderDropdown(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dropdownItemText,
                      isSelected && styles.dropdownItemTextActive,
                    ]}
                  >
                    {AI_PROVIDERS[pKey].name}
                  </Text>
                  {isSelected && (
                    <Ionicons name="checkmark" size={18} color="#2563eb" />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Provider Description & Console Link */}
        <View style={styles.providerInfoRow}>
          <Text style={styles.providerInfoText}>
            {AI_PROVIDERS[activeProvider].description}
          </Text>
          {AI_PROVIDERS[activeProvider].consoleUrl && (
            <TouchableOpacity
              onPress={() => Linking.openURL(AI_PROVIDERS[activeProvider].consoleUrl)}
              activeOpacity={0.7}
            >
              <Text style={styles.providerLinkText}>
                {activeProvider === 'custom' ? 'Ollama setup ↗' : 'Get API key ↗'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Custom Server URL (only for custom provider) */}
        {activeProvider === 'custom' && (
          <View style={{ marginTop: 10 }}>
            <Text style={styles.label}>Server Base URL</Text>
            <TextInput
              style={styles.input}
              placeholder="http://192.168.1.100:11434/v1"
              value={customBaseUrl}
              onChangeText={setCustomBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#94a3b8"
            />
            <Text style={styles.fieldHint}>
              Connect to local Ollama, LM Studio, or LocalAI on your local Wi-Fi.
            </Text>
          </View>
        )}

        {/* API Key Input */}
        <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>
            {AI_PROVIDERS[activeProvider].requiresApiKey
              ? `${AI_PROVIDERS[activeProvider].name} API Key`
              : 'API Key (Optional)'}
          </Text>
          <View style={styles.passwordInputContainer}>
            <TextInput
              style={styles.passwordInput}
              placeholder={
                AI_PROVIDERS[activeProvider].requiresApiKey
                  ? 'Enter your API key'
                  : 'Leave blank if not required'
              }
              secureTextEntry={!showApiKey}
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor="#94a3b8"
            />
            <TouchableOpacity
              style={styles.passwordToggleBtn}
              onPress={() => setShowApiKey(!showApiKey)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showApiKey ? 'eye-off-outline' : 'eye-outline'}
                size={20}
                color="#64748b"
              />
            </TouchableOpacity>
          </View>
        </View>

        {/* Model Selection (String field only) */}
        <View style={{ marginTop: 10 }}>
          <View style={styles.modelHeaderRow}>
            <Text style={styles.label}>Model Name</Text>
            {model !== AI_PROVIDERS[activeProvider].defaultModel && (
              <TouchableOpacity
                onPress={() => setModel(AI_PROVIDERS[activeProvider].defaultModel)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={styles.resetModelLink}>Reset to default</Text>
              </TouchableOpacity>
            )}
          </View>
          <TextInput
            style={styles.input}
            placeholder={AI_PROVIDERS[activeProvider].defaultModel}
            value={model}
            onChangeText={setModel}
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor="#94a3b8"
          />
          <Text style={styles.fieldHint}>
            Default: {AI_PROVIDERS[activeProvider].defaultModel} • Enter any model name supported by your provider.
          </Text>
        </View>

        {/* Connection Test Result Feedback */}
        {testResult && (
          <View
            style={[
              styles.testResultBox,
              testResult.success ? styles.testResultSuccess : styles.testResultError,
            ]}
          >
            <Ionicons
              name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={testResult.success ? '#059669' : '#dc2626'}
            />
            <Text
              style={[
                styles.testResultText,
                testResult.success ? styles.testResultTextSuccess : styles.testResultTextError,
              ]}
              numberOfLines={3}
            >
              {testResult.success
                ? `Connection verified! Latency: ${testResult.latencyMs}ms`
                : `Connection failed: ${testResult.error}`}
            </Text>
          </View>
        )}

        {/* Action Buttons Row */}
        <View style={styles.aiActionRow}>
          <TouchableOpacity
            style={[styles.saveBtn, styles.testConnBtn]}
            onPress={handleTestConnection}
            disabled={testingConnection}
            activeOpacity={0.7}
          >
            {testingConnection ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="flash-outline" size={16} color="#2563eb" />
                <Text style={styles.testConnBtnText}>Test Ping</Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, styles.saveAiBtn]}
            onPress={handleSaveAiSettings}
            activeOpacity={0.7}
          >
            <Text style={styles.saveBtnText}>Save AI Settings</Text>
          </TouchableOpacity>
        </View>
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
          placeholder="Your Name"
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

        <Text style={styles.label}>Target Goal Weight (kg)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          placeholder="85.0"
          value={targetWeight}
          onChangeText={setTargetWeight}
        />

        <Text style={[styles.label, { marginTop: 12 }]}>Strategy Pace</Text>
        <View style={styles.paceSelectorRow}>
          {([
            { id: 'gentle', label: 'Gentle', sub: 'Easy & Steady' },
            { id: 'balanced', label: 'Balanced', sub: 'Optimal (Rec.)' },
            { id: 'ambitious', label: 'Ambitious', sub: 'Fast Progress' },
          ] as const).map((p) => {
            const isSelected = lossPace === p.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.paceCard, isSelected && styles.paceCardActive]}
                onPress={() => setLossPace(p.id)}
                activeOpacity={0.7}
              >
                <Text style={[styles.paceLabel, isSelected && styles.paceLabelActive]}>
                  {p.label}
                </Text>
                <Text style={[styles.paceSub, isSelected && styles.paceSubActive]}>
                  {p.sub}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Smart Inferred Goal Badge */}
        <View
          style={[
            styles.smartGoalBadge,
            targetResult.mode === 'loss' && styles.smartGoalLoss,
            targetResult.mode === 'gain' && styles.smartGoalGain,
            targetResult.mode === 'maintain' && styles.smartGoalMaintain,
          ]}
        >
          <Ionicons
            name={
              targetResult.mode === 'loss'
                ? 'trending-down'
                : targetResult.mode === 'gain'
                ? 'trending-up'
                : 'reorder-two'
            }
            size={20}
            color={
              targetResult.mode === 'loss'
                ? '#059669'
                : targetResult.mode === 'gain'
                ? '#2563eb'
                : '#475569'
            }
          />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <View style={styles.smartGoalHeaderRow}>
              <Text
                style={[
                  styles.smartGoalTitle,
                  targetResult.mode === 'loss' && { color: '#065f46' },
                  targetResult.mode === 'gain' && { color: '#1d4ed8' },
                  targetResult.mode === 'maintain' && { color: '#334155' },
                ]}
              >
                {targetResult.mode === 'loss'
                  ? 'Fat Loss Pace'
                  : targetResult.mode === 'gain'
                  ? 'Muscle Gain Pace'
                  : 'Weight Maintenance'}
              </Text>
              <View
                style={[
                  styles.smartGoalKcalPill,
                  targetResult.mode === 'loss' && styles.smartGoalKcalPillLoss,
                  targetResult.mode === 'gain' && styles.smartGoalKcalPillGain,
                  targetResult.mode === 'maintain' && styles.smartGoalKcalPillMaintain,
                ]}
              >
                <Text
                  style={[
                    styles.smartGoalKcalText,
                    targetResult.mode === 'loss' && { color: '#065f46' },
                    targetResult.mode === 'gain' && { color: '#1d4ed8' },
                    targetResult.mode === 'maintain' && { color: '#334155' },
                  ]}
                >
                  {targetResult.targetCalories} kcal
                </Text>
              </View>
            </View>

            {targetResult.mode !== 'maintain' && (
              <Text
                style={[
                  styles.smartGoalRateText,
                  targetResult.mode === 'loss' && { color: '#047857' },
                  targetResult.mode === 'gain' && { color: '#1d4ed8' },
                ]}
              >
                ~{targetResult.weeklyRateKg.toFixed(2)} kg/wk • {targetResult.weeklyRatePercent.toFixed(2)}% BW
              </Text>
            )}

            <Text style={styles.smartGoalSub}>
              {targetResult.mode === 'loss'
                ? `Daily deficit of ~${targetResult.dailyDeficit} kcal from ${startingTdee} kcal TDEE (BMI ${targetResult.bmi.toFixed(1)}).`
                : targetResult.mode === 'gain'
                ? `Daily controlled surplus of ~${-targetResult.dailyDeficit} kcal above ${startingTdee} kcal TDEE.`
                : `Target within 0.35 kg of current weight (${parsedWeight} kg). Calories match full TDEE.`}
            </Text>

            {targetResult.isCapped && (
              <View style={styles.cappedWarningRow}>
                <Ionicons name="information-circle" size={14} color="#d97706" />
                <Text style={styles.cappedWarningText}>
                  Target protected by metabolic safety floor ({targetResult.minFloor} kcal/day).
                </Text>
              </View>
            )}
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
          <Text style={styles.aboutLabel}>Active AI Engine</Text>
          <Text style={styles.aboutValue}>
            {`${AI_PROVIDERS[activeProvider]?.name || 'AI'} (${model || 'default'})`}
          </Text>
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

      {/* Restore Backup Preview Modal */}
      {restoreCandidate && (
        <Modal visible transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Restore Backup</Text>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Backup Date:</Text>
                <Text style={styles.previewValue}>
                  {restoreCandidate.summary?.exportedAt
                    ? new Date(restoreCandidate.summary.exportedAt).toLocaleDateString()
                    : 'Unknown'}
                </Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>App Version:</Text>
                <Text style={[styles.previewValue, { color: '#2563eb', fontWeight: '700' }]}>
                  v{restoreCandidate.summary?.appVersion} (format v{restoreCandidate.summary?.formatVersion})
                </Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Meals Found:</Text>
                <Text style={styles.previewValue}>{restoreCandidate.summary?.mealsCount}</Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Weigh-Ins Found:</Text>
                <Text style={styles.previewValue}>{restoreCandidate.summary?.weightsCount}</Text>
              </View>

              <View style={styles.previewInfoRow}>
                <Text style={styles.previewLabel}>Custom Foods:</Text>
                <Text style={styles.previewValue}>{restoreCandidate.summary?.customFoodsCount}</Text>
              </View>

              <Text style={[styles.infoText, { marginTop: 14, marginBottom: 8 }]}>
                Choose restore method:
              </Text>

              <View style={{ gap: 8 }}>
                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: '#2563eb', marginTop: 0 }]}
                  onPress={() => handleExecuteRestore('merge')}
                  disabled={isRestoringBackup}
                >
                  {isRestoringBackup ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Text style={styles.saveBtnText}>Merge with Existing Data</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.saveBtn, { backgroundColor: '#dc2626', marginTop: 0 }]}
                  onPress={() => {
                    Alert.alert(
                      'Clean Replace?',
                      'This will replace your current meals and weigh-ins with the contents of this backup. (An auto safety snapshot will be preserved).',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Clean Replace',
                          style: 'destructive',
                          onPress: () => handleExecuteRestore('replace'),
                        },
                      ]
                    );
                  }}
                  disabled={isRestoringBackup}
                >
                  <Text style={styles.saveBtnText}>Clean Replace (Overwrite)</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: '#e2e8f0', width: '100%', marginTop: 2 }]}
                  onPress={() => setRestoreCandidate(null)}
                  disabled={isRestoringBackup}
                >
                  <Text style={{ color: '#334155', fontWeight: '600' }}>Cancel</Text>
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
  paceSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
    marginBottom: 4,
  },
  paceCard: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paceCardActive: {
    borderColor: '#10b981',
    backgroundColor: '#ecfdf5',
  },
  paceLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#475569',
  },
  paceLabelActive: {
    color: '#065f46',
  },
  paceSub: {
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'center',
  },
  paceSubActive: {
    color: '#047857',
    fontWeight: '600',
  },
  smartGoalBadge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  smartGoalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  smartGoalTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  smartGoalKcalPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  smartGoalKcalPillLoss: {
    backgroundColor: '#d1fae5',
  },
  smartGoalKcalPillGain: {
    backgroundColor: '#dbeafe',
  },
  smartGoalKcalPillMaintain: {
    backgroundColor: '#e2e8f0',
  },
  smartGoalKcalText: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  smartGoalRateText: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
  smartGoalSub: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 3,
  },
  cappedWarningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 4,
  },
  cappedWarningText: {
    fontSize: 11,
    color: '#b45309',
    fontWeight: '600',
  },
  appBrandCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  appBrandIcon: {
    width: 52,
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  appBrandTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  appBrandVersion: {
    fontSize: 12.5,
    fontWeight: '500',
    color: '#64748b',
    marginTop: 2,
  },
  dropdownSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdownSelectorText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  dropdownMenu: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#ffffff',
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  dropdownItemActive: {
    backgroundColor: '#eff6ff',
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#334155',
  },
  dropdownItemTextActive: {
    color: '#1d4ed8',
    fontWeight: '700',
  },
  providerInfoRow: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  providerInfoText: {
    fontSize: 12,
    color: '#64748b',
    flex: 1,
  },
  providerLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2563eb',
  },
  modelHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  resetModelLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
  },
  fieldHint: {
    fontSize: 11.5,
    color: '#64748b',
    marginTop: 4,
  },
  passwordInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    backgroundColor: '#ffffff',
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#0f172a',
  },
  passwordToggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  testResultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 8,
    marginTop: 12,
    gap: 8,
  },
  testResultSuccess: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
  },
  testResultError: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  testResultText: {
    fontSize: 12.5,
    flex: 1,
  },
  testResultTextSuccess: {
    color: '#065f46',
    fontWeight: '600',
  },
  testResultTextError: {
    color: '#991b1b',
    fontWeight: '600',
  },
  aiActionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  testConnBtn: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#2563eb',
    marginTop: 0,
  },
  testConnBtnText: {
    color: '#2563eb',
    fontWeight: '700',
    fontSize: 13.5,
    marginLeft: 4,
  },
  saveAiBtn: {
    flex: 1.3,
    marginTop: 0,
  },
});
