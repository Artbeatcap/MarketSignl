// Simplified History Screen - Data Only (No Images)

import { useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, RefreshControl, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getAnalysisHistory, getPredictionHistory } from '../../lib/api';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import type { AnalysisHistoryItem, PredictionHistoryItem } from '@chartsignl/core';
import { Ionicons } from '@expo/vector-icons';

type HistoryTab = 'analyses' | 'predictions';

export default function HistoryScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<HistoryTab>('analyses');

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['analysisHistory'],
    queryFn: () => getAnalysisHistory(1, 50),
  });

  const {
    data: predictionData,
    isLoading: isLoadingPredictions,
    isRefetching: isRefetchingPredictions,
    refetch: refetchPredictions,
  } = useQuery({
    queryKey: ['predictionHistory'],
    queryFn: () => getPredictionHistory(1, 50),
  });

  const analyses = data?.analyses || [];
  const predictions = predictionData?.predictions || [];

  const handleAnalysisPress = (item: AnalysisHistoryItem) => {
    router.push({
      pathname: '/(tabs)/analyze',
      params: {
        analysisId: item.id,
        ...(item.predictionId ? { predictionId: item.predictionId } : {}),
      },
    });
  };

  const handlePredictionPress = (item: PredictionHistoryItem) => {
    router.push({
      pathname: '/(tabs)/analyze',
      params: {
        predictionId: item.id,
        ...(item.analysisId ? { analysisId: item.analysisId } : {}),
      },
    });
  };

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

  const renderItem = ({ item }: { item: AnalysisHistoryItem }) => (
    <TouchableOpacity
      style={styles.analysisCard}
      onPress={() => handleAnalysisPress(item)}
      activeOpacity={0.7}
    >
      {/* Icon instead of image */}
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
        <Text style={styles.headline} numberOfLines={2}>
          {item.headline}
        </Text>
        <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderPredictionItem = ({ item }: { item: PredictionHistoryItem }) => {
    const isPositive = item.expectedChangePct >= 0;
    const changeColor = isPositive ? colors.support.strong : colors.resistance.strong;
    const resolved = item.status === 'resolved';

    return (
      <TouchableOpacity
        style={styles.analysisCard}
        onPress={() => handlePredictionPress(item)}
        activeOpacity={0.7}
      >
        <View style={styles.iconContainer}>
          <Ionicons name="sparkles" size={30} color={colors.primary[500]} />
        </View>

        <View style={styles.cardContent}>
          <View style={styles.cardHeader}>
            <View style={styles.symbolBadge}>
              <Text style={styles.symbolText}>{item.symbol}</Text>
            </View>
            <View style={styles.timeframeBadge}>
              <Text style={styles.timeframeText}>{item.interval}</Text>
            </View>
            <Text style={[styles.changeText, { color: changeColor }]}>
              {isPositive ? '+' : ''}
              {item.expectedChangePct.toFixed(2)}%
            </Text>
          </View>
          <Text style={styles.headline} numberOfLines={2}>
            {item.headline}
          </Text>
          <View style={styles.predictionFooter}>
            <Text style={styles.date}>{formatDate(item.createdAt)}</Text>
            <View
              style={[
                styles.statusBadge,
                resolved
                  ? item.directionHit
                    ? styles.statusHit
                    : styles.statusMiss
                  : styles.statusPending,
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  resolved
                    ? item.directionHit
                      ? styles.statusTextHit
                      : styles.statusTextMiss
                    : styles.statusTextPending,
                ]}
              >
                {resolved ? (item.directionHit ? 'Hit' : 'Miss') : 'Pending'}
              </Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="bar-chart-outline" size={80} color={colors.neutral[300]} />
      <Text style={styles.emptyTitle}>No analyses yet</Text>
      <Text style={styles.emptySubtitle}>
        Your chart analyses will appear here after you analyze your first chart.
      </Text>
    </View>
  );

  const renderPredictionEmptyState = () => (
    <View style={styles.emptyState}>
      <Ionicons name="sparkles-outline" size={80} color={colors.neutral[300]} />
      <Text style={styles.emptyTitle}>No predictions yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap Analyze on a chart to run Atlas and generate your first forecast. It will appear here
        with its outcome once the horizon elapses.
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>History</Text>
            <Text style={styles.headerSubtitle}>
              {activeTab === 'analyses'
                ? `${analyses.length} ${analyses.length === 1 ? 'analysis' : 'analyses'}`
                : `${predictions.length} ${predictions.length === 1 ? 'forecast' : 'forecasts'}`}
            </Text>
          </View>

          {/* Tab toggle */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'analyses' && styles.tabButtonActive]}
              onPress={() => setActiveTab('analyses')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === 'analyses' && styles.tabTextActive]}>
                Analyses
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'predictions' && styles.tabButtonActive]}
              onPress={() => setActiveTab('predictions')}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, activeTab === 'predictions' && styles.tabTextActive]}>
                Forecasts
              </Text>
            </TouchableOpacity>
          </View>

          {activeTab === 'analyses' ? (
            <FlatList
              data={analyses}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={!isLoading ? renderEmptyState : null}
              refreshControl={
                <RefreshControl
                  refreshing={isRefetching}
                  onRefresh={refetch}
                  tintColor={colors.primary[500]}
                />
              }
            />
          ) : (
            <FlatList
              data={predictions}
              keyExtractor={(item) => item.id}
              renderItem={renderPredictionItem}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={!isLoadingPredictions ? renderPredictionEmptyState : null}
              refreshControl={
                <RefreshControl
                  refreshing={isRefetchingPredictions}
                  onRefresh={refetchPredictions}
                  tintColor={colors.primary[500]}
                />
              }
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 1100;

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh', overflow: 'auto' }),
    backgroundColor: colors.background,
  },
  webWrapper: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && {
      alignItems: 'center',
      backgroundColor: colors.neutral[100],
    }),
  },
  webInner: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    width: '100%',
    ...(Platform.OS === 'web' && {
      maxWidth: WEB_MAX_WIDTH,
      backgroundColor: colors.background,
      borderLeftWidth: 1,
      borderRightWidth: 1,
      borderColor: colors.neutral[200],
    }),
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  headerTitle: {
    ...typography.displaySm,
    color: colors.neutral[900],
  },
  headerSubtitle: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  tabBar: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    alignItems: 'center',
    backgroundColor: colors.neutral[100],
  },
  tabButtonActive: {
    backgroundColor: colors.primary[500],
  },
  tabText: {
    ...typography.labelMd,
    color: colors.neutral[600],
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.white,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xxl,
  },
  changeText: {
    ...typography.labelMd,
    fontWeight: '700',
    marginLeft: 'auto',
  },
  predictionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  statusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  statusPending: {
    backgroundColor: colors.neutral[100],
  },
  statusHit: {
    backgroundColor: colors.green[100],
  },
  statusMiss: {
    backgroundColor: colors.red[100],
  },
  statusText: {
    ...typography.labelSm,
    fontWeight: '600',
  },
  statusTextPending: {
    color: colors.neutral[500],
  },
  statusTextHit: {
    color: colors.green[700],
  },
  statusTextMiss: {
    color: colors.red[700],
  },
  analysisCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    ...shadows.sm,
  },
  iconContainer: {
    width: 80,
    height: 80,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardContent: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'center',
  },
  cardHeader: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  symbolBadge: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  symbolText: {
    ...typography.labelMd,
    color: colors.primary[700],
    fontWeight: '600',
  },
  timeframeBadge: {
    backgroundColor: colors.neutral[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.sm,
  },
  timeframeText: {
    ...typography.labelMd,
    color: colors.neutral[600],
  },
  headline: {
    ...typography.bodyMd,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  date: {
    ...typography.labelSm,
    color: colors.neutral[400],
  },
  // Empty state
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl * 3,
  },
  emptyTitle: {
    ...typography.headingLg,
    color: colors.neutral[900],
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    lineHeight: 22,
  },
});
