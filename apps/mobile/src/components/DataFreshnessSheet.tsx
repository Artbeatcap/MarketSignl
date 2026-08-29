/**
 * Bottom sheet explaining delayed prices vs structural levels.
 */

import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  MARKET_DATA_DELAY_MINUTES,
  MARKET_DATA_SOURCE,
  freshnessLabel,
  type DataFreshness,
} from '@chartsignl/core';
import { borderRadius, colors, spacing, typography } from '../theme';

export interface DataFreshnessSheetProps {
  freshness?: DataFreshness;
  historical?: boolean;
  visible: boolean;
  onClose: () => void;
}

const EXPLAINER =
  `Prices you see here are delayed by at least ${MARKET_DATA_DELAY_MINUTES} minutes. ` +
  `The support and resistance levels Atlas identifies are based on chart structure, ` +
  `which does not change on a ${MARKET_DATA_DELAY_MINUTES}-minute timescale — those levels are just as accurate. ` +
  `What may be slightly out of date is exactly where price sits right now. ` +
  `Always confirm the current price with your broker before placing a trade.`;

const DISCLAIMER =
  'Not investment advice. ChartSignl provides technical analysis for educational purposes. ' +
  'It is not investment advice, and no output should be treated as a recommendation to buy or sell any security. ' +
  'Trading involves risk of loss.';

export function DataFreshnessSheet({
  freshness,
  historical = false,
  visible,
  onClose,
}: DataFreshnessSheetProps) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(height);
      backdrop.setValue(0);
    }
  }, [visible, height, translateY, backdrop]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: height,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(onClose);
  };

  const long = freshness
    ? freshnessLabel(freshness, Date.now(), historical ? { historical: true } : undefined).long
    : 'This saved analysis was created before data timestamps were recorded.';
  const source = freshness?.source ?? MARKET_DATA_SOURCE;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close data disclosure"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: height * 0.85, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title}>Market data</Text>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.long}>{long}</Text>
            <Text style={styles.body}>{EXPLAINER}</Text>
            <Text style={styles.attribution}>Market data provided by {source}.</Text>
            <Text style={styles.disclaimer}>{DISCLAIMER}</Text>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral[200],
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.neutral[600],
  },
  scroll: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.lg },
  long: {
    ...typography.bodyMd,
    color: colors.neutral[900],
    lineHeight: 22,
    marginBottom: spacing.md,
    fontWeight: '500',
  },
  body: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  attribution: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  disclaimer: {
    ...typography.labelSm,
    color: colors.neutral[400],
    lineHeight: 18,
  },
});
