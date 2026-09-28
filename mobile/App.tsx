import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase } from './src/db/database';
import { recalculateUserTdee } from './src/services/tdee';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { WeightTrendsScreen } from './src/screens/WeightTrendsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { QuickLogModal } from './src/screens/QuickLogModal';

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'trends' | 'settings'>('dashboard');
  const [isQuickLogVisible, setIsQuickLogVisible] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    async function setupApp() {
      try {
        await getDatabase();
        await recalculateUserTdee('victor');
      } catch (err) {
        console.error('Failed to initialize database:', err);
      } finally {
        setIsDbReady(true);
      }
    }
    setupApp();
  }, []);

  if (!isDbReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Initializing CTracker...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />

      {/* Screen Body */}
      <View style={styles.screenContainer} key={refreshKey}>
        {currentTab === 'dashboard' && (
          <DashboardScreen onOpenQuickLog={() => setIsQuickLogVisible(true)} />
        )}
        {currentTab === 'trends' && <WeightTrendsScreen />}
        {currentTab === 'settings' && <SettingsScreen />}
      </View>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentTab('dashboard')}
        >
          <Ionicons
            name={currentTab === 'dashboard' ? 'home' : 'home-outline'}
            size={22}
            color={currentTab === 'dashboard' ? '#2563eb' : '#64748b'}
          />
          <Text
            style={[
              styles.navLabel,
              currentTab === 'dashboard' && styles.navLabelActive,
            ]}
          >
            Today
          </Text>
        </TouchableOpacity>

        {/* Center Floating Plus Button */}
        <TouchableOpacity
          style={styles.floatingActionBtn}
          onPress={() => setIsQuickLogVisible(true)}
        >
          <Ionicons name="sparkles" size={24} color="#ffffff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentTab('trends')}
        >
          <Ionicons
            name={currentTab === 'trends' ? 'trending-up' : 'trending-up-outline'}
            size={22}
            color={currentTab === 'trends' ? '#2563eb' : '#64748b'}
          />
          <Text
            style={[
              styles.navLabel,
              currentTab === 'trends' && styles.navLabelActive,
            ]}
          >
            Trends
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentTab('settings')}
        >
          <Ionicons
            name={currentTab === 'settings' ? 'settings' : 'settings-outline'}
            size={22}
            color={currentTab === 'settings' ? '#2563eb' : '#64748b'}
          />
          <Text
            style={[
              styles.navLabel,
              currentTab === 'settings' && styles.navLabelActive,
            ]}
          >
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* Quick Log AI Modal */}
      <QuickLogModal
        visible={isQuickLogVisible}
        onClose={() => setIsQuickLogVisible(false)}
        onSuccess={() => {
          setRefreshKey((k) => k + 1);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: '#64748b',
    fontWeight: '500',
  },
  screenContainer: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 64,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingBottom: 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginTop: 2,
  },
  navLabelActive: {
    color: '#2563eb',
  },
  floatingActionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#2563eb',
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});
