/**
 * Pill row that turns chart layers on and off.
 */

import React, { memo, useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { CHART_COLORS } from '@chartsignl/core';
import { borderRadius, colors, spacing, typography } from '../../theme';
import {
  useChartLayers,
  type ChartLayerKey,
} from '../../store/chartLayerStore';
import { InfoButton } from '../education';

interface LayerDef {
  key: ChartLayerKey;
  label: string;
  color: string;
  accessibilityLabel: string;
  topic?: string;
}

const LAYERS: LayerDef[] = [
  {
    key: 'ema',
    label: 'EMA',
    color: CHART_COLORS.ema21,
    accessibilityLabel: 'Moving average lines',
    topic: 'ema',
  },
  {
    key: 'levels',
    label: 'Levels',
    color: CHART_COLORS.support,
    accessibilityLabel: 'Support and resistance levels',
    topic: 'supportLevel',
  },
  {
    key: 'volume',
    label: 'Volume',
    color: colors.neutral[600],
    accessibilityLabel: 'Volume bars',
  },
  {
    key: 'volumeProfile',
    label: 'Profile',
    color: colors.neutral[600],
    accessibilityLabel: 'Volume profile by price',
    topic: 'volumeProfile',
  },
];

export interface ChartLayerTogglesProps {
  available?: Partial<Record<ChartLayerKey, boolean>>;
  withInfo?: boolean;
  style?: StyleProp<ViewStyle>;
}

function ChartLayerTogglesBase({
  available,
  withInfo = false,
  style,
}: ChartLayerTogglesProps) {
  const state = useChartLayers();

  const visible = useMemo(
    () => LAYERS.filter((l) => available?.[l.key] !== false),
    [available]
  );

  if (visible.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, style]}
      directionalLockEnabled
    >
      {visible.map((layer) => {
        const active = state[layer.key];
        return (
          <View key={layer.key} style={styles.chipWrap}>
            <Pressable
              onPress={() => state.toggle(layer.key)}
              accessibilityRole="switch"
              accessibilityState={{ checked: active }}
              accessibilityLabel={layer.accessibilityLabel}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
              style={({ pressed }) => [
                styles.chip,
                active
                  ? {
                      backgroundColor: hexWithAlpha(layer.color, 0.14),
                      borderColor: hexWithAlpha(layer.color, 0.55),
                    }
                  : styles.chipInactive,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              {active ? (
                <View style={[styles.dot, { backgroundColor: layer.color }]} />
              ) : null}
              <Text
                style={[
                  styles.label,
                  active ? styles.labelActive : styles.labelInactive,
                ]}
                numberOfLines={1}
              >
                {layer.label}
              </Text>
            </Pressable>

            {withInfo && layer.topic ? (
              <InfoButton topic={layer.topic} size="sm" tone="muted" />
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

function hexWithAlpha(hex: string, alpha: number): string {
  if (!/^#([0-9a-f]{6})$/i.test(hex)) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  chipWrap: { flexDirection: 'row', alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    minHeight: 26,
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderColor: colors.neutral[200],
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginRight: 5,
  },
  label: {
    ...typography.labelSm,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelActive: { color: colors.neutral[900] },
  labelInactive: { color: colors.neutral[400] },
});

export const ChartLayerToggles = memo(ChartLayerTogglesBase);
