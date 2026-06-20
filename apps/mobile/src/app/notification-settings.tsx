import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';

import { Card, Button } from '../components';
import { colors, typography, spacing, borderRadius } from '../theme';
import { formatPrice } from '../lib/marketData';
import { getCurrentUser, updateNotificationPreferences } from '../lib/api';
import { useActiveAlerts, useAllAlerts, useDeleteAlert, useToggleAlert } from '../hooks/useAlerts';

export default function NotificationSettingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: getCurrentUser,
  });
  const activeAlertsQuery = useActiveAlerts();
  const allAlertsQuery = useAllAlerts();
  const deleteAlertMutation = useDeleteAlert();
  const toggleAlertMutation = useToggleAlert();

  const activeAlerts = activeAlertsQuery.data ?? [];
  const manageAlerts = useMemo(() => {
    const all = (allAlertsQuery.data ?? []) as Array<{
      status?: string;
    }>;
    return (allAlertsQuery.data ?? []).filter(
      (a) => a.status === 'active' || a.status === 'disabled'
    );
  }, [allAlertsQuery.data]);

  const [pushEnabled, setPushEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [savingKey, setSavingKey] = useState<'push' | 'sound' | null>(null);
  const [isClearingAll, setIsClearingAll] = useState(false);
  const [pendingAlertId, setPendingAlertId] = useState<string | null>(null);

  useEffect(() => {
    const user = profileData?.user;
    if (!user) return;

    setPushEnabled(user.pushNotificationsEnabled ?? true);
    setSoundEnabled(user.alertSoundEnabled ?? true);
  }, [profileData]);

  const isBusy = useMemo(
    () =>
      savingKey !== null ||
      isClearingAll ||
      deleteAlertMutation.isPending ||
      toggleAlertMutation.isPending,
    [savingKey, isClearingAll, deleteAlertMutation.isPending, toggleAlertMutation.isPending]
  );

  const handleBack = () => {
    router.replace('/(tabs)/profile');
  };

  const handleTogglePush = async (nextValue: boolean) => {
    const previous = pushEnabled;
    setPushEnabled(nextValue);
    setSavingKey('push');
    try {
      await updateNotificationPreferences({ pushEnabled: nextValue });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch (error) {
      setPushEnabled(previous);
      Alert.alert('Update Failed', 'Could not update push notification preference.');
    } finally {
      setSavingKey(null);
    }
  };

  const handleToggleSound = async (nextValue: boolean) => {
    const previous = soundEnabled;
    setSoundEnabled(nextValue);
    setSavingKey('sound');
    try {
      await updateNotificationPreferences({ soundEnabled: nextValue });
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
    } catch (error) {
      setSoundEnabled(previous);
      Alert.alert('Update Failed', 'Could not update alert sound preference.');
    } finally {
      setSavingKey(null);
    }
  };

  const clearAllAlerts = async () => {
    if (activeAlerts.length === 0) {
      Alert.alert('No Alerts', 'You have no active alerts to clear.');
      return;
    }

    setIsClearingAll(true);
    try {
      for (const alert of activeAlerts) {
        await deleteAlertMutation.mutateAsync(alert.id);
      }
      await activeAlertsQuery.refetch();
      await allAlertsQuery.refetch();
      Alert.alert('Alerts Cleared', `Removed ${activeAlerts.length} active alerts.`);
    } catch (error) {
      Alert.alert('Clear Failed', 'Unable to clear all alerts. Please try again.');
    } finally {
      setIsClearingAll(false);
    }
  };

  const handleConfirmClearAll = () => {
    if (Platform.OS === 'web') {
      const confirmed = window.confirm('Clear all active alerts? This cannot be undone.');
      if (confirmed) {
        clearAllAlerts();
      }
      return;
    }

    Alert.alert(
      'Clear All Alerts',
      'This will remove all active alerts. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear All', style: 'destructive', onPress: clearAllAlerts },
      ]
    );
  };

  const typeBadgeColors = (levelType: 'support' | 'resistance') => {
    if (levelType === 'support') {
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
  };

  const handleToggleAlertStatus = async (alertId: string, nextEnabled: boolean) => {
    setPendingAlertId(alertId);
    try {
      await toggleAlertMutation.mutateAsync({
        alertId,
        status: nextEnabled ? 'active' : 'disabled',
      });
      await Promise.all([activeAlertsQuery.refetch(), allAlertsQuery.refetch()]);
    } catch (error) {
      Alert.alert('Update Failed', 'Could not update alert status.');
    } finally {
      setPendingAlertId(null);
    }
  };

  const handleDeleteAlert = async (alertId: string) => {
    setPendingAlertId(alertId);
    try {
      await deleteAlertMutation.mutateAsync(alertId);
      await Promise.all([activeAlertsQuery.refetch(), allAlertsQuery.refetch()]);
    } catch (error) {
      Alert.alert('Delete Failed', 'Could not delete alert.');
    } finally {
      setPendingAlertId(null);
    }
  };

  if (isLoadingProfile) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[500]} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleBack} style={styles.backButton}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Notification Settings</Text>
            <View style={styles.headerPlaceholder} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Card style={styles.sectionCard}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Push Notifications</Text>
                </View>
                <Switch
                  value={pushEnabled}
                  onValueChange={handleTogglePush}
                  disabled={isBusy}
                  trackColor={{ false: colors.neutral[200], true: colors.primary[200] }}
                  thumbColor={pushEnabled ? colors.primary[500] : colors.neutral[400]}
                  ios_backgroundColor={colors.neutral[200]}
                />
              </View>

              {!pushEnabled && (
                <Text style={styles.mutedNote}>
                  You won&apos;t receive alerts when key levels are crossed.
                </Text>
              )}

              <View style={styles.rowDivider} />

              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Alert Sound</Text>
                </View>
                <Switch
                  value={soundEnabled}
                  onValueChange={handleToggleSound}
                  disabled={isBusy}
                  trackColor={{ false: colors.neutral[200], true: colors.primary[200] }}
                  thumbColor={soundEnabled ? colors.primary[500] : colors.neutral[400]}
                  ios_backgroundColor={colors.neutral[200]}
                />
              </View>
            </Card>

            <Card style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Manage Alerts</Text>
              {manageAlerts.length === 0 ? (
                <Text style={styles.emptyInlineText}>No active alerts</Text>
              ) : (
                manageAlerts.map((alert, index) => {
                  const badge = typeBadgeColors(alert.level_type);
                  const rowBusy = pendingAlertId === alert.id || isBusy;
                  const isDisabled = alert.status === 'disabled';
                  return (
                    <View
                      key={alert.id}
                      style={[
                        styles.inlineAlertRow,
                        isDisabled && styles.inlineAlertRowDisabled,
                        index < manageAlerts.length - 1 && styles.inlineAlertRowBorder,
                      ]}
                    >
                      <View style={styles.inlineAlertLeft}>
                        <Text style={styles.inlineAlertSymbol}>{alert.symbol}</Text>
                        <Text style={styles.inlineAlertPrice}>${formatPrice(alert.level_price)}</Text>
                      </View>

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

                      <View style={styles.inlineAlertActions}>
                        <Switch
                          value={!isDisabled}
                          onValueChange={(next) => handleToggleAlertStatus(alert.id, next)}
                          disabled={rowBusy}
                          trackColor={{ false: colors.neutral[200], true: colors.primary[200] }}
                          thumbColor={isDisabled ? colors.neutral[400] : colors.primary[500]}
                          ios_backgroundColor={colors.neutral[200]}
                        />
                        <TouchableOpacity
                          style={styles.deleteIconButton}
                          onPress={() => handleDeleteAlert(alert.id)}
                          disabled={rowBusy}
                        >
                          <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </Card>

            <Card style={styles.sectionCard}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => router.push('/(tabs)/alerts')}
                disabled={isBusy}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>View All Alerts</Text>
                </View>
                <View style={styles.countRight}>
                  <Text style={styles.countText}>{activeAlerts.length}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.neutral[400]} />
                </View>
              </TouchableOpacity>
            </Card>

            <Button
              title={isClearingAll ? 'Clearing Alerts...' : 'Clear All Alerts'}
              onPress={handleConfirmClearAll}
              variant="outline"
              size="lg"
              fullWidth
              disabled={isBusy || activeAlerts.length === 0}
              style={styles.clearButton}
            />
          </ScrollView>
        </View>
      </View>
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 900;

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh', overflow: 'auto' }),
    backgroundColor: colors.background,
  },
  webWrapper: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { alignItems: 'center' }),
  },
  webInner: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    width: '100%',
    ...(Platform.OS === 'web' && { maxWidth: WEB_MAX_WIDTH }),
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  backButton: {
    minWidth: 60,
  },
  backText: {
    ...typography.bodyMd,
    color: colors.neutral[600],
  },
  headerTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  headerPlaceholder: {
    minWidth: 60,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.xxl,
    gap: spacing.md,
  },
  sectionCard: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  emptyInlineText: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  inlineAlertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  inlineAlertRowDisabled: {
    opacity: 0.5,
  },
  inlineAlertRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  inlineAlertLeft: {
    flex: 1,
  },
  inlineAlertSymbol: {
    ...typography.bodyMd,
    color: colors.neutral[900],
    fontWeight: '700',
  },
  inlineAlertPrice: {
    ...typography.bodySm,
    color: colors.neutral[600],
  },
  inlineAlertActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  deleteIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red[50],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    fontWeight: '500',
  },
  rowDivider: {
    height: 1,
    backgroundColor: colors.neutral[100],
    marginVertical: spacing.md,
  },
  mutedNote: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginTop: spacing.sm,
  },
  countRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  countText: {
    ...typography.labelMd,
    color: colors.neutral[600],
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
  clearButton: {
    marginTop: spacing.sm,
    borderColor: colors.red[300],
  },
});
