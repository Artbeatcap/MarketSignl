import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { AIPrediction } from '@marketsignl/core';
import { CHART_COLORS } from '@marketsignl/core';
import { colors, typography, spacing, borderRadius } from '../theme';
import { Card } from './Card';

interface PredictionSummaryProps {
  prediction: AIPrediction;
}

export function PredictionSummary({ prediction }: PredictionSummaryProps) {
  const changeColor =
    prediction.expectedChangePct >= 0 ? CHART_COLORS.support : CHART_COLORS.resistance;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.badge}>✨ AI Prediction</Text>
        <Text style={[styles.changePct, { color: changeColor }]}>
          {prediction.expectedChangePct >= 0 ? '+' : ''}
          {prediction.expectedChangePct.toFixed(2)}%
        </Text>
      </View>

      <Text style={styles.headline}>{prediction.headline}</Text>
      <Text style={styles.summary}>{prediction.summary}</Text>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaLabel}>Confidence</Text>
          <Text style={styles.metaValue}>{prediction.confidence}%</Text>
        </View>
        <View style={styles.metaChip}>
          <Text style={styles.metaLabel}>Direction</Text>
          <Text style={styles.metaValue}>
            {prediction.direction.charAt(0).toUpperCase() + prediction.direction.slice(1)}
          </Text>
        </View>
      </View>

      {prediction.reasoning.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Reasoning</Text>
          {prediction.reasoning.map((item, i) => (
            <Text key={i} style={styles.bullet}>
              • {item}
            </Text>
          ))}
        </View>
      )}

      {prediction.riskFactors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Risk Factors</Text>
          {prediction.riskFactors.map((item, i) => (
            <Text key={i} style={styles.riskBullet}>
              ⚠ {item}
            </Text>
          ))}
        </View>
      )}

      <Text style={styles.disclaimer}>
        Educational forecast only — not financial advice. Past patterns do not guarantee future results.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  badge: {
    ...typography.labelMd,
    color: CHART_COLORS.predictionLabel,
    fontWeight: '600',
  },
  changePct: {
    ...typography.headingSm,
    fontWeight: '700',
  },
  headline: {
    ...typography.headingMd,
    color: colors.neutral[800],
    marginBottom: spacing.xs,
  },
  summary: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  metaChip: {
    flex: 1,
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  metaLabel: {
    ...typography.labelSm,
    color: colors.neutral[500],
  },
  metaValue: {
    ...typography.headingSm,
    color: colors.neutral[800],
    marginTop: 2,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.labelMd,
    color: colors.neutral[700],
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  bullet: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginBottom: 4,
    lineHeight: 20,
  },
  riskBullet: {
    ...typography.bodySm,
    color: colors.warning,
    marginBottom: 4,
    lineHeight: 20,
  },
  disclaimer: {
    ...typography.labelSm,
    color: colors.neutral[400],
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
});
