import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { AIPrediction } from '@chartsignl/core';
import { CHART_COLORS } from '@chartsignl/core';
import { colors, typography, spacing } from '../theme';
import { Card } from './Card';

interface PredictionSummaryProps {
  prediction: AIPrediction;
}

export function PredictionSummary({ prediction }: PredictionSummaryProps) {
  return (
    <Card style={styles.card}>
      <Text style={styles.badge}>Atlas analysis</Text>

      <Text style={styles.headline}>{prediction.headline}</Text>
      <Text style={styles.summary}>{prediction.summary}</Text>

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
  badge: {
    ...typography.labelMd,
    color: CHART_COLORS.predictionLabel,
    fontWeight: '600',
    marginBottom: spacing.sm,
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
