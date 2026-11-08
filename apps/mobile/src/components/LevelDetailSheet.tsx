/**
 * Panel that opens when a support/resistance line is tapped on the chart.
 * Bottom sheet on phones; right-side panel on wide web screens.
 *
 * Content is descriptive (what the level is, why it scored, how far it is).
 * What to DO about it stays with Atlas: before Atlas runs the panel offers
 * "Ask Atlas"; after, it shows the trade idea that uses this level, if any.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { Ionicons } from '@expo/vector-icons';
import {
  CHART_COLORS,
  getConfluenceBand,
  getEducation,
  type ScoredLevel,
  type TradeIdea,
} from '@chartsignl/core';
import { formatPrice } from '../lib/marketData';
import { levelDistanceText, levelReasons, proximityText } from '../lib/levelExplain';
import { borderRadius, colors, spacing, typography } from '../theme';

/** Web width at which the panel docks to the right instead of sliding up. */
const SIDE_PANEL_MIN_WIDTH = 900;
const SIDE_PANEL_WIDTH = 400;

export interface LevelDetailSheetProps {
  visible: boolean;
  onClose: () => void;
  level: ScoredLevel | null;
  symbol: string;
  currentPrice: number;
  /** True once an Atlas analysis is loaded for this chart. */
  hasAtlas: boolean;
  /** Atlas trade ideas that use this level as entry or target. */
  tradeIdeas: TradeIdea[];
  onAskAtlas?: () => void;
  isAnalyzing?: boolean;
  askAtlasLocked?: boolean;
  /** Price alert toggle. Omit to hide (alerts are native-only and need Atlas). */
  alert?: {
    active: boolean;
    busy: boolean;
    onToggle: () => void;
  };
}

export function LevelDetailSheet({
  visible,
  onClose,
  level,
  symbol,
  currentPrice,
  hasAtlas,
  tradeIdeas,
  onAskAtlas,
  isAnalyzing = false,
  askAtlasLocked = false,
  alert,
}: LevelDetailSheetProps) {
  const { width, height } = useWindowDimensions();
  const isSidePanel = Platform.OS === 'web' && width >= SIDE_PANEL_MIN_WIDTH;
  const offscreen = isSidePanel ? SIDE_PANEL_WIDTH : height;

  const slide = useRef(new Animated.Value(offscreen)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(offscreen);
      Animated.parallel([
        Animated.timing(slide, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 180,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    } else {
      slide.setValue(offscreen);
      backdrop.setValue(0);
    }
  }, [visible, offscreen, slide, backdrop]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(slide, {
        toValue: offscreen,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 150,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(onClose);
  };

  if (!level) return null;

  const isSupport = level.type === 'support';
  const color = isSupport ? CHART_COLORS.support : CHART_COLORS.resistance;
  const kind = isSupport ? 'Support' : 'Resistance';
  const education = getEducation(isSupport ? 'supportLevel' : 'resistanceLevel');
  const band = getConfluenceBand(level.confluenceScore);
  const reasons = levelReasons(level);
  const proximity = proximityText(level);

  const roleFor = (idea: TradeIdea) =>
    idea.entryLevelId === level.id ? 'entry' : idea.targetLevelId === level.id ? 'target' : null;

  const transform = isSidePanel ? [{ translateX: slide }] : [{ translateY: slide }];

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose} statusBarTranslucent>
      <View style={[styles.root, isSidePanel ? styles.rootSide : styles.rootBottom]}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close level details"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.panel,
            isSidePanel
              ? [styles.panelSide, { width: SIDE_PANEL_WIDTH, height }]
              : [styles.panelBottom, { maxHeight: height * 0.85 }],
            { transform },
          ]}
          accessibilityViewIsModal
        >
          {!isSidePanel ? <View style={styles.grabber} /> : null}

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.kindPill, { backgroundColor: `${color}1A` }]}>
                <View style={[styles.kindDot, { backgroundColor: color }]} />
                <Text style={[styles.kindText, { color }]}>
                  {kind} · {symbol}
                </Text>
              </View>
              <Text style={styles.price}>${formatPrice(level.price)}</Text>
              <Text style={styles.zone}>
                Zone ${formatPrice(level.zone.low)} – ${formatPrice(level.zone.high)}
              </Text>
            </View>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.close, { opacity: pressed ? 0.5 : 1 }]}
            >
              <Ionicons name="close" size={18} color={colors.neutral[600]} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.statsRow}>
              <Stat label="Distance" value={levelDistanceText(level, currentPrice)} />
              <Stat label="Strength" value={`${band.label} · ${Math.round(level.confluenceScore)}`} />
              {proximity ? <Stat label="Status" value={proximity} /> : null}
            </View>

            {education ? (
              <Section title={`What ${kind.toLowerCase()} means`}>
                <Text style={styles.body}>{education.short}</Text>
                <Text style={styles.bodyMuted}>{education.why}</Text>
              </Section>
            ) : null}

            <Section title="Why this level">
              {reasons.length > 0 ? (
                reasons.map((r) => (
                  <View key={r.key} style={styles.reasonRow}>
                    <Ionicons name="checkmark-circle" size={16} color={color} style={styles.reasonIcon} />
                    <Text style={styles.reasonText}>{r.text}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.bodyMuted}>{level.description}</Text>
              )}
              <Text style={styles.bandMeaning}>{band.meaning}</Text>
            </Section>

            <Section title="Atlas">
              {!hasAtlas ? (
                <>
                  <Text style={styles.bodyMuted}>
                    Atlas checks this level against the trend and the other levels, and tells you whether it
                    sets up a trade and where that idea would be wrong.
                  </Text>
                  {onAskAtlas ? (
                    <Pressable
                      onPress={() => {
                        handleClose();
                        onAskAtlas();
                      }}
                      disabled={isAnalyzing}
                      accessibilityRole="button"
                      accessibilityLabel={`Ask Atlas about ${symbol}`}
                      style={({ pressed }) => [
                        styles.atlasButton,
                        { opacity: pressed || isAnalyzing ? 0.7 : 1 },
                      ]}
                    >
                      {isAnalyzing ? (
                        <ActivityIndicator color={colors.white} size="small" />
                      ) : (
                        <Text style={styles.atlasButtonText}>
                          {askAtlasLocked ? 'See Atlas options' : `✨ Ask Atlas · ${symbol}`}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                </>
              ) : tradeIdeas.length > 0 ? (
                tradeIdeas.map((idea, i) => {
                  const role = roleFor(idea);
                  return (
                    <View key={`${idea.direction}-${i}`} style={styles.ideaCard}>
                      <Text style={styles.ideaTitle}>
                        {role === 'entry' ? 'Entry' : 'Target'} for a {idea.direction} idea
                      </Text>
                      <Text style={styles.body}>{idea.scenario}</Text>
                      <Text style={styles.ideaLabel}>Wrong if</Text>
                      <Text style={styles.bodyMuted}>{idea.invalidation}</Text>
                    </View>
                  );
                })
              ) : (
                <Text style={styles.bodyMuted}>
                  Atlas did not use this level in a trade idea. It is still on the chart as a reference point.
                </Text>
              )}
            </Section>

            {alert ? (
              <Pressable
                onPress={alert.onToggle}
                disabled={alert.busy}
                accessibilityRole="button"
                accessibilityLabel={alert.active ? 'Remove price alert' : 'Set price alert'}
                style={({ pressed }) => [styles.alertButton, { opacity: pressed || alert.busy ? 0.6 : 1 }]}
              >
                <Ionicons
                  name={alert.active ? 'notifications' : 'notifications-outline'}
                  size={16}
                  color={colors.primary[600]}
                />
                <Text style={styles.alertText}>
                  {alert.active
                    ? `Remove alert at $${formatPrice(level.price)}`
                    : `Alert me when price ${isSupport ? 'falls below' : 'rises above'} $${formatPrice(level.price)}`}
                </Text>
              </Pressable>
            ) : null}

            <Text style={styles.disclaimer}>
              Levels describe where price has reacted before. They do not predict what it will do. Not financial
              advice.
            </Text>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  rootBottom: { justifyContent: 'flex-end' },
  rootSide: { flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  panel: {
    backgroundColor: colors.surface,
  },
  panelBottom: {
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
  },
  panelSide: {
    paddingTop: spacing.lg,
    borderTopLeftRadius: borderRadius.lg,
    borderBottomLeftRadius: borderRadius.lg,
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
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerLeft: { flex: 1 },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    marginBottom: spacing.sm,
  },
  kindDot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  kindText: { ...typography.labelSm, fontWeight: '600' },
  price: { ...typography.headingLg, color: colors.neutral[900] },
  zone: { ...typography.bodySm, color: colors.neutral[500], marginTop: 2 },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  scroll: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.lg },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  statLabel: { ...typography.labelSm, color: colors.neutral[500], marginBottom: 2 },
  statValue: { ...typography.bodySm, color: colors.neutral[900], fontWeight: '600' },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.labelMd,
    color: colors.neutral[500],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  body: { ...typography.bodyMd, color: colors.neutral[800], lineHeight: 22, marginBottom: spacing.xs },
  bodyMuted: { ...typography.bodySm, color: colors.neutral[600], lineHeight: 20 },
  reasonRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.xs },
  reasonIcon: { marginTop: 2, marginRight: spacing.sm },
  reasonText: { ...typography.bodySm, color: colors.neutral[800], flex: 1, lineHeight: 20 },
  bandMeaning: { ...typography.bodySm, color: colors.neutral[500], marginTop: spacing.sm, lineHeight: 20 },
  atlasButton: {
    marginTop: spacing.md,
    backgroundColor: colors.primary[500],
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  atlasButtonText: { ...typography.labelLg, color: colors.white, fontWeight: '700' },
  ideaCard: {
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  ideaTitle: { ...typography.labelLg, color: colors.neutral[900], fontWeight: '700', marginBottom: spacing.xs },
  ideaLabel: { ...typography.labelSm, color: colors.neutral[500], marginTop: spacing.sm, marginBottom: 2 },
  alertButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  alertText: { ...typography.bodySm, color: colors.primary[700], fontWeight: '600', flex: 1 },
  disclaimer: { ...typography.labelSm, color: colors.neutral[400], lineHeight: 18 },
});
