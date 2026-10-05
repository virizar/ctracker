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
  TouchableWithoutFeedback,
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
import { formatCatalogServing, isValidTag, cleanTag } from '../services/serving';
import { ParsedFoodItem, FoodCatalogItem, DEFAULT_USERNAME } from '../types';
import { FoodServingModal } from '../components/FoodServingModal';

export interface StagedFoodItem extends ParsedFoodItem {
  catalogItem?: FoodCatalogItem;
  quantity?: number;
  unit?: string;
}

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
  const [profileUsername, setProfileUsername] = useState(DEFAULT_USERNAME);

  // Global Staged Meal Basket (Shared across both AI and Search tabs)
  const [stagedItems, setStagedItems] = useState<StagedFoodItem[]>([]);
  const [editingStagedIndex, setEditingStagedIndex] = useState<number | null>(null);
  const [isBasketReviewVisible, setIsBasketReviewVisible] = useState(false);
  const [logging, setLogging] = useState(false);

  // AI Tab Draft State (Working area before staging)
  const [inputQuery, setInputQuery] = useState('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [aiDraftItems, setAiDraftItems] = useState<ParsedFoodItem[]>([]);
  const [editingAiDraftIndex, setEditingAiDraftIndex] = useState<number | null>(null);

  // Search Tab State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FoodCatalogItem[]>([]);

  // Serving & Portion Modal State
  const [servingModalItem, setServingModalItem] = useState<FoodCatalogItem | null>(null);
  const [isCreatingCustomFood, setIsCreatingCustomFood] = useState(false);

  // Computed Totals for Global Staged Meal Basket
  const totalBasketCalories = Math.round(stagedItems.reduce((acc, it) => acc + (it.calories || 0), 0));
  const totalBasketProtein = Math.round(stagedItems.reduce((acc, it) => acc + (it.protein || 0), 0) * 10) / 10;
  const totalBasketCarbs = Math.round(stagedItems.reduce((acc, it) => acc + (it.carbs || 0), 0) * 10) / 10;
  const totalBasketFat = Math.round(stagedItems.reduce((acc, it) => acc + (it.fat || 0), 0) * 10) / 10;

  // Computed Totals for AI Draft
  const totalAiDraftCalories = Math.round(aiDraftItems.reduce((acc, it) => acc + (it.calories || 0), 0));
  const totalAiDraftProtein = Math.round(aiDraftItems.reduce((acc, it) => acc + (it.protein || 0), 0) * 10) / 10;
  const totalAiDraftCarbs = Math.round(aiDraftItems.reduce((acc, it) => acc + (it.carbs || 0), 0) * 10) / 10;
  const totalAiDraftFat = Math.round(aiDraftItems.reduce((acc, it) => acc + (it.fat || 0), 0) * 10) / 10;

  useEffect(() => {
    if (visible) {
      getUserProfile().then((u) => {
        const uname = u?.username || DEFAULT_USERNAME;
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

  // --- AI Tab Handlers ---
  const handleParseWithGemini = async () => {
    if (!inputQuery.trim()) {
      Alert.alert('Empty Input', 'Please describe what you ate or drank.');
      return;
    }

    setLoadingAi(true);
    try {
      const items = await parseFoodInput(inputQuery, profileUsername);
      if (items.length === 0) {
        Alert.alert('No Food Detected', 'Gemini could not identify any food items in your description.');
      } else {
        setAiDraftItems(items);
      }
    } catch (err: any) {
      Alert.alert('AI Error', err?.message || 'Failed to parse food with Gemini.');
    } finally {
      setLoadingAi(false);
    }
  };

  const handleAddAiDraftToBasket = () => {
    if (aiDraftItems.length === 0) return;
    setStagedItems((prev) => [...prev, ...aiDraftItems]);
    setAiDraftItems([]);
    setInputQuery('');
  };

  const handleLogAiDraftImmediately = async () => {
    if (aiDraftItems.length === 0 || logging) return;

    setLogging(true);
    try {
      for (const item of aiDraftItems) {
        const cleanName = item.food_name.trim() || item.canonical_name.trim();
        await logMeal(profileUsername, {
          date: targetDate,
          food_name: cleanName,
          canonical_name: cleanName,
          brand: cleanTag(item.brand),
          variant: cleanTag(item.variant),
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
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log meals.');
    } finally {
      setLogging(false);
    }
  };

  const handleEditAiDraftItem = async (aiItem: ParsedFoodItem, idx: number) => {
    setEditingAiDraftIndex(idx);
    setEditingStagedIndex(null);
    const cleanName = aiItem.food_name.trim() || aiItem.canonical_name.trim();
    const existing = await getFoodCatalogItem(profileUsername, cleanName);

    if (existing) {
      setServingModalItem({
        ...existing,
        canonical_name: cleanName,
        brand: cleanTag(aiItem.brand ?? existing.brand),
        variant: cleanTag(aiItem.variant ?? existing.variant),
        calories: aiItem.calories,
        protein: aiItem.protein,
        carbs: aiItem.carbs,
        fat: aiItem.fat,
        default_serving: aiItem.serving_size,
      });
    } else {
      setServingModalItem({
        username: profileUsername,
        canonical_name: cleanName,
        brand: cleanTag(aiItem.brand),
        variant: cleanTag(aiItem.variant),
        default_serving: aiItem.serving_size,
        base_weight_g: aiItem.base_weight_g ?? null,
        calories: aiItem.calories,
        protein: aiItem.protein,
        carbs: aiItem.carbs,
        fat: aiItem.fat,
        usage_count: 1,
        last_used_qty: null,
        last_used_unit: null,
        created_at: '',
      });
    }
  };

  const handleRemoveAiDraftItem = (index: number) => {
    setAiDraftItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  // --- Staged Basket Handlers ---
  const handleCommitStagedMeals = async () => {
    if (stagedItems.length === 0 || logging) return;

    setLogging(true);
    try {
      for (const item of stagedItems) {
        const cleanName = item.food_name.trim() || item.canonical_name.trim();
        await logMeal(profileUsername, {
          date: targetDate,
          food_name: cleanName,
          canonical_name: cleanName,
          brand: cleanTag(item.brand),
          variant: cleanTag(item.variant),
          serving_size: item.serving_size,
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        });
      }

      await recalculateUserTdee(profileUsername);
      setIsBasketReviewVisible(false);
      resetAndClose();
      onSuccess();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to log meals.');
    } finally {
      setLogging(false);
    }
  };

  const handleClearAllStaged = () => {
    setStagedItems([]);
  };

  const handleRemoveStagedItem = (index: number) => {
    setStagedItems((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleEditStagedItem = async (item: StagedFoodItem, idx: number) => {
    setEditingStagedIndex(idx);
    setEditingAiDraftIndex(null);
    const cleanName = item.food_name.trim() || item.canonical_name.trim();
    const existing = item.catalogItem || (await getFoodCatalogItem(profileUsername, cleanName));

    if (existing) {
      setServingModalItem({
        ...existing,
        canonical_name: cleanName,
        brand: cleanTag(item.brand ?? existing.brand),
        variant: cleanTag(item.variant ?? existing.variant),
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        default_serving: item.serving_size,
        last_used_qty: item.quantity ?? existing.last_used_qty,
        last_used_unit: item.unit ?? existing.last_used_unit,
      });
    } else {
      setServingModalItem({
        username: profileUsername,
        canonical_name: cleanName,
        brand: cleanTag(item.brand),
        variant: cleanTag(item.variant),
        default_serving: item.serving_size,
        base_weight_g: item.base_weight_g ?? null,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        usage_count: 1,
        last_used_qty: item.quantity ?? null,
        last_used_unit: item.unit ?? null,
        created_at: '',
      });
    }
  };

  // --- Serving Modal Confirmations ---
  const handleConfirmServing = async (result: {
    foodName: string;
    originalCanonicalName: string;
    brand?: string | null;
    variant?: string | null;
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
      const finalBrand = cleanTag(result.brand !== undefined ? result.brand : (servingModalItem?.brand ?? null));
      const finalVariant = cleanTag(result.variant !== undefined ? result.variant : (servingModalItem?.variant ?? null));

      // Case 1: Editing item in AI Draft preview
      if (editingAiDraftIndex !== null) {
        setAiDraftItems((prev) => {
          const updated = [...prev];
          updated[editingAiDraftIndex] = {
            ...updated[editingAiDraftIndex],
            food_name: finalName,
            canonical_name: finalName,
            brand: finalBrand,
            variant: finalVariant,
            serving_size: result.servingSizeStr,
            calories: result.calories,
            protein: result.protein,
            carbs: result.carbs,
            fat: result.fat,
          };
          return updated;
        });
        setEditingAiDraftIndex(null);
        setServingModalItem(null);
        return;
      }

      // Case 2: Editing item in Global Staged Basket
      if (editingStagedIndex !== null) {
        setStagedItems((prev) => {
          const updated = [...prev];
          updated[editingStagedIndex] = {
            ...updated[editingStagedIndex],
            food_name: finalName,
            canonical_name: finalName,
            brand: finalBrand,
            variant: finalVariant,
            serving_size: result.servingSizeStr,
            quantity: result.quantity,
            unit: result.unit,
            calories: result.calories,
            protein: result.protein,
            carbs: result.carbs,
            fat: result.fat,
          };
          return updated;
        });
        setEditingStagedIndex(null);
        setServingModalItem(null);
        return;
      }

      // Case 3: Creating custom food and staging it
      if (isCreatingCustomFood) {
        await upsertFoodCatalog({
          username: profileUsername,
          canonical_name: finalName,
          brand: finalBrand,
          variant: finalVariant,
          default_serving: result.servingSizeStr,
          calories: result.calories,
          protein: result.protein,
          carbs: result.carbs,
          fat: result.fat,
          usage_count: 1,
          last_used_qty: result.quantity,
          last_used_unit: result.unit,
        });

        setStagedItems((prev) => [
          ...prev,
          {
            food_name: finalName,
            canonical_name: finalName,
            brand: finalBrand,
            variant: finalVariant,
            serving_size: result.servingSizeStr,
            quantity: result.quantity,
            unit: result.unit,
            calories: result.calories,
            protein: result.protein,
            carbs: result.carbs,
            fat: result.fat,
          },
        ]);

        setIsCreatingCustomFood(false);
        setServingModalItem(null);
        setSearchQuery('');
        loadSearchResults('');
        return;
      }

      // Case 4: Adding an item from Food Catalog to staged basket
      if (result.originalCanonicalName && finalName !== result.originalCanonicalName) {
        await renameFoodCatalogItem(profileUsername, result.originalCanonicalName, finalName);
      }
      await updateCatalogLastUsedMeasurement(
        profileUsername,
        finalName,
        result.quantity,
        result.unit
      );

      setStagedItems((prev) => [
        ...prev,
        {
          food_name: finalName,
          canonical_name: finalName,
          brand: finalBrand,
          variant: finalVariant,
          serving_size: result.servingSizeStr,
          quantity: result.quantity,
          unit: result.unit,
          calories: result.calories,
          protein: result.protein,
          carbs: result.carbs,
          fat: result.fat,
          catalogItem: servingModalItem ?? undefined,
        },
      ]);

      setServingModalItem(null);
      setSearchQuery(''); // Clears search query so catalog results reset cleanly
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to stage food item.');
    }
  };

  const handleConfirmImmediateLog = async (result: {
    foodName: string;
    originalCanonicalName: string;
    brand?: string | null;
    variant?: string | null;
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
      const finalBrand = cleanTag(result.brand !== undefined ? result.brand : (servingModalItem?.brand ?? null));
      const finalVariant = cleanTag(result.variant !== undefined ? result.variant : (servingModalItem?.variant ?? null));

      if (isCreatingCustomFood) {
        await upsertFoodCatalog({
          username: profileUsername,
          canonical_name: finalName,
          brand: finalBrand,
          variant: finalVariant,
          default_serving: result.servingSizeStr,
          calories: result.calories,
          protein: result.protein,
          carbs: result.carbs,
          fat: result.fat,
          usage_count: 1,
          last_used_qty: result.quantity,
          last_used_unit: result.unit,
        });
      } else {
        if (result.originalCanonicalName && finalName !== result.originalCanonicalName) {
          await renameFoodCatalogItem(profileUsername, result.originalCanonicalName, finalName);
        }
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
        brand: finalBrand,
        variant: finalVariant,
        serving_size: result.servingSizeStr,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
      });

      await recalculateUserTdee(profileUsername);
      setServingModalItem(null);
      setIsCreatingCustomFood(false);
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

  const handleCloseAttempt = () => {
    const totalCount = stagedItems.length + aiDraftItems.length;
    if (totalCount > 0) {
      Alert.alert(
        'Discard Food Log?',
        `You have ${totalCount} item${totalCount > 1 ? 's' : ''} that have not been logged.`,
        [
          { text: 'Keep Editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: resetAndClose },
        ]
      );
    } else {
      resetAndClose();
    }
  };

  const resetAndClose = () => {
    setInputQuery('');
    setAiDraftItems([]);
    setStagedItems([]);
    setSearchQuery('');
    setServingModalItem(null);
    setEditingStagedIndex(null);
    setEditingAiDraftIndex(null);
    setIsCreatingCustomFood(false);
    setIsBasketReviewVisible(false);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseAttempt}>
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
          <TouchableOpacity onPress={handleCloseAttempt} style={styles.closeBtn}>
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
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: stagedItems.length > 0 ? 84 : 20 },
            ]}
          >
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
                style={[styles.parseBtn, loadingAi && { opacity: 0.7 }]}
                onPress={handleParseWithGemini}
                disabled={loadingAi}
              >
                {loadingAi ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <>
                    <Ionicons name="sparkles" size={18} color="#fff" />
                    <Text style={styles.parseBtnText}>Calculate Nutrition</Text>
                  </>
                )}
              </TouchableOpacity>

              {(inputQuery.trim().length > 0 || aiDraftItems.length > 0) && (
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={() => {
                    setInputQuery('');
                    setAiDraftItems([]);
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={16} color="#64748b" />
                  <Text style={styles.clearBtnText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* AI Draft Items Preview (Local Working Area) */}
            {aiDraftItems.length > 0 && (
              <View style={styles.previewContainer}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text style={styles.previewTitle}>AI Estimated Items ({aiDraftItems.length})</Text>
                  <TouchableOpacity
                    onPress={() => setAiDraftItems([])}
                    style={styles.clearAllTextBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={13} color="#ef4444" />
                    <Text style={styles.clearAllText}>Clear draft</Text>
                  </TouchableOpacity>
                </View>

                {aiDraftItems.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.previewCard}
                    onPress={() => handleEditAiDraftItem(item, idx)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                        <Text style={styles.previewFoodName}>{item.food_name}</Text>
                        {isValidTag(item.brand) ? (
                          <View style={styles.brandBadge}>
                            <Ionicons name="business-outline" size={10} color="#475569" />
                            <Text style={styles.brandBadgeText}>{item.brand}</Text>
                          </View>
                        ) : null}
                        {isValidTag(item.variant) ? (
                          <View style={styles.variantBadge}>
                            <Text style={styles.variantBadgeText}>{item.variant}</Text>
                          </View>
                        ) : null}
                      </View>
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
                          handleRemoveAiDraftItem(idx);
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

                {/* Total Nutrition Summary Card for AI Draft */}
                <View style={styles.summaryTotalCard}>
                  <View style={styles.summaryTotalHeader}>
                    <Text style={styles.summaryTotalLabel}>Draft Estimated Nutrition</Text>
                    <Text style={styles.summaryTotalCals}>{totalAiDraftCalories} kcal</Text>
                  </View>
                  <View style={styles.summaryMacrosRow}>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Protein</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#2563eb' }]}>{totalAiDraftProtein}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Carbs</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#10b981' }]}>{totalAiDraftCarbs}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Fat</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#f59e0b' }]}>{totalAiDraftFat}g</Text>
                    </View>
                  </View>
                </View>

                {/* Stage vs Log Actions for AI Draft */}
                <View style={styles.aiActionGroup}>
                  <TouchableOpacity
                    style={styles.addToBasketBtn}
                    onPress={handleAddAiDraftToBasket}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="basket-outline" size={18} color="#ffffff" />
                    <Text style={styles.addToBasketBtnText}>
                      + Add to Staged Meal ({totalAiDraftCalories} kcal)
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.logDirectBtn}
                    onPress={handleLogAiDraftImmediately}
                    disabled={logging}
                    activeOpacity={0.85}
                  >
                    {logging ? (
                      <ActivityIndicator color="#2563eb" size="small" />
                    ) : (
                      <>
                        <Ionicons name="flash-outline" size={16} color="#2563eb" />
                        <Text style={styles.logDirectBtnText}>Log Directly to Today</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        ) : (
          <View style={[styles.content, { flex: 1, paddingBottom: 0 }]}>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={20} color="#94a3b8" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search food catalog..."
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholderTextColor="#94a3b8"
              />
              {searchQuery.trim().length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle" size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
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

            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ paddingBottom: stagedItems.length > 0 ? 84 : 20 }}
            >
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
                      onPress={() => {
                        setEditingStagedIndex(null);
                        setEditingAiDraftIndex(null);
                        setServingModalItem(item);
                      }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                          <Text style={styles.searchItemTitle}>{item.canonical_name}</Text>
                          {isValidTag(item.brand) ? (
                            <View style={styles.brandBadge}>
                              <Ionicons name="business-outline" size={10} color="#475569" />
                              <Text style={styles.brandBadgeText}>{item.brand}</Text>
                            </View>
                          ) : null}
                          {isValidTag(item.variant) ? (
                            <View style={styles.variantBadge}>
                              <Text style={styles.variantBadgeText}>{item.variant}</Text>
                            </View>
                          ) : null}
                        </View>
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

        {/* Global Floating Docked Bottom Bar (Visible whenever staged basket has items) */}
        {stagedItems.length > 0 && (
          <View style={[styles.floatingCartBar, { paddingBottom: insets.bottom > 0 ? insets.bottom : 12 }]}>
            <TouchableOpacity
              style={styles.floatingCartInfo}
              onPress={() => setIsBasketReviewVisible(true)}
              activeOpacity={0.8}
            >
              <View style={styles.floatingCartBadge}>
                <Ionicons name="basket" size={18} color="#ffffff" />
                <Text style={styles.floatingCartBadgeCount}>{stagedItems.length}</Text>
              </View>
              <View>
                <Text style={styles.floatingCartCals}>{totalBasketCalories} kcal</Text>
                <Text style={styles.floatingCartMacros}>
                  P: {totalBasketProtein}g • C: {totalBasketCarbs}g • F: {totalBasketFat}g
                </Text>
              </View>
            </TouchableOpacity>

            <View style={styles.floatingCartButtons}>
              <TouchableOpacity
                style={styles.floatingReviewBtn}
                onPress={() => setIsBasketReviewVisible(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.floatingReviewBtnText}>Review</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.floatingLogBtn}
                onPress={handleCommitStagedMeals}
                disabled={logging}
                activeOpacity={0.85}
              >
                {logging ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={16} color="#ffffff" />
                    <Text style={styles.floatingLogBtnText}>Log Meal</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Serving Size & Quantity Adjustment Modal */}
        <FoodServingModal
          visible={servingModalItem !== null}
          item={servingModalItem}
          initialManualMacros={isCreatingCustomFood}
          initialServing={
            editingStagedIndex !== null && stagedItems[editingStagedIndex]
              ? {
                  quantity: stagedItems[editingStagedIndex].quantity,
                  unit: stagedItems[editingStagedIndex].unit,
                }
              : undefined
          }
          title={
            editingAiDraftIndex !== null
              ? 'Edit Estimated Item'
              : editingStagedIndex !== null
              ? 'Edit Staged Food'
              : isCreatingCustomFood
              ? 'Create Custom Food'
              : 'Serving & Quantity'
          }
          submitLabel={
            editingAiDraftIndex !== null || editingStagedIndex !== null
              ? 'Update Item'
              : '+ Add to Meal'
          }
          secondarySubmitLabel={
            editingAiDraftIndex === null && editingStagedIndex === null ? 'Log Immediately' : undefined
          }
          onClose={() => {
            setServingModalItem(null);
            setEditingStagedIndex(null);
            setEditingAiDraftIndex(null);
            setIsCreatingCustomFood(false);
          }}
          onConfirm={handleConfirmServing}
          onSecondaryConfirm={
            editingAiDraftIndex === null && editingStagedIndex === null ? handleConfirmImmediateLog : undefined
          }
        />

        {/* Slide-Up Bottom Sheet for Staged Basket Review */}
        <Modal
          visible={isBasketReviewVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setIsBasketReviewVisible(false)}
        >
          <View style={styles.bottomSheetOverlay}>
            <TouchableWithoutFeedback onPress={() => setIsBasketReviewVisible(false)}>
              <View style={styles.bottomSheetBackdrop} />
            </TouchableWithoutFeedback>

            <View
              style={[
                styles.bottomSheetContainer,
                { paddingBottom: insets.bottom > 0 ? insets.bottom : 16 },
              ]}
            >
              {/* Drag Handle */}
              <View style={styles.bottomSheetHandleRow}>
                <View style={styles.bottomSheetHandle} />
              </View>

              {/* Sheet Header */}
              <View style={styles.bottomSheetHeader}>
                <View>
                  <Text style={styles.bottomSheetTitle}>Staged Meal Basket</Text>
                  <Text style={styles.bottomSheetSubTitle}>
                    {stagedItems.length} item{stagedItems.length > 1 ? 's' : ''} ready to log
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <TouchableOpacity
                    onPress={handleClearAllStaged}
                    style={styles.clearAllTextBtn}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="trash-outline" size={13} color="#ef4444" />
                    <Text style={styles.clearAllText}>Clear all</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setIsBasketReviewVisible(false)}
                    style={styles.sheetCloseBtn}
                  >
                    <Ionicons name="close" size={20} color="#64748b" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Items List */}
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
                {stagedItems.map((item, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.previewCard}
                    onPress={() => {
                      setIsBasketReviewVisible(false);
                      handleEditStagedItem(item, idx);
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 2 }}>
                        <Text style={styles.previewFoodName}>{item.food_name}</Text>
                        {isValidTag(item.brand) ? (
                          <View style={styles.brandBadge}>
                            <Ionicons name="business-outline" size={10} color="#475569" />
                            <Text style={styles.brandBadgeText}>{item.brand}</Text>
                          </View>
                        ) : null}
                        {isValidTag(item.variant) ? (
                          <View style={styles.variantBadge}>
                            <Text style={styles.variantBadgeText}>{item.variant}</Text>
                          </View>
                        ) : null}
                      </View>
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
                          handleRemoveStagedItem(idx);
                        }}
                        style={styles.deleteCardBtn}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="close-circle" size={18} color="#94a3b8" />
                      </TouchableOpacity>
                    </View>
                  </TouchableOpacity>
                ))}

                {/* Total Nutrition Summary */}
                <View style={styles.summaryTotalCard}>
                  <View style={styles.summaryTotalHeader}>
                    <Text style={styles.summaryTotalLabel}>Total Nutrition</Text>
                    <Text style={styles.summaryTotalCals}>{totalBasketCalories} kcal</Text>
                  </View>
                  <View style={styles.summaryMacrosRow}>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Protein</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#2563eb' }]}>{totalBasketProtein}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Carbs</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#10b981' }]}>{totalBasketCarbs}g</Text>
                    </View>
                    <View style={styles.summaryMacroBadge}>
                      <Text style={styles.summaryMacroLabel}>Fat</Text>
                      <Text style={[styles.summaryMacroVal, { color: '#f59e0b' }]}>{totalBasketFat}g</Text>
                    </View>
                  </View>
                </View>

                {/* Actions */}
                <TouchableOpacity
                  style={styles.confirmBtn}
                  onPress={handleCommitStagedMeals}
                  disabled={logging}
                  activeOpacity={0.85}
                >
                  {logging ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={20} color="#fff" />
                      <Text style={styles.confirmBtnText}>Confirm & Log Meal ({totalBasketCalories} kcal)</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.addMoreBtn}
                  onPress={() => setIsBasketReviewVisible(false)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={18} color="#2563eb" />
                  <Text style={styles.addMoreBtnText}>Back to Search / Add More Foods</Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </Modal>
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
    marginBottom: 14,
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
  aiActionGroup: {
    gap: 10,
    marginTop: 6,
  },
  addToBasketBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  addToBasketBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  logDirectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#eff6ff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 13,
    gap: 6,
  },
  logDirectBtnText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 10,
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
  brandBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  brandBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#475569',
  },
  variantBadge: {
    backgroundColor: '#fef3c7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  variantBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  floatingCartBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#0f172a',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: -3 },
    shadowRadius: 6,
    elevation: 8,
  },
  floatingCartInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  floatingCartBadge: {
    backgroundColor: '#2563eb',
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  floatingCartBadgeCount: {
    position: 'absolute',
    top: -3,
    right: -3,
    backgroundColor: '#ef4444',
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  floatingCartCals: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },
  floatingCartMacros: {
    fontSize: 11,
    color: '#64748b',
  },
  floatingCartButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  floatingReviewBtn: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  floatingReviewBtnText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
  floatingLogBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#16a34a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  floatingLogBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  bottomSheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  bottomSheetBackdrop: {
    flex: 1,
  },
  bottomSheetContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    maxHeight: '80%',
  },
  bottomSheetHandleRow: {
    alignItems: 'center',
    paddingVertical: 4,
    marginBottom: 8,
  },
  bottomSheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
  },
  bottomSheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  bottomSheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  bottomSheetSubTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563eb',
    marginTop: 2,
  },
  sheetCloseBtn: {
    padding: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
  },
  addMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: 8,
    backgroundColor: '#eff6ff',
    borderRadius: 12,
    gap: 6,
  },
  addMoreBtnText: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '600',
  },
});
