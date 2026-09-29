import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  ActivityIndicator,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getDatabase } from './src/db/database';
import { recalculateUserTdee } from './src/services/tdee';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { WeightTrendsScreen } from './src/screens/WeightTrendsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { QuickLogModal } from './src/screens/QuickLogModal';

function MainApp() {
  const insets = useSafeAreaInsets();
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'trends' | 'settings'>('dashboard');
  const [isQuickLogVisible, setIsQuickLogVisible] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  return (
    <View style={[styles.mainContainer, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />

      {/* Screen Body */}
      <View style={styles.screenContainer}>
        {currentTab === 'dashboard' && (
          <DashboardScreen
            key={`dashboard-${refreshKey}`}
            refreshTrigger={refreshKey}
            onOpenQuickLog={() => setIsQuickLogVisible(true)}
          />
        )}
        {currentTab === 'trends' && (
          <WeightTrendsScreen key={`trends-${refreshKey}`} />
        )}
        {currentTab === 'settings' && (
          <SettingsScreen onDatabaseWiped={() => setRefreshKey((k) => k + 1)} />
        )}
      </View>

      {/* Bottom Navigation Bar with System Bar Insets */}
      <View
        style={[
          styles.bottomNav,
          {
            paddingBottom: insets.bottom > 0 ? insets.bottom : 8,
            height: 60 + (insets.bottom > 0 ? insets.bottom : 8),
          },
        ]}
      >
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentTab('dashboard')}
          activeOpacity={0.7}
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
          activeOpacity={0.85}
        >
          <Ionicons name="sparkles" size={24} color="#ffffff" />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setCurrentTab('trends')}
          activeOpacity={0.7}
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
          activeOpacity={0.7}
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
    </View>
  );
}

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);

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
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
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
    backgroundColor: '#f8fafc',
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
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
