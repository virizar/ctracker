import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel,
} from '../services/keychain';
import { getUserProfile, updateUserProfile } from '../db/queries';
import { recalculateUserTdee } from '../services/tdee';
import { UserProfile } from '../types';

export function SettingsScreen() {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Profile Form States
  const [targetWeight, setTargetWeight] = useState('85.0');
  const [targetRate, setTargetRate] = useState('-2.0');
  const [minCalories, setMinCalories] = useState('1500');

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

  const handleRecalculateAll = async () => {
    await recalculateUserTdee('victor');
    Alert.alert('Recalculated', 'Full TDEE and exponential weight trends updated.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
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
});
