// Simplified History Screen — analyses + predictions

import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getAnalysisHistory, getPredictionHistory } from '../../lib/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import type { AnalysisHistoryItem, PredictionHistoryItem } from '@marketsignl/core';
import { Ionicons } from '@expo/vector-icons';

type HistoryTab = 'analyses' | 'predictions';

export default function HistoryScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HistoryTab>('predictions');

  const analysesQuery = useQuery({
    queryKey: ['analysisHistory'],
    queryFn: () => getAnalysisHistory(1, 50),
    enabled: activeTab === 'analyses',
  });

  const predictionsQuery = useQuery({
    queryKey: ['predictionHistory'],
    queryFn: () => getPredictionHistory(1, 50),
    enabled: activeTab === 'predictions',
  });

  const isLoading = activeTab === 'analyses' ? analysesQuery.isLoading : predictionsQuery.isLoading;
  const isRefetching = activeTab === 'analyses' ? analysesQuery.isRefetching : predictionsQuery.isRefetching;
  const refetch = activeTab === 'analyses' ? analysesQuery.refetch : predictionsQuery.refetch;

  const analyses = analysesQuery.data?.analyses || [];
  const predictions = predictionsQuery.data?.predictions || [];

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString();
  };

  const renderAnalysisItem = ({ item }: { item: AnalysisHistoryItem }) => (
    <TouchableOpacity
      style={styles.analysisCard}
      onPress={() => router.push({ pathname: '/(tabs)/analyze', params: { analysisId: item.id } })}
      activeOpacity={0.7}
    >
      <View style={styles.iconContainer}>
        <Ionicons name="trending-up" size={32} color={colors.primary[500]} />
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          {item.symbol && (
            <View style={styles.symbolBadge}>
              <Text style={styles.symbolText}>{item.symbol}</Text>
            </View>
          )}
          {item.timeframe && (
            <View style={styles.timeframeBadge}>
              <Text style={styles.timeframeText}>{item.timeframe}</Text>
            </View>
          )}
        </View>
        <Text style={styles.headline} numberOfLines={2}>{item.headline}</Text>
        <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderPredictionItem = ({ item }: { item: PredictionHistoryItem }) => (
    <TouchableOpacity
      style={styles.analysisCard}
      onPress={() => router.push({ pathname: '/(tabs)/analyze', params: { predictionId: item.id } })}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, styles.predictionIcon]}>
        <Ionicons name="sparkles" size={32} color={colors.info} />
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardHeader}>
          <View style={styles.symbolBadge}>
            <Text style={styles.symbolText}>{item.symbol}</Text>
          </View>
          <View style={styles.predictionBadge}>
            <Text style={styles.predictionBadgeText}>
              {item.expectedChangePct >= 0 ? '+' : ''}{item.expectedChangePct.toFixed(2)}%
            </Text>
          </View>
        </View>
        <Text style={styles.headline} numberOfLines={2}>{item.headline}</Text>
        <Text style={styles.date}>
          {formatDate(item.createdAt)} · {item.confidence}% confidence
          {item.status === 'resolved' && item.directionHit != null
            ? item.directionHit
              ? ' · ✓ direction hit'
              : ' · ✗ direction miss'
            : item.status === 'pending'
              ? ' · pending'
              : ''}
        </Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons
        name={activeTab === 'predictions' ? 'sparkles-outline' : 'bar-chart-outline'}
        size={80}
        color={colors.neutral[300]}
      />
      <Text style={styles.emptyTitle}>
        {activeTab === 'predictions' ? 'No predictions yet' : 'No analyses yet'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {activeTab === 'predictions'
          ? 'Your AI forecasts will appear here after your first prediction.'
          : 'Your chart analyses will appear here after you analyze your first chart.'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <Text style={styles.title}>History</Text>

          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'predictions' && styles.tabActive]}
              onPress={() => setActiveTab('predictions')}
            >
              <Text style={[styles.tabText, activeTab === 'predictions' && styles.tabTextActive]}>
                Predictions
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tab, activeTab === 'analyses' && styles.tabActive]}
              onPress={() => setActiveTab('analyses')}
            >
              <Text style={[styles.tabText, activeTab === 'analyses' && styles.tabTextActive]}>
                Analyses
              </Text>
            </TouchableOpacity>
          </View>

          <FlatList
            data={activeTab === 'predictions' ? predictions : analyses}
            keyExtractor={(item) => item.id}
            renderItem={activeTab === 'predictions' ? renderPredictionItem : renderAnalysisItem}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={!isLoading ? renderEmptyState : null}
            refreshControl={
              <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary[500]} />
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.neutral[50],
  },
  webWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  webInner: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 480 : undefined,
  },
  title: {
    ...typography.headingLg,
    color: colors.neutral[800],
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.md,
    padding: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: borderRadius.sm,
  },
  tabActive: {
    backgroundColor: colors.white,
    ...shadows.sm,
  },
  tabText: {
    ...typography.labelMd,
    color: colors.neutral[500],
  },
  tabTextActive: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
    paddingBottom: 100,
    flexGrow: 1,
  },
  analysisCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  predictionIcon: {
    backgroundColor: '#EFF6FF',
  },
  cardContent: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
    flexWrap: 'wrap',
  },
  symbolBadge: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  symbolText: {
    ...typography.labelSm,
    color: colors.primary[700],
    fontWeight: '600',
  },
  timeframeBadge: {
    backgroundColor: colors.neutral[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  timeframeText: {
    ...typography.labelSm,
    color: colors.neutral[600],
  },
  predictionBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  predictionBadgeText: {
    ...typography.labelSm,
    color: '#1D4ED8',
    fontWeight: '600',
  },
  headline: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    marginBottom: 4,
  },
  date: {
    ...typography.labelSm,
    color: colors.neutral[400],
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    ...typography.headingMd,
    color: colors.neutral[700],
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    textAlign: 'center',
  },
});
