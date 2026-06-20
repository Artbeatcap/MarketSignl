import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  PanResponder,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../../components/Card';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { formatPrice } from '../../lib/marketData';
import type { PriceAlert } from '../../hooks/useAlerts';
import {
  useActiveAlerts,
  useAllAlerts,
  useDeleteAlert,
} from '../../hooks/useAlerts';

type AlertSegment = 'active' | 'triggered' | 'all';

function formatTimeRemaining(expiresAt: string): string {
  const expiresMs = new Date(expiresAt).getTime();
  const diffMs = expiresMs - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'Expired';

  const minutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(diffMs / 86400000);

  if (days > 0) {
    const remainingHours = Math.floor((diffMs % 86400000) / 3600000);
    return `${days}d ${remainingHours}h`;
  }
  if (hours > 0) {
    const remainingMinutes = Math.floor((diffMs % 3600000) / 60000);
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

function directionArrow(direction: PriceAlert['direction']): string {
  switch (direction) {
    case 'crosses_below':
      return '↓';
    case 'crosses_above':
      return '↑';
    default:
      return '↔';
  }
}

function typeBadgeColors(level_type: PriceAlert['level_type']) {
  if (level_type === 'support') {
    return {
      bg: colors.green[50],
      fg: colors.success,
      border: colors.green[200],
    };
  }
  return {
    bg: colors.red[50],
    fg: colors.resistance.strong,
    border: colors.red[200],
  };
}

function strengthPillColors(
  level_type: PriceAlert['level_type'],
  level_strength: PriceAlert['level_strength']
) {
  const strength = level_strength ?? 'weak';
  const palette = level_type === 'support' ? colors.support : colors.resistance;

  const color =
    strength === 'strong'
      ? palette.strong
      : strength === 'medium'
        ? palette.medium
        : palette.weak;

  return {
    bg: `${color}22`,
    fg: color,
    border: `${color}44`,
  };
}

function AlertCardContent({
  alert,
}: {
  alert: PriceAlert;
}) {
  const badge = typeBadgeColors(alert.level_type);
  const strengthColors = strengthPillColors(
    alert.level_type,
    alert.level_strength
  );

  return (
    <View style={styles.alertCardInner}>
      <View style={styles.alertTopRow}>
        <Text style={styles.symbolText}>{alert.symbol}</Text>
        <View
          style={[
            styles.typeBadge,
            { backgroundColor: badge.bg, borderColor: badge.border },
          ]}
        >
          <Text style={[styles.typeBadgeText, { color: badge.fg }]}>
            {alert.level_type === 'support' ? 'Support' : 'Resistance'}
          </Text>
        </View>
      </View>

      <View style={styles.priceRow}>
        <Text style={styles.levelPrice}>${formatPrice(alert.level_price)}</Text>
        <View style={[styles.directionPill, { borderColor: badge.border }]}>
          <Text style={[styles.directionPillText, { color: badge.fg }]}>
            {directionArrow(alert.direction)}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View
          style={[
            styles.strengthPill,
            { backgroundColor: strengthColors.bg, borderColor: strengthColors.border },
          ]}
        >
          <Text style={[styles.strengthPillText, { color: strengthColors.fg }]}>
            {alert.level_strength ?? 'weak'}
          </Text>
        </View>

        <Text style={styles.expiryText}>
          Expires in {formatTimeRemaining(alert.expires_at)}
        </Text>
      </View>
    </View>
  );
}

function SwipeToDeleteRow({
  alert,
  onDelete,
  disabled,
}: {
  alert: PriceAlert;
  onDelete: () => void;
  disabled: boolean;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const deleteThreshold = -80;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => {
        if (disabledRef.current) return false;
        return Math.abs(gesture.dx) > Math.abs(gesture.dy) && gesture.dx < -8;
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.max(deleteThreshold, gesture.dx);
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        if (disabledRef.current) return;

        const shouldDelete = gesture.dx <= deleteThreshold;
        if (shouldDelete) {
          Animated.timing(translateX, {
            toValue: deleteThreshold,
            duration: 120,
            useNativeDriver: false,
          }).start(() => {
            onDelete();
            Animated.timing(translateX, {
              toValue: 0,
              duration: 200,
              useNativeDriver: false,
            }).start();
          });
        } else {
          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: false,
            bounciness: 0,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.swipeContainer}>
      <View style={styles.deleteBg} pointerEvents="none">
        <Ionicons name="trash-outline" size={20} color={colors.red[500]} />
      </View>

      <Animated.View style={[styles.swipeAnimated, { transform: [{ translateX }] }]} {...panResponder.panHandlers}>
        <Card style={styles.alertCard} elevated={true} padding="md">
          <AlertCardContent alert={alert} />
        </Card>
      </Animated.View>
    </View>
  );
}

export default function AlertsScreen() {
  const [segment, setSegment] = useState<AlertSegment>('active');

  const activeQuery = useActiveAlerts();
  const allQuery = useAllAlerts();
  const deleteAlert = useDeleteAlert();

  const { alerts, isLoading } = useMemo(() => {
    const active = activeQuery.data ?? [];
    const all = allQuery.data ?? [];

    if (segment === 'active') return { alerts: active, isLoading: activeQuery.isLoading };

    if (segment === 'triggered') {
      const triggered = all.filter((a) => a.status === 'triggered');
      return { alerts: triggered, isLoading: allQuery.isLoading };
    }

    return { alerts: all, isLoading: allQuery.isLoading };
  }, [
    segment,
    activeQuery.data,
    activeQuery.isLoading,
    allQuery.data,
    allQuery.isLoading,
  ]);

  const onRefresh = () => {
    if (segment === 'active') return activeQuery.refetch();
    return allQuery.refetch();
  };

  const listEmpty = !isLoading && alerts.length === 0;

  const renderItem = ({ item }: { item: PriceAlert }) => {
    if (segment === 'active') {
      return (
        <SwipeToDeleteRow
          alert={item}
          disabled={deleteAlert.isPending}
          onDelete={() => deleteAlert.mutate(item.id)}
        />
      );
    }

    return (
      <Card style={styles.alertCard} elevated={true} padding="md">
        <AlertCardContent alert={item} />
      </Card>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons
                name="notifications-outline"
                size={22}
                color={colors.primary[500]}
              />
              <Text style={styles.headerTitle}>Price Alerts</Text>
            </View>
            <Text style={styles.headerSubtitle}>
              {alerts.length} {alerts.length === 1 ? 'alert' : 'alerts'}
            </Text>
          </View>

          <View style={styles.segmentRow}>
            <SegmentButton
              active={segment === 'active'}
              label="Active"
              onPress={() => setSegment('active')}
            />
            <SegmentButton
              active={segment === 'triggered'}
              label="Triggered"
              onPress={() => setSegment('triggered')}
            />
            <SegmentButton
              active={segment === 'all'}
              label="All"
              onPress={() => setSegment('all')}
            />
          </View>

          <FlatList
            data={alerts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              listEmpty ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyTitle}>No active alerts yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Analyze a stock and Atlas will watch your key levels
                  </Text>
                </View>
              ) : null
            }
            refreshControl={
              <RefreshControl
                refreshing={activeQuery.isFetching || allQuery.isFetching}
                onRefresh={onRefresh}
                tintColor={colors.primary[500]}
              />
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.segmentButton,
        active && { backgroundColor: colors.primary[500], borderColor: colors.primary[500] },
      ]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <Text
        style={[
          styles.segmentButtonText,
          active && { color: colors.white },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh', overflow: 'auto' }),
    backgroundColor: colors.neutral[50],
  },
  webWrapper: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { alignItems: 'center', backgroundColor: colors.neutral[50] }),
  },
  webInner: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    width: '100%',
    maxWidth: 1100,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },

  header: {
    paddingBottom: spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerTitle: {
    ...typography.headingLg,
    color: colors.neutral[900],
  },
  headerSubtitle: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },

  segmentRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },

  segmentButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  segmentButtonText: {
    ...typography.labelMd,
    color: colors.neutral[600],
    fontWeight: '600',
  },

  listContent: {
    paddingBottom: spacing.xxl,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  emptySubtitle: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    textAlign: 'center',
    lineHeight: 22,
  },

  swipeContainer: {
    marginBottom: spacing.sm,
  },
  deleteBg: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: spacing.md,
    backgroundColor: colors.red[50],
    borderRadius: borderRadius.xl,
  },
  swipeAnimated: {
    left: 0,
    right: 0,
  },

  alertCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
  },
  alertCardInner: {},
  alertTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  symbolText: {
    ...typography.headingSm,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  typeBadgeText: {
    ...typography.labelSm,
    fontWeight: '700',
  },

  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  levelPrice: {
    ...typography.headingSm,
    color: colors.neutral[900],
    fontWeight: '700',
  },

  directionPill: {
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  directionPillText: {
    ...typography.labelSm,
    fontWeight: '800',
  },

  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },

  strengthPill: {
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  strengthPillText: {
    ...typography.labelSm,
    fontWeight: '700',
    textTransform: 'capitalize',
  },

  expiryText: {
    ...typography.bodySm,
    color: colors.neutral[600],
    flex: 1,
    textAlign: 'right',
  },
});

