import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FoodCatalogItem } from '../types';
import { parseServingString, scaleNutrition } from '../services/serving';

interface FoodServingModalProps {
  visible: boolean;
  item: FoodCatalogItem | null;
  initialServing?: {
    quantity?: number;
    unit?: string;
  };
  initialManualMacros?: boolean;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onConfirm: (result: {
    foodName: string;
    originalCanonicalName: string;
    servingSizeStr: string;
    quantity: number;
    unit: string;
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  }) => Promise<void>;
}

export function FoodServingModal({
  visible,
  item,
  initialServing,
  initialManualMacros,
  title,
  submitLabel,
  onClose,
  onConfirm,
}: FoodServingModalProps) {
  const [foodName, setFoodName] = useState('');
  const [quantityStr, setQuantityStr] = useState('1');
  const [selectedUnit, setSelectedUnit] = useState('g');
  const [availableUnits, setAvailableUnits] = useState<string[]>(['g', 'oz', 'serving']);

  // Manual Macro overrides
  const [isManualMacros, setIsManualMacros] = useState(false);
  const [manualCalories, setManualCalories] = useState('');
  const [manualProtein, setManualProtein] = useState('');
  const [manualCarbs, setManualCarbs] = useState('');
  const [manualFat, setManualFat] = useState('');

  // Base nutrition reference
  const [baseNutrition, setBaseNutrition] = useState<{
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    baseQty: number;
    baseWeightG: number | null;
  }>({
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    baseQty: 1,
    baseWeightG: 100,
  });

  useEffect(() => {
    if (!item) return;

    setFoodName(item.canonical_name);

    const parsed = parseServingString(item.default_serving, item.base_weight_g);
    const initialBaseQty = parsed.initialQty || 1;
    const initialBaseWeight = parsed.baseWeightG || 100;

    setBaseNutrition({
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
      baseQty: initialBaseQty,
      baseWeightG: initialBaseWeight,
    });

    // Check if food already has a remembered measurement or custom initial serving
    const initialUnit = initialServing?.unit || item.last_used_unit || parsed.initialUnit || 'g';
    const initialQty = initialServing?.quantity !== undefined
      ? initialServing.quantity.toString()
      : item.last_used_qty
      ? item.last_used_qty.toString()
      : initialBaseQty.toString();

    setQuantityStr(initialQty);
    setSelectedUnit(initialUnit);

    if (initialManualMacros) {
      setIsManualMacros(true);
      setManualCalories(item.calories !== undefined ? item.calories.toString() : '');
      setManualProtein(item.protein !== undefined ? item.protein.toString() : '');
      setManualCarbs(item.carbs !== undefined ? item.carbs.toString() : '');
      setManualFat(item.fat !== undefined ? item.fat.toString() : '');
    } else {
      setIsManualMacros(false);
      setManualCalories('');
      setManualProtein('');
      setManualCarbs('');
      setManualFat('');
    }

    // Build available units list
    const units = new Set<string>(['g', 'oz', 'serving']);
    if (initialServing?.unit) {
      units.add(initialServing.unit);
    }
    if (parsed.initialUnit && parsed.initialUnit !== 'g' && parsed.initialUnit !== 'oz') {
      units.add(parsed.initialUnit);
    }
    // Add volume units if liquid or powder
    const nameLower = item.canonical_name.toLowerCase();
    if (
      nameLower.includes('oil') ||
      nameLower.includes('milk') ||
      nameLower.includes('sauce') ||
      nameLower.includes('coffee') ||
      nameLower.includes('water') ||
      nameLower.includes('juice') ||
      nameLower.includes('soup')
    ) {
      units.add('ml');
      units.add('tbsp');
      units.add('cup');
    }
    setAvailableUnits(Array.from(units));
  }, [item, initialServing]);

  if (!item) return null;

  const currentQty = parseFloat(quantityStr) || 0;
  const scaled = scaleNutrition(baseNutrition, currentQty, selectedUnit);

  const displayCalories =
    isManualMacros && manualCalories !== '' ? parseFloat(manualCalories) || 0 : scaled.calories;
  const displayProtein =
    isManualMacros && manualProtein !== '' ? parseFloat(manualProtein) || 0 : scaled.protein;
  const displayCarbs =
    isManualMacros && manualCarbs !== '' ? parseFloat(manualCarbs) || 0 : scaled.carbs;
  const displayFat =
    isManualMacros && manualFat !== '' ? parseFloat(manualFat) || 0 : scaled.fat;

  const handleToggleManualMacros = () => {
    if (!isManualMacros) {
      setManualCalories(scaled.calories.toString());
      setManualProtein(scaled.protein.toString());
      setManualCarbs(scaled.carbs.toString());
      setManualFat(scaled.fat.toString());
      setIsManualMacros(true);
    } else {
      setIsManualMacros(false);
    }
  };

  const handleApplyMultiplier = (multiplier: number) => {
    const val = (parseFloat(quantityStr) || 1) * multiplier;
    setQuantityStr((Math.round(val * 10) / 10).toString());
  };

  const handleApplyDelta = (deltaG: number) => {
    if (selectedUnit === 'g') {
      const val = Math.max(0, (parseFloat(quantityStr) || 0) + deltaG);
      setQuantityStr(val.toString());
    }
  };

  const handleSave = async () => {
    const finalQty = parseFloat(quantityStr);
    if (isNaN(finalQty) || finalQty <= 0) {
      return;
    }

    await onConfirm({
      foodName: foodName.trim() || item.canonical_name,
      originalCanonicalName: item.canonical_name,
      servingSizeStr: scaled.servingSizeStr,
      quantity: finalQty,
      unit: selectedUnit,
      calories: displayCalories,
      protein: displayProtein,
      carbs: displayCarbs,
      fat: displayFat,
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalOverlay}
      >
        <View style={styles.modalContainer}>
          {/* Header */}
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{title || 'Serving & Quantity'}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 16 }}>
            {/* Editable Food Name */}
            <View style={styles.nameContainer}>
              <View style={styles.nameHeaderRow}>
                <Ionicons name="pencil-outline" size={14} color="#64748b" />
                <Text style={styles.nameLabel}>Food Name (Tap to edit)</Text>
              </View>
              <TextInput
                style={styles.nameInput}
                value={foodName}
                onChangeText={setFoodName}
                placeholder="Food name"
                placeholderTextColor="#94a3b8"
              />
            </View>

            {/* Live Macros Display Card */}
            <View style={styles.macroCard}>
              <View style={styles.macroHeaderRow}>
                <View style={styles.calorieBox}>
                  {isManualMacros ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TextInput
                        style={[styles.calorieVal, { minWidth: 80, borderBottomWidth: 1, borderColor: '#cbd5e1' }]}
                        value={manualCalories}
                        onChangeText={setManualCalories}
                        keyboardType="decimal-pad"
                        textAlign="center"
                      />
                      <Text style={[styles.calorieLabel, { marginLeft: 6 }]}>kcal</Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.calorieVal}>{displayCalories}</Text>
                      <Text style={styles.calorieLabel}>kcal</Text>
                    </>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.macroToggleBtn}
                  onPress={handleToggleManualMacros}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={isManualMacros ? 'checkmark-circle-outline' : 'options-outline'}
                    size={14}
                    color="#2563eb"
                  />
                  <Text style={styles.macroToggleText}>
                    {isManualMacros ? 'Auto Scale' : 'Edit Macros'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.macroPillsRow}>
                <View style={[styles.macroPill, { backgroundColor: '#eff6ff' }]}>
                  {isManualMacros ? (
                    <TextInput
                      style={[styles.macroPillVal, { color: '#2563eb', minWidth: 40, textAlign: 'center' }]}
                      value={manualProtein}
                      onChangeText={setManualProtein}
                      keyboardType="decimal-pad"
                    />
                  ) : (
                    <Text style={[styles.macroPillVal, { color: '#2563eb' }]}>{displayProtein}g</Text>
                  )}
                  <Text style={styles.macroPillLabel}>Protein</Text>
                </View>
                <View style={[styles.macroPill, { backgroundColor: '#fffbeb' }]}>
                  {isManualMacros ? (
                    <TextInput
                      style={[styles.macroPillVal, { color: '#d97706', minWidth: 40, textAlign: 'center' }]}
                      value={manualCarbs}
                      onChangeText={setManualCarbs}
                      keyboardType="decimal-pad"
                    />
                  ) : (
                    <Text style={[styles.macroPillVal, { color: '#d97706' }]}>{displayCarbs}g</Text>
                  )}
                  <Text style={styles.macroPillLabel}>Carbs</Text>
                </View>
                <View style={[styles.macroPill, { backgroundColor: '#f0fdf4' }]}>
                  {isManualMacros ? (
                    <TextInput
                      style={[styles.macroPillVal, { color: '#16a34a', minWidth: 40, textAlign: 'center' }]}
                      value={manualFat}
                      onChangeText={setManualFat}
                      keyboardType="decimal-pad"
                    />
                  ) : (
                    <Text style={[styles.macroPillVal, { color: '#16a34a' }]}>{displayFat}g</Text>
                  )}
                  <Text style={styles.macroPillLabel}>Fat</Text>
                </View>
              </View>
            </View>

            {/* Quantity Input and Unit Selector */}
            <Text style={styles.sectionLabel}>Quantity & Unit</Text>
            <View style={styles.qtyUnitRow}>
              <TextInput
                style={styles.qtyInput}
                keyboardType="decimal-pad"
                value={quantityStr}
                onChangeText={setQuantityStr}
                selectTextOnFocus
              />

              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.unitScroll}>
                {availableUnits.map((u) => {
                  const isActive = selectedUnit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitChip, isActive && styles.unitChipActive]}
                      onPress={() => setSelectedUnit(u)}
                    >
                      <Text style={[styles.unitChipText, isActive && styles.unitChipTextActive]}>
                        {u}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>

            {/* Quick Adjust Buttons */}
            <View style={styles.quickButtonsRow}>
              {selectedUnit === 'g' ? (
                <>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyDelta(-50)}>
                    <Text style={styles.quickBtnText}>-50g</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyDelta(-10)}>
                    <Text style={styles.quickBtnText}>-10g</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyDelta(+10)}>
                    <Text style={styles.quickBtnText}>+10g</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyDelta(+50)}>
                    <Text style={styles.quickBtnText}>+50g</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyMultiplier(0.5)}>
                    <Text style={styles.quickBtnText}>0.5×</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyMultiplier(1.0)}>
                    <Text style={styles.quickBtnText}>1×</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyMultiplier(1.5)}>
                    <Text style={styles.quickBtnText}>1.5×</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.quickBtn} onPress={() => handleApplyMultiplier(2.0)}>
                    <Text style={styles.quickBtnText}>2×</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Confirm Log Button */}
            <TouchableOpacity style={styles.confirmBtn} onPress={handleSave} activeOpacity={0.85}>
              <Text style={styles.confirmBtnText}>
                {submitLabel
                  ? `${submitLabel} (${displayCalories} kcal)`
                  : `Log ${scaled.servingSizeStr} (${displayCalories} kcal)`}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    maxHeight: '85%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0f172a',
  },
  closeBtn: {
    padding: 6,
    backgroundColor: '#f1f5f9',
    borderRadius: 16,
  },
  nameContainer: {
    backgroundColor: '#f8fafc',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  nameHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 4,
  },
  nameLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
    paddingVertical: 2,
  },
  macroCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 14,
    marginBottom: 16,
    alignItems: 'center',
  },
  macroHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    position: 'relative',
    marginBottom: 12,
  },
  macroToggleBtn: {
    position: 'absolute',
    right: 0,
    top: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#eff6ff',
  },
  macroToggleText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#2563eb',
  },
  calorieBox: {
    alignItems: 'center',
  },
  calorieVal: {
    fontSize: 34,
    fontWeight: '900',
    color: '#0f172a',
  },
  calorieLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  macroPillsRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
    justifyContent: 'center',
  },
  macroPill: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
  },
  macroPillVal: {
    fontSize: 15,
    fontWeight: '800',
  },
  macroPillLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  qtyUnitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  qtyInput: {
    backgroundColor: '#f1f5f9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 20,
    fontWeight: '800',
    color: '#0f172a',
    minWidth: 90,
    textAlign: 'center',
  },
  unitScroll: {
    flexDirection: 'row',
  },
  unitChip: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
  },
  unitChipActive: {
    backgroundColor: '#2563eb',
  },
  unitChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  unitChipTextActive: {
    color: '#ffffff',
  },
  quickButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 8,
  },
  quickBtn: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  quickBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  confirmBtn: {
    backgroundColor: '#2563eb',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: '#2563eb',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  confirmBtnText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
