import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  freshnessLabel,
  type DataFreshness,
  type FreshnessLabel,
} from '@chartsignl/core';
import { Ionicons } from '@expo/vector-icons';
import { borderRadius, colors, spacing, typography } from '../theme';

const HISTORICAL_LABEL: FreshnessLabel = {
  short: 'Historical analysis',
  long: 'This saved analysis was created before data timestamps were recorded.',
  tone: 'neutral',
};

const TONE_STYLES = {
  neutral: {
    bg: colors.neutral[100],
    fg: colors.neutral[500],
    dot: colors.neutral[400],
  },
  info: {
    bg: colors.primary[50],
    fg: colors.primary[700],
    dot: colors.primary[500],
  },
  warning: {
    bg: colors.amber[50],
    fg: colors.amber[700],
    dot: colors.warning,
  },
} as const;

export interface DataFreshnessBadgeProps {
  freshness?: DataFreshness;
  compact?: boolean;
  historical?: boolean;
  onPress?: () => void;
}

export function DataFreshnessBadge({
  freshness,
  compact = false,
  historical = false,
  onPress,
}: DataFreshnessBadgeProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  const tick = useCallback(() => setNowMs(Date.now()), []);

  useEffect(() => {
    const id = setInterval(tick, 60_000);
    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') tick();
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [tick]);

  const label = useMemo<FreshnessLabel>(() => {
    if (!freshness) return HISTORICAL_LABEL;
    return freshnessLabel(freshness, nowMs, historical ? { historical: true } : undefined);
  }, [freshness, nowMs, historical]);

  const tone = TONE_STYLES[label.tone];
  const iconName = label.tone === 'warning' ? 'warning-outline' : 'time-outline';

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityLabel={label.long}
      style={({ pressed }) => [
        styles.pill,
        compact && styles.pillCompact,
        { backgroundColor: tone.bg, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: tone.dot }]} />
      <Ionicons name={iconName} size={compact ? 11 : 13} color={tone.fg} />
      <Text
        style={[styles.text, compact && styles.textCompact, { color: tone.fg }]}
        numberOfLines={1}
      >
        {label.short}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: borderRadius.full,
    maxWidth: '100%',
  },
  pillCompact: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  text: {
    ...typography.labelSm,
    fontWeight: '600',
    flexShrink: 1,
  },
  textCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
});
