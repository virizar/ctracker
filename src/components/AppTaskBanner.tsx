import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBackgroundTask } from '../context/BackgroundTaskContext';

interface AppTaskBannerProps {
  onPressBanner?: () => void;
}

export function AppTaskBanner({ onPressBanner }: AppTaskBannerProps) {
  const { activeTask, stopTask } = useBackgroundTask();

  if (!activeTask) return null;

  const { status, title, progress, message, canStop } = activeTask;
  const isRunning = status === 'running';
  const isDone = status === 'completed';
  const isStopped = status === 'stopped';
  const isError = status === 'error';

  const percent =
    progress && progress.total > 0
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  return (
    <View style={styles.bannerContainer}>
      <TouchableOpacity
        style={[
          styles.bannerCard,
          isRunning && styles.bannerRunning,
          isDone && styles.bannerDone,
          isStopped && styles.bannerStopped,
          isError && styles.bannerError,
        ]}
        activeOpacity={0.85}
        onPress={onPressBanner}
      >
        <View style={styles.leftContent}>
          {isRunning ? (
            <ActivityIndicator size="small" color="#047857" style={{ marginRight: 8 }} />
          ) : isDone ? (
            <Ionicons name="checkmark-circle" size={18} color="#059669" style={{ marginRight: 8 }} />
          ) : isStopped ? (
            <Ionicons name="pause-circle" size={18} color="#d97706" style={{ marginRight: 8 }} />
          ) : (
            <Ionicons name="alert-circle" size={18} color="#dc2626" style={{ marginRight: 8 }} />
          )}

          <View style={styles.textContainer}>
            <Text style={styles.titleText} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.subText} numberOfLines={1}>
              {isRunning && progress && progress.total > 0
                ? `${progress.current} / ${progress.total} items (${percent}%)`
                : message || (isRunning ? 'Processing...' : status)}
            </Text>
          </View>
        </View>

        {isRunning && canStop && (
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={stopTask}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="stop-circle" size={16} color="#ef4444" />
            <Text style={styles.stopBtnText}>Stop</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bannerContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 6,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 4,
  },
  bannerRunning: {
    backgroundColor: '#ecfdf5',
    borderColor: '#6ee7b7',
  },
  bannerDone: {
    backgroundColor: '#f0fdf4',
    borderColor: '#86efac',
  },
  bannerStopped: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  bannerError: {
    backgroundColor: '#fef2f2',
    borderColor: '#fca5a5',
  },
  leftContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
  },
  textContainer: {
    flex: 1,
  },
  titleText: {
    fontSize: 12.5,
    fontWeight: '700',
    color: '#0f172a',
  },
  subText: {
    fontSize: 11,
    color: '#475569',
    marginTop: 1,
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#fca5a5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
  },
  stopBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#ef4444',
  },
});
