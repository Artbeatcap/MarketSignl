import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface NotificationSetting {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
}

export default function NotificationsScreen() {
  const router = useRouter();

  // These are placeholder settings - will be stored locally or synced when push notifications are implemented
  const [settings, setSettings] = useState<NotificationSetting[]>([
    {
      id: 'analysis_complete',
      title: 'Analysis Complete',
      description: 'Get notified when your chart analysis finishes processing',
      enabled: true,
    },
    {
      id: 'key_levels',
      title: 'Key Level Alerts',
      description: 'Alerts when price approaches your identified support or resistance levels',
      enabled: false,
    },
    {
      id: 'weekly_insights',
      title: 'Weekly Insights',
      description: 'Summary of your trading analysis patterns and activity',
      enabled: true,
    },
  ]);

  const toggleSetting = (id: string) => {
    setSettings((prev) =>
      prev.map((setting) =>
        setting.id === id ? { ...setting, enabled: !setting.enabled } : setting
      )
    );
    
    // Show coming soon message since push notifications aren't implemented
    Alert.alert(
      'Coming Soon',
      'Push notifications are not yet available. Your preference has been saved and will be applied when notifications launch.',
      [{ text: 'OK' }]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Notifications</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Info Banner */}
        <View style={styles.infoBanner}>
          <Text style={styles.infoEmoji}>🔔</Text>
          <Text style={styles.infoText}>
            Push notifications are coming soon! Configure your preferences below and they'll be
            applied when the feature launches.
          </Text>
        </View>

        {/* Notification Settings */}
        <Card style={styles.settingsCard}>
          {settings.map((setting, index) => (
            <View
              key={setting.id}
              style={[
                styles.settingItem,
                index < settings.length - 1 && styles.settingItemBorder,
              ]}
            >
              <View style={styles.settingContent}>
                <Text style={styles.settingTitle}>{setting.title}</Text>
                <Text style={styles.settingDescription}>{setting.description}</Text>
              </View>
              <Switch
                value={setting.enabled}
                onValueChange={() => toggleSetting(setting.id)}
                trackColor={{
                  false: colors.neutral[200],
                  true: colors.primary[200],
                }}
                thumbColor={setting.enabled ? colors.primary[500] : colors.neutral[400]}
                ios_backgroundColor={colors.neutral[200]}
              />
            </View>
          ))}
        </Card>

        {/* Additional Info */}
        <View style={styles.additionalInfo}>
          <Text style={styles.additionalTitle}>About Notifications</Text>
          <Text style={styles.additionalText}>
            ChartSignl notifications help you stay on top of your trading analysis without
            constantly checking the app. You can change these settings at any time.
          </Text>
          <Text style={styles.additionalText}>
            Note: To receive notifications, make sure notifications are enabled for ChartSignl
            in your device settings.
          </Text>
        </View>
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
  // Header
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
    color: colors.primary[600],
  },
  headerTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  placeholder: {
    minWidth: 60,
  },
  // Content
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.lg,
  },
  // Info Banner
  infoBanner: {
    flexDirection: 'row',
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  infoEmoji: {
    fontSize: 20,
  },
  infoText: {
    ...typography.bodySm,
    color: colors.primary[700],
    flex: 1,
    lineHeight: 20,
  },
  // Settings Card
  settingsCard: {
    marginBottom: spacing.lg,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  settingItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  settingContent: {
    flex: 1,
  },
  settingTitle: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    fontWeight: '500',
    marginBottom: 2,
  },
  settingDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
    lineHeight: 18,
  },
  // Additional Info
  additionalInfo: {
    paddingHorizontal: spacing.sm,
  },
  additionalTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  additionalText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
});




