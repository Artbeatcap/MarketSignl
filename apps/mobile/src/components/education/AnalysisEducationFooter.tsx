/**
 * "What do these mean?" block at the end of an analysis.
 * Lists only concepts that appeared in this analysis.
 */

import React, { useMemo, useState } from 'react';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import {
  EDUCATION_DISCLAIMER,
  getRelevantEducation,
  type EducationEntry,
  type ExperienceLevel,
  type ConfluenceFactors,
} from '@chartsignl/core';
import { borderRadius, colors, spacing, typography } from '../../theme';
import { useEducationOptional } from './EducationProvider';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export interface AnalysisEducationFooterProps {
  analysis: any;
  experienceLevel?: ExperienceLevel | null;
  topicIds?: string[];
}

/** ChartSignl factors are always objects — count only those with real signal. */
function isActiveFactor(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.points === 'number') return v.points > 0;
  if (typeof v.isHighVolume === 'boolean') return v.isHighVolume;
  if (typeof v.isRound === 'boolean') return v.isRound;
  if (typeof v.isRecent === 'boolean') return v.isRecent;
  if ('level' in v) return v.level != null;
  if ('ema' in v) return v.ema != null;
  if (typeof v.count === 'number') return v.count > 0;
  return false;
}

function detectTopics(analysis: any): string[] {
  const ids: string[] = [];
  if (!analysis) return ids;

  const supports = analysis.supportLevels ?? [];
  const resistances = analysis.resistanceLevels ?? [];
  const ind =
    analysis.technicalDetails?.raw ??
    analysis.indicators ??
    analysis.technicalIndicators ??
    {};

  if (supports.length || resistances.length) {
    ids.push('confluence', 'relevance');
    if (supports.length) ids.push('supportLevel');
    if (resistances.length) ids.push('resistanceLevel');
  }

  const factorKeys = new Set<string>();
  [...supports, ...resistances].forEach((l: { factors?: ConfluenceFactors }) => {
    Object.entries(l?.factors ?? {}).forEach(([k, v]) => {
      if (isActiveFactor(v)) factorKeys.add(k.toLowerCase());
    });
  });
  const hasFactor = (needle: string) =>
    [...factorKeys].some((k) => k.includes(needle));

  if (hasFactor('ema') || ind.ema) ids.push('ema', 'emaAlignment');
  if (hasFactor('fib') || ind.fibonacci) ids.push('fibonacci');
  if (hasFactor('volume') || ind.volumeProfile) {
    ids.push('volumeProfile', 'pointOfControl');
  }

  if (analysis.trend) ids.push('trend');
  if (ind.atr) ids.push('atr');
  if (ind.bollinger) ids.push('bollinger');
  if (ind.overextension?.meanReversionSignal || ind.overextension) {
    ids.push('overextension');
  }
  if (analysis.confidence || analysis.overallConfidence != null) {
    ids.push('confidence');
  }
  if (analysis.tradeIdeas?.length) {
    ids.push('tradeIdea', 'riskReward', 'stopLoss');
  }

  return ids;
}

export function AnalysisEducationFooter({
  analysis,
  experienceLevel,
  topicIds,
}: AnalysisEducationFooterProps) {
  const education = useEducationOptional();
  const isBeginner = experienceLevel === 'beginner';
  const [expanded, setExpanded] = useState(isBeginner);

  const entries: EducationEntry[] = useMemo(
    () => getRelevantEducation(topicIds ?? detectTopics(analysis)),
    [analysis, topicIds]
  );

  if (entries.length === 0) return null;

  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpanded((v) => !v);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="What do these terms mean?"
        style={({ pressed }) => [styles.header, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.headerText}>
          <Text style={styles.headerTitle}>New to these terms?</Text>
          <Text style={styles.headerSub}>
            Plain-English explanations for the {entries.length} indicators used
            in this analysis
          </Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '−' : '+'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.list}>
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              onPress={() => education?.open(entry.id)}
              accessibilityRole="button"
              accessibilityLabel={`Explain ${entry.title}`}
              style={({ pressed }) => [
                styles.row,
                { opacity: pressed ? 0.6 : 1 },
              ]}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{entry.title}</Text>
                <Text style={styles.rowShort} numberOfLines={2}>
                  {entry.short}
                </Text>
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          ))}

          <Text style={styles.disclaimer}>{EDUCATION_DISCLAIMER}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
  },
  headerText: { flex: 1, paddingRight: spacing.md },
  headerTitle: {
    ...typography.bodyMd,
    color: colors.neutral[900],
    fontWeight: '600',
  },
  headerSub: {
    ...typography.labelSm,
    color: colors.neutral[600],
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    lineHeight: 24,
    color: colors.neutral[400],
    width: 22,
    textAlign: 'center',
  },
  list: {
    borderTopWidth: 1,
    borderTopColor: colors.neutral[200],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.neutral[200],
  },
  rowText: { flex: 1, paddingRight: spacing.sm },
  rowTitle: {
    ...typography.bodySm,
    color: colors.neutral[900],
    fontWeight: '600',
  },
  rowShort: {
    ...typography.labelSm,
    color: colors.neutral[600],
    marginTop: 1,
    lineHeight: 16,
  },
  rowChevron: {
    fontSize: 20,
    color: colors.neutral[400],
  },
  disclaimer: {
    ...typography.labelSm,
    color: colors.neutral[400],
    lineHeight: 16,
    marginTop: spacing.md,
  },
});
