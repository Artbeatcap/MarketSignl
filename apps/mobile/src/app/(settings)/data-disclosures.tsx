import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MARKET_DATA_DELAY_MINUTES, MARKET_DATA_SOURCE } from '@chartsignl/core';
import { DataFreshnessBadge } from '../../components/DataFreshnessBadge';
import { DataFreshnessSheet } from '../../components/DataFreshnessSheet';
import { useMarketDataStore } from '../../store/marketDataStore';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { useState } from 'react';

const DISCLAIMER =
  'ChartSignl provides technical analysis for educational purposes. It is not investment advice, ' +
  'and no output should be treated as a recommendation to buy or sell any security. Trading involves risk of loss.';

export default function DataDisclosuresScreen() {
  const router = useRouter();
  const lastFreshness = useMarketDataStore((s) => s.lastFreshness);
  const [sheetOpen, setSheetOpen] = useState(false);

  const openPrivacy = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.href = '/privacy';
    } else {
      Linking.openURL('https://chartsignl.com/privacy');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Data & Disclosures</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.row}>
              <Text style={styles.label}>Data source</Text>
              <Text style={styles.value}>{MARKET_DATA_SOURCE}</Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Delay</Text>
              <Text style={styles.value}>
                At least {MARKET_DATA_DELAY_MINUTES} minutes for US equities, ETFs and indices
              </Text>
            </View>

            <View style={styles.row}>
              <Text style={styles.label}>Last update</Text>
              {lastFreshness ? (
                <DataFreshnessBadge freshness={lastFreshness} onPress={() => setSheetOpen(true)} />
              ) : (
                <Text style={styles.muted}>Open a chart to load a live timestamp.</Text>
              )}
            </View>

            <View style={styles.block}>
              <Text style={styles.blockTitle}>Not investment advice</Text>
              <Text style={styles.body}>{DISCLAIMER}</Text>
            </View>

            <TouchableOpacity style={styles.linkRow} onPress={() => router.push('/(settings)/terms')}>
              <Text style={styles.link}>Terms of Service</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.linkRow} onPress={openPrivacy}>
              <Text style={styles.link}>Privacy Policy</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>

      <DataFreshnessSheet
        freshness={lastFreshness}
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 800;

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh' as const, overflow: 'auto' }),
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  backButton: { minWidth: 72 },
  backText: { ...typography.bodyMd, color: colors.primary[600] },
  headerTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
    flex: 1,
    textAlign: 'center',
  },
  placeholder: { minWidth: 72 },
  scrollView: { flex: 1 },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
    gap: spacing.xs,
  },
  label: {
    ...typography.labelSm,
    color: colors.neutral[400],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  value: {
    ...typography.bodyMd,
    color: colors.neutral[800],
  },
  muted: {
    ...typography.bodySm,
    color: colors.neutral[400],
  },
  block: {
    marginTop: spacing.xl,
    marginBottom: spacing.lg,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  blockTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.bodySm,
    color: colors.neutral[700],
    lineHeight: 20,
  },
  linkRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  link: {
    ...typography.bodyMd,
    color: colors.primary[600],
  },
});
