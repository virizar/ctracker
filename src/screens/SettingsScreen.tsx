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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
} from '../services/keychain';
import { getUserProfile, updateUserProfile } from '../db/queries';
import { wipeAllUserData } from '../db/database';
import { recalculateUserTdee } from '../services/tdee';
import { pickAndInspectFile, ImportPreview } from '../services/importer';
import { UserProfile } from '../types';

interface SettingsScreenProps {
  onDatabaseWiped?: () => void;
  onGoBack?: () => void;
}

export function SettingsScreen({ onDatabaseWiped, onGoBack }: SettingsScreenProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Profile Form States
  const [targetWeight, setTargetWeight] = useState('85.0');
  const [targetRate, setTargetRate] = useState('-2.0');
  const [minCalories, setMinCalories] = useState('1500');

  // Import State
  const [isAnalyzingFile, setIsAnalyzingFile] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    const key = await getGeminiApiKey();
    if (key) setApiKey(key);

    const m = await getGeminiModel();
    if (m) setModel(m);

    const u = await getUserProfile('victor');
    if (u) {
      setProfile(u);
      setTargetWeight(u.target_weight_kg ? u.target_weight_kg.toString() : '85.0');
      setTargetRate(u.target_monthly_rate_kg ? u.target_monthly_rate_kg.toString() : '-2.0');
      setMinCalories(u.min_daily_calories ? u.min_daily_calories.toString() : '1500');
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

  const handleSaveProfile = async () => {
    const tw = parseFloat(targetWeight);
    const tr = parseFloat(targetRate);
    const mc = parseFloat(minCalories);

    if (isNaN(tw) || isNaN(tr) || isNaN(mc)) {
      Alert.alert('Invalid Input', 'Please enter valid numerical values.');
      return;
    }

    await updateUserProfile('victor', {
      target_weight_kg: tw,
      target_monthly_rate_kg: tr,
      min_daily_calories: mc,
    });

    await recalculateUserTdee('victor');
    Alert.alert('Profile Updated', 'Target weight and safety floor saved. TDEE targets recalculated.');
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
        `Imported ${result.mealsImported} new meals and ${result.weightsImported} weigh-ins. TDEE curves and historical trends have been updated.`
      );
    } catch (err: any) {
      Alert.alert('Import Failed', err?.message || 'An error occurred while saving the imported data.');
    } finally {
      setIsImporting(false);
    }
  };

  const handleRecalculateAll = async () => {
    await recalculateUserTdee('victor');
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

      {/* Goals & Targets Card */}
      <View style={styles.card}>
        <View style={styles.cardHeaderRow}>
          <Ionicons name="flag" size={20} color="#10b981" />
          <Text style={styles.cardTitle}>Weight Goals & Safety Floor</Text>
        </View>

        <Text style={styles.label}>Target Weight (kg)</Text>
        <TextInput
          style={styles.input}
          keyboardType="decimal-pad"
          value={targetWeight}
          onChangeText={setTargetWeight}
        />

        <Text style={styles.label}>Target Monthly Loss Rate (kg/month)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numbers-and-punctuation"
          placeholder="-2.0"
          value={targetRate}
          onChangeText={setTargetRate}
        />

        <Text style={styles.label}>Minimum Daily Calories (Safety Floor)</Text>
        <TextInput
          style={styles.input}
          keyboardType="numeric"
          placeholder="1500"
          value={minCalories}
          onChangeText={setMinCalories}
        />

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile}>
          <Text style={styles.saveBtnText}>Update Goals & Targets</Text>
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
});
