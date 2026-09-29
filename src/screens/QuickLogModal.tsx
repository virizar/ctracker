import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { parseFoodInput } from '../services/gemini';
import { logMeal, searchFoodCatalog } from '../db/queries';
import { recalculateUserTdee, formatDate } from '../services/tdee';
import { ParsedFoodItem, FoodCatalogItem } from '../types';

interface QuickLogModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  targetDate?: string;
}

export function QuickLogModal({
  visible,
  onClose,
  onSuccess,
  targetDate = formatDate(new Date()),
}: QuickLogModalProps) {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<'ai' | 'search'>('ai');

  // AI Tab State
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);

  // Search Tab State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodCatalogItem[]>([]);

  useEffect(() => {
    if (activeTab === 'search') {
      loadSearchResults(searchQuery);
    }
  }, [activeTab, searchQuery]);

  const loadSearchResults = async (q: string) => {
    try {
      const results = await searchFoodCatalog('victor', q);
      setSearchResults(results);
    } catch (err) {
      console.error('Error searching food catalog:', err);
    }
  };

  const handleParseWithGemini = async () => {
    if (!inputQuery.trim()) {
      Alert.alert('Empty Input', 'Please describe what you ate or drank.');
      return;
    }

    setLoading(true);
    try {
      const items = await parseFoodInput(inputQuery);
      if (items.length === 0) {
        Alert.alert('No Food Detected', 'Gemini could not identify any food items in your description.');
      } else {
        setParsedItems(items);
      }
    } catch (err: any) {
      Alert.alert('AI Error', err?.message || 'Failed to parse food with Gemini.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAiMeals = async () => {
    if (parsedItems.length === 0) return;

    for (const item of parsedItems) {
      await logMeal('victor', {
        date: targetDate,
        food_name: item.food_name,
        canonical_name: item.canonical_name,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      });
    }

    await recalculateUserTdee('victor');
    resetAndClose();
    onSuccess();
  };

  const handleQuickAddCatalogItem = async (item: FoodCatalogItem) => {
    await logMeal('victor', {
      date: targetDate,
      food_name: item.canonical_name,
      canonical_name: item.canonical_name,
      serving_size: item.default_serving || '1 serving',
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    });

    await recalculateUserTdee('victor');
    resetAndClose();
    onSuccess();
  };

  const resetAndClose = () => {
    setInputQuery('');
    setParsedItems([]);
    setSearchQuery('');
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top > 0 ? insets.top : 12,
            paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
          },
        ]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Log Food for {targetDate}</Text>
          <TouchableOpacity onPress={resetAndClose} style={styles.closeBtn}>
            <Ionicons name="close" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>

        {/* Tab Switcher */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'ai' && styles.tabBtnActive]}
            onPress={() => setActiveTab('ai')}
          >
            <Ionicons
              name="sparkles"
              size={18}
              color={activeTab === 'ai' ? '#2563eb' : '#64748b'}
            />
            <Text style={[styles.tabText, activeTab === 'ai' && styles.tabTextActive]}>
              Gemini AI
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'search' && styles.tabBtnActive]}
            onPress={() => setActiveTab('search')}
          >
            <Ionicons
              name="search"
              size={18}
              color={activeTab === 'search' ? '#2563eb' : '#64748b'}
            />
            <Text style={[styles.tabText, activeTab === 'search' && styles.tabTextActive]}>
              Food Catalog
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Content */}
        {activeTab === 'ai' ? (
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.instruction}>
              Describe your meal in plain English or use voice dictation. Gemini will calculate the macros automatically:
            </Text>

            <TextInput
              style={styles.textInput}
              multiline
              numberOfLines={4}
              placeholder="e.g. 3 scrambled eggs with 30g butter and a slice of toast"
              placeholderTextColor="#94a3b8"
              value={inputQuery}
              onChangeText={setInputQuery}
            />

            <TouchableOpacity
              style={[styles.parseBtn, loading && { opacity: 0.7 }]}
              onPress={handleParseWithGemini}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <>
                  <Ionicons name="sparkles" size={18} color="#fff" />
                  <Text style={styles.parseBtnText}>Calculate Nutrition</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Parsed Items Preview */}
            {parsedItems.length > 0 && (
              <View style={styles.previewContainer}>
                <Text style={styles.previewTitle}>Estimated Items ({parsedItems.length})</Text>

                {parsedItems.map((item, idx) => (
                  <View key={idx} style={styles.previewCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewFoodName}>{item.food_name}</Text>
                      <Text style={styles.previewDetails}>
                        {item.serving_size} • P: {item.protein}g | C: {item.carbs}g | F: {item.fat}g
                      </Text>
                    </View>
                    <Text style={styles.previewCalories}>{Math.round(item.calories)} kcal</Text>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={handleConfirmAiMeals}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.confirmBtnText}>Add All to Log</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={[styles.content, { flex: 1 }]}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={20} color="#94a3b8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search food catalog..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor="#94a3b8"
              />
            </View>

            <ScrollView style={{ flex: 1 }}>
              {searchResults.length === 0 ? (
                <Text style={styles.noResultsText}>No foods found in your catalog.</Text>
              ) : (
                searchResults.map((item) => (
                  <TouchableOpacity
                    key={item.id}
                    style={styles.searchItem}
                    onPress={() => handleQuickAddCatalogItem(item)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchItemTitle}>{item.canonical_name}</Text>
                      <Text style={styles.searchItemSub}>
                        {item.default_serving || '1 serving'} • P: {item.protein}g | C: {item.carbs}g | F: {item.fat}g
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={styles.searchItemCals}>{Math.round(item.calories)} kcal</Text>
                      <Text style={styles.searchItemUsage}>Logged {item.usage_count}x</Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 4,
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  tabBtnActive: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  tabText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: '#64748b',
  },
  tabTextActive: {
    color: '#2563eb',
  },
  content: {
    padding: 20,
  },
  instruction: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 12,
    lineHeight: 20,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#ffffff',
    textAlignVertical: 'top',
    minHeight: 100,
    marginBottom: 16,
  },
  parseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
  },
  parseBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  previewContainer: {
    marginTop: 24,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  previewTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 12,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  previewFoodName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  previewDetails: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  previewCalories: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2563eb',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 16,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    marginLeft: 8,
    color: '#0f172a',
  },
  noResultsText: {
    textAlign: 'center',
    color: '#94a3b8',
    marginTop: 20,
    fontSize: 14,
  },
  searchItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  searchItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1e293b',
  },
  searchItemSub: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  searchItemCals: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  searchItemUsage: {
    fontSize: 11,
    color: '#94a3b8',
  },
});
