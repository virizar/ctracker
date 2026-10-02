import React, { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getMonthLogStatus, DayLogStatus, getUserProfile } from '../db/queries';
import { formatDate, parseDate } from '../services/tdee';

interface DateCalendarModalProps {
  visible: boolean;
  currentDate: string;
  onSelectDate: (date: string) => void;
  onClose: () => void;
}

export function DateCalendarModal({
  visible,
  currentDate,
  onSelectDate,
  onClose,
}: DateCalendarModalProps) {
  const today = new Date();
  const todayStr = formatDate(today);

  // Initialize view year & month to the currently viewed date
  const parsedCurrent = parseDate(currentDate);
  const [viewYear, setViewYear] = useState(parsedCurrent.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsedCurrent.getMonth() + 1); // 1-12
  const [monthData, setMonthData] = useState<Record<string, DayLogStatus>>({});

  useEffect(() => {
    if (visible && currentDate) {
      const d = parseDate(currentDate);
      setViewYear(d.getFullYear());
      setViewMonth(d.getMonth() + 1);
    }
  }, [visible, currentDate]);

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const loadMonth = useCallback(async () => {
    try {
      const u = await getUserProfile();
      const uname = u?.username || 'victor';
      const data = await getMonthLogStatus(uname, viewYear, viewMonth);
      setMonthData(data);
    } catch (err) {
      console.error('Failed to load month calendar data:', err);
    }
  }, [viewYear, viewMonth]);

  useEffect(() => {
    if (visible) {
      loadMonth();
    }
  }, [visible, loadMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 1) {
      setViewMonth(12);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 12) {
      setViewMonth(1);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleJumpToToday = () => {
    onSelectDate(todayStr);
    onClose();
  };

  const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
  // Monday as index 0 (Sun = 0 -> 6, Mon = 1 -> 0, etc.)
  const startOffset = (firstDay + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

  let daysWithWeight = 0;
  let daysWithFood = 0;
  Object.values(monthData).forEach((d) => {
    if (d.hasWeight) daysWithWeight++;
    if (d.hasFood) daysWithFood++;
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalCard}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="calendar" size={20} color="#2563eb" />
              <Text style={styles.headerTitle}>Jump to Date</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          {/* Month Navigation */}
          <View style={styles.monthNavRow}>
            <TouchableOpacity
              onPress={handlePrevMonth}
              style={styles.monthNavBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-back" size={20} color="#0f172a" />
            </TouchableOpacity>

            <Text style={styles.monthTitleText}>
              {monthNames[viewMonth - 1]} {viewYear}
            </Text>

            <TouchableOpacity
              onPress={handleNextMonth}
              style={styles.monthNavBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="chevron-forward" size={20} color="#0f172a" />
            </TouchableOpacity>
          </View>

          {/* Weekday Labels (Mon - Sun) */}
          <View style={styles.weekdaysRow}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <Text key={day} style={styles.weekdayText}>
                {day}
              </Text>
            ))}
          </View>

          {/* Calendar Grid */}
          <View style={styles.daysGrid}>
            {Array.from({ length: totalCells }).map((_, idx) => {
              const dayNumber = idx - startOffset + 1;
              if (dayNumber < 1 || dayNumber > daysInMonth) {
                return <View key={`blank-${idx}`} style={styles.dayCell} />;
              }

              const dateStr = `${viewYear}-${String(viewMonth).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === currentDate;
              const status = monthData[dateStr];
              const hasWeight = status?.hasWeight ?? false;
              const hasFood = status?.hasFood ?? false;

              return (
                <TouchableOpacity
                  key={dateStr}
                  style={[
                    styles.dayCell,
                    isToday && styles.todayCell,
                    isSelected && styles.selectedCell,
                  ]}
                  onPress={() => {
                    onSelectDate(dateStr);
                    onClose();
                  }}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.dayNumber,
                      isToday && styles.todayNumber,
                      isSelected && styles.selectedNumber,
                    ]}
                  >
                    {dayNumber}
                  </Text>
                  <View style={styles.dotsRow}>
                    {hasWeight && <View style={[styles.dot, { backgroundColor: '#0284c7' }]} />}
                    {hasFood && <View style={[styles.dot, { backgroundColor: '#10b981' }]} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Adherence Summary & Legend */}
          <View style={styles.legendRow}>
            <View style={styles.legendBadge}>
              <View style={[styles.legendDot, { backgroundColor: '#0284c7' }]} />
              <Text style={styles.legendText}>
                Weight: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{daysWithWeight}</Text>/{daysInMonth}d
              </Text>
            </View>
            <View style={styles.legendBadge}>
              <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
              <Text style={styles.legendText}>
                Food: <Text style={{ fontWeight: '700', color: '#0f172a' }}>{daysWithFood}</Text>/{daysInMonth}d
              </Text>
            </View>
          </View>

          {/* Quick Return to Today Button */}
          <TouchableOpacity
            style={styles.jumpTodayBtn}
            onPress={handleJumpToToday}
            activeOpacity={0.8}
          >
            <Ionicons name="today-outline" size={18} color="#2563eb" />
            <Text style={styles.jumpTodayText}>Return to Today</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 4,
  },
  monthNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 14,
  },
  monthNavBtn: {
    padding: 4,
  },
  monthTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  weekdaysRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  weekdayText: {
    width: 38,
    textAlign: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: '#94a3b8',
    textTransform: 'uppercase',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    marginBottom: 14,
  },
  dayCell: {
    width: 38,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginVertical: 2,
  },
  todayCell: {
    borderWidth: 1.5,
    borderColor: '#3b82f6',
  },
  selectedCell: {
    backgroundColor: '#2563eb',
  },
  dayNumber: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1e293b',
  },
  todayNumber: {
    color: '#2563eb',
    fontWeight: '800',
  },
  selectedNumber: {
    color: '#ffffff',
    fontWeight: '800',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 2,
    height: 5,
    alignItems: 'center',
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    marginBottom: 14,
  },
  legendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendText: {
    fontSize: 12,
    color: '#64748b',
  },
  jumpTodayBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 11,
  },
  jumpTodayText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2563eb',
  },
});
