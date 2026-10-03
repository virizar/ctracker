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
import {
  logMeal,
  searchFoodCatalog,
  renameFoodCatalogItem,
  updateCatalogLastUsedMeasurement,
  upsertFoodCatalog,
  getFoodCatalogItem,
  getUserProfile,
} from '../db/queries';
import { recalculateUserTdee, formatDate } from '../services/tdee';
import { formatCatalogServing } from '../services/serving';
import { ParsedFoodItem, FoodCatalogItem } from '../types';
import { FoodServingModal } from '../components/FoodServingModal';

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
  const [profileUsername, setProfileUsername] = useState('victor');

  // AI Tab State
  const [inputQuery, setInputQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [parsedItems, setParsedItems] = useState<ParsedFoodItem[]>([]);

  // Computed AI Totals
  const totalAiCalories = Math.round(parsedItems.reduce((acc, it) => acc + (it.calories || 0), 0));
  const totalAiProtein = Math.round(parsedItems.reduce((acc, it) => acc + (it.protein || 0), 0) * 10) / 10;
  const totalAiCarbs = Math.round(parsedItems.reduce((acc, it) => acc + (it.carbs || 0), 0) * 10) / 10;
  const totalAiFat = Math.round(parsedItems.reduce((acc, it) => acc + (it.fat || 0), 0) * 10) / 10;

  // Search Tab State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodCatalogItem[]>([]);

  // Serving & Portion Modal State
  const [servingModalItem, setServingModalItem] = useState<FoodCatalogItem | null>(null);
  const [isCreatingCustomFood, setIsCreatingCustomFood] = useState(false);

  useEffect(() => {
    if (visible) {
      getUserProfile().then((u) => {
        const uname = u?.username || 'victor';
        setProfileUsername(uname);
        if (activeTab === 'search') {
          loadSearchResults(searchQuery, uname);
        }
      });
    }
  }, [visible]);

  useEffect(() => {
    if (visible && activeTab === 'search') {
      loadSearchResults(searchQuery);
    }
  }, [visible, activeTab, searchQuery, profileUsername]);

  const loadSearchResults = async (q: string, uname = profileUsername) => {
    try {
      const results = await searchFoodCatalog(uname, q);
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
      const items = await parseFoodInput(inputQuery, profileUsername);
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
      const cleanName = item.food_name.trim() || item.canonical_name.trim();

      // 1. Log the meal entry for today (logMeal automatically upserts into food_catalog)
      await logMeal(profileUsername, {
        date: targetDate,
        food_name: cleanName,
        canonical_name: cleanName,
        serving_size: item.serving_size,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
      });
    }

    await recalculateUserTdee(profileUsername);
    resetAndClose();
    onSuccess();
  };

  const handleClearAll = () => {
    setInputQuery('');
    setParsedItems([]);
  };

  const handleRemoveAiItem = (index: number) => {
    setParsedItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleOpenAiItemServing = async (aiItem: ParsedFoodItem, idx: number) => {
    const cleanName = aiItem.food_name.trim() || aiItem.canonical_name.trim();
    const existing = await getFoodCatalogItem(profileUsername, cleanName);

    if (existing) {
      setServingModalItem({
        ...existing,
        id: -1 * (idx + 1),
      });
    } else {
      setServingModalItem({
        id: -1 * (idx + 1),
        username: profileUsername,
        canonical_name: cleanName,
        default_serving: aiItem.serving_size,
        base_weight_g: aiItem.base_weight_g ?? null,
        calories: aiItem.calories,
        protein: aiItem.protein,
        carbs: aiItem.carbs,
        fat: aiItem.fat,
        usage_count: 1,
        last_used_qty: null,
        last_used_unit: null,
        last_used_at: undefined,
        created_at: '',
      });
    }
  };

  const handleConfirmServing = async (result: {
    foodName: string;
    originalCanonicalName: string;
    servingSizeStr: string;
    quantity: number;
    unit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }) => {
    try {
      const finalName = result.foodName.trim() || result.originalCanonicalName;

      // Case 1: Editing a temporary item from the AI preview list
      if (servingModalItem && servingModalItem.id !== undefined && servingModalItem.id < 0) {
        const itemIdx = Math.abs(servingModalItem.id) - 1;
        setParsedItems((prev) => {
          const updated = [...prev];
          updated[itemIdx] = {
            food_name: finalName,
            canonical_name: finalName,
            serving_size: result.servingSizeStr,
            calories: result.calories,
            protein: result.protein,
            carbs: result.carbs,
            fat: result.fat,
          };
          return updated;
        });
        setServingModalItem(null);
        return;
      }

      // Case 2: Logging an item from Food Catalog
      if (servingModalItem && servingModalItem.id !== undefined && servingModalItem.id > 0) {
        // If food was renamed, rename in SQLite catalog
        if (result.originalCanonicalName && finalName !== result.originalCanonicalName) {
          await renameFoodCatalogItem(profileUsername, result.originalCanonicalName, finalName);
        }

        // Remember last used quantity & unit
        await updateCatalogLastUsedMeasurement(
          profileUsername,
          finalName,
          result.quantity,
          result.unit
        );
      }

      await logMeal(profileUsername, {
        date: targetDate,
        food_name: finalName,
        canonical_name: finalName,
        serving_size: result.servingSizeStr,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
      });

      await recalculateUserTdee(profileUsername);
      setServingModalItem(null);
      resetAndClose();
      onSuccess();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log food serving.');
    }
  };

  const handleOpenCreateCustomFood = () => {
    const newItem: FoodCatalogItem = {
      username: profileUsername,
      canonical_name: searchQuery.trim() || 'Custom Food',
      default_serving: '1 serving',
      calories: 100,
      protein: 10,
      carbs: 10,
      fat: 2,
      usage_count: 1,
    };
    setIsCreatingCustomFood(true);
    setServingModalItem(newItem);
  };

  const resetAndClose = () => {
    setInputQuery('');
    setParsedItems([]);
    setSearchQuery('');
    setServingModalItem(null);
    setIsCreatingCustomFood(false);
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
          <View>
            <Text style={styles.title}>Log Food</Text>
            <View style={styles.dateSubRow}>
              <Ionicons name="calendar-outline" size={13} color="#2563eb" />
              <Text style={styles.dateSubText}>
                {targetDate === formatDate(new Date()) ? `Today (${targetDate})` : targetDate}
              </Text>
            </View>
          </View>
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

            <View style={styles.actionRow}>
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

              {(inputQuery.trim().length > 0 || parsedItems.length > 0) && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={handleClearAll}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={16} color="#64748b" />
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Parsed Items Preview */}
            {parsedItems.length > 0 && (
              <View style={styles.previewContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.previewTitle}>Estimated Items ({parsedItems.length})</Text>
                  <TouchableOpacity
                    onPress={handleClearAll}
                    style={styles.clearAllTextBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={13} color="#ef4444" />
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </TouchableOpacity>
                </View>

                {parsedItems.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.previewCard}
                    onPress={() => handleOpenAiItemServing(item, idx)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <Text style={styles.previewFoodName}>{item.food_name}</Text>
                      <Text style={styles.previewDetails}>
                        {item.serving_size} • P: {item.protein}g | C: {item.carbs}g | F: {item.fat}g
                      </Text>
                    </View>
                    <View style={{ alignItems: 'center', flexDirection: 'row', gap: 8 }}>
                      <Text style={styles.previewCalories}>{Math.round(item.calories)} kcal</Text>
                      <Ionicons name="create-outline" size={16} color="#94a3b8" />
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          handleRemoveAiItem(idx);
                        }}
                        style={styles.deleteCardBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        accessibilityLabel={`Remove ${item.food_name}`}
                      >
                        <Ionicons name="close-circle" size={18} color="#94a3b8" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}

                {/* Total Nutrition Summary Card */}
                <View style={styles.summaryTotalCard}>
                  <View style={styles.summaryTotalHeader}>
                    <Text style={styles.summaryTotalLabel}>Total Estimated Nutrition</Text>
                    <Text style={styles.summaryTotalCals}>{totalAiCalories} kcal</Text>
                  </View>
                  <View style={styles.summaryMacrosRow}>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Protein</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#2563eb' }]}>{totalAiProtein}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Carbs</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#10b981' }]}>{totalAiCarbs}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Fat</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#f59e0b' }]}>{totalAiFat}g</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={handleConfirmAiMeals}
                >
                  <Ionicons name="checkmark-circle" size={20} color="#fff" />
                  <Text style={styles.confirmBtnText}>Add All to Log ({totalAiCalories} kcal)</Text>
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

            <TouchableOpacity
              style={styles.createCustomFoodBtn}
              onPress={handleOpenCreateCustomFood}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle" size={18} color="#2563eb" />
              <Text style={styles.createCustomFoodBtnText}>
                {searchQuery.trim()
                  ? `+ Create "${searchQuery.trim()}" in Library`
                  : '+ Create Custom Food'}
              </Text>
            </TouchableOpacity>

            <ScrollView style={{ flex: 1 }}>
              {searchResults.length === 0 ? (
                <View style={{ alignItems: 'center', marginTop: 24 }}>
                  <Text style={styles.noResultsText}>No foods found in your catalog.</Text>
                  <Text style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
                    Tap the button above to add this food to your library.
                  </Text>
                </View>
              ) : (
                searchResults.map((item) => {
                  const hasLastUsed = Boolean(item.last_used_qty && item.last_used_unit);
                  const servingDisplay = formatCatalogServing(
                    item.last_used_qty,
                    item.last_used_unit,
                    item.default_serving
                  );

                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.searchItem}
                      onPress={() => setServingModalItem(item)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.searchItemTitle}>{item.canonical_name}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2, gap: 4 }}>
                          {hasLastUsed ? (
                            <Ionicons name="time-outline" size={12} color="#2563eb" />
                          ) : null}
                          <Text
                            style={[
                              styles.searchItemSub,
                              hasLastUsed ? { color: '#2563eb', fontWeight: '500' } : null,
                            ]}
                          >
                            {servingDisplay}
                          </Text>
                          <Text style={styles.searchItemSub}>
                            • P: {item.protein}g | C: {item.carbs}g | F: {item.fat}g
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={styles.searchItemCals}>{Math.round(item.calories)} kcal</Text>
                        <Text style={styles.searchItemUsage}>Logged {item.usage_count}x</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          </View>
        )}

        {/* Serving Size & Quantity Adjustment Modal */}
        <FoodServingModal
          visible={servingModalItem !== null}
          item={servingModalItem}
          initialManualMacros={isCreatingCustomFood}
          title={isCreatingCustomFood ? 'Create Custom Food' : 'Serving & Quantity'}
          submitLabel={isCreatingCustomFood ? 'Save & Log Food' : undefined}
          onClose={() => {
            setServingModalItem(null);
            setIsCreatingCustomFood(false);
          }}
          onConfirm={handleConfirmServing}
        />
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
  dateSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  dateSubText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
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
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  parseBtn: {
    flex: 1,
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
  clearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  clearBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#64748b',
  },
  clearAllTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    padding: 2,
  },
  clearAllText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
  deleteCardBtn: {
    padding: 2,
    marginLeft: 2,
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
  summaryTotalCard: {
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
  },
  summaryTotalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  summaryTotalLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1e3a8a',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summaryTotalCals: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1d4ed8',
  },
  summaryMacrosRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
  },
  summaryMacroBadge: {
    alignItems: 'center',
    flex: 1,
  },
  summaryMacroLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    marginBottom: 2,
  },
  summaryMacroVal: {
    fontSize: 14,
    fontWeight: '800',
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
  createCustomFoodBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    gap: 8,
  },
  createCustomFoodBtnText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '700',
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
