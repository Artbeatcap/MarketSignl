import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { colors, typography, spacing, borderRadius } from '../../theme';

const LAST_UPDATED = 'January 21, 2026';

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Terms of Service</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.lastUpdated}>Last updated: {LAST_UPDATED}</Text>

        <Text style={styles.intro}>
          Welcome to ChartSignl. By accessing or using our mobile application and services,
          you agree to be bound by these Terms of Service. Please read them carefully.
        </Text>

        {/* Section 1 */}
        <Text style={styles.sectionTitle}>1. Acceptance of Terms</Text>
        <Text style={styles.paragraph}>
          By creating an account or using ChartSignl, you agree to these Terms of Service and
          our Privacy Policy. If you do not agree, please do not use our services.
        </Text>

        {/* Section 2 */}
        <Text style={styles.sectionTitle}>2. Description of Service</Text>
        <Text style={styles.paragraph}>
          ChartSignl provides Atlas AI-powered stock chart analysis tools to help identify support
          and resistance levels. Our service includes:
        </Text>
        <Text style={styles.bulletItem}>
          • Interactive stock and cryptocurrency charts
        </Text>
        <Text style={styles.bulletItem}>
          • Atlas AI-powered technical analysis
        </Text>
        <Text style={styles.bulletItem}>
          • Support and resistance level detection
        </Text>
        <Text style={styles.bulletItem}>
          • Chart history and analysis tracking
        </Text>
        <Text style={styles.bulletItem}>
          • Premium subscription features
        </Text>

        {/* Section 3 */}
        <Text style={styles.sectionTitle}>3. User Accounts</Text>
        <Text style={styles.paragraph}>
          You must create an account to use ChartSignl. You are responsible for:
        </Text>
        <Text style={styles.bulletItem}>
          • Maintaining the confidentiality of your account credentials
        </Text>
        <Text style={styles.bulletItem}>
          • All activities that occur under your account
        </Text>
        <Text style={styles.bulletItem}>
          • Notifying us immediately of any unauthorized use
        </Text>
        <Text style={styles.paragraph}>
          You must be at least 18 years old to use ChartSignl.
        </Text>

        {/* Section 4 */}
        <Text style={styles.sectionTitle}>4. Subscription and Billing</Text>
        <Text style={styles.paragraph}>
          ChartSignl offers both free and premium subscription tiers:
        </Text>
        <Text style={styles.bulletItem}>
          • Free tier: 3 analyses per week
        </Text>
        <Text style={styles.bulletItem}>
          • Premium tier: $4.99/month for unlimited analyses
        </Text>
        <Text style={styles.paragraph}>
          Premium subscriptions automatically renew unless canceled at least 24 hours before
          the end of the current billing period. You can manage or cancel your subscription
          through your Apple App Store or Google Play Store account settings.
        </Text>
        <Text style={styles.paragraph}>
          Refunds are handled according to Apple's and Google's refund policies. We do not
          provide refunds directly.
        </Text>

        {/* Section 5 */}
        <Text style={styles.sectionTitle}>5. Acceptable Use</Text>
        <Text style={styles.paragraph}>
          You agree not to:
        </Text>
        <Text style={styles.bulletItem}>
          • Use the service for any illegal purpose
        </Text>
        <Text style={styles.bulletItem}>
          • Attempt to reverse engineer or hack the application
        </Text>
        <Text style={styles.bulletItem}>
          • Share your account credentials with others
        </Text>
        <Text style={styles.bulletItem}>
          • Abuse or overload our systems through automated means
        </Text>
        <Text style={styles.bulletItem}>
          • Copy, modify, or redistribute our content without permission
        </Text>

        {/* Section 6 */}
        <Text style={styles.sectionTitle}>6. Intellectual Property</Text>
        <Text style={styles.paragraph}>
          All content, features, and functionality of ChartSignl are owned by us and are
          protected by copyright, trademark, and other intellectual property laws. You may
          not use our branding, logos, or content without our written permission.
        </Text>

        {/* Section 7 */}
        <Text style={styles.sectionTitle}>7. Disclaimer of Investment Advice</Text>
        <View style={styles.disclaimerBox}>
          <Text style={styles.disclaimerTitle}>IMPORTANT NOTICE</Text>
          <Text style={styles.disclaimerText}>
            ChartSignl provides educational and informational analysis tools only. We do not
            provide investment advice, financial advice, or trading recommendations. The analysis
            provided by Atlas is for informational purposes and should not be construed as
            professional investment advice.
          </Text>
          <Text style={[styles.disclaimerText, { marginTop: spacing.sm }]}>
            All investment and trading decisions are your sole responsibility. Past performance
            does not guarantee future results. You should consult with a qualified financial
            advisor before making any investment decisions.
          </Text>
        </View>

        {/* Section 8 */}
        <Text style={styles.sectionTitle}>8. Limitation of Liability</Text>
        <Text style={styles.paragraph}>
          To the maximum extent permitted by law, ChartSignl and its affiliates shall not be
          liable for any indirect, incidental, special, consequential, or punitive damages,
          including but not limited to trading losses, lost profits, or lost data.
        </Text>
        <Text style={styles.paragraph}>
          We provide our service "as is" without warranties of any kind, either express or
          implied. We do not guarantee that the service will be uninterrupted, secure, or
          error-free.
        </Text>

        {/* Section 9 */}
        <Text style={styles.sectionTitle}>9. Data Accuracy</Text>
        <Text style={styles.paragraph}>
          While we strive to provide accurate market data and analysis, we do not guarantee
          the accuracy, completeness, or timeliness of any information provided through
          ChartSignl. Market data is provided by third-party sources and may be delayed or
          inaccurate.
        </Text>

        {/* Section 10 */}
        <Text style={styles.sectionTitle}>10. Termination</Text>
        <Text style={styles.paragraph}>
          We reserve the right to suspend or terminate your account at any time for violation
          of these Terms or for any other reason at our sole discretion. You may also delete
          your account at any time through the app settings.
        </Text>

        {/* Section 11 */}
        <Text style={styles.sectionTitle}>11. Changes to Terms</Text>
        <Text style={styles.paragraph}>
          We may modify these Terms at any time. We will notify you of material changes via
          email or through the app. Your continued use of ChartSignl after such changes
          constitutes acceptance of the new Terms.
        </Text>

        {/* Section 12 */}
        <Text style={styles.sectionTitle}>12. Governing Law</Text>
        <Text style={styles.paragraph}>
          These Terms are governed by the laws of the United States. Any disputes shall be
          resolved in the courts of appropriate jurisdiction.
        </Text>

        {/* Section 13 */}
        <Text style={styles.sectionTitle}>13. Contact Us</Text>
        <Text style={styles.paragraph}>
          If you have any questions about these Terms of Service, please contact us:
        </Text>
        <View style={styles.contactBox}>
          <Text style={styles.contactText}>support@chartsignl.com</Text>
        </View>

        {/* Final Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={styles.disclaimerTitle}>Trading Risk Disclaimer</Text>
          <Text style={styles.disclaimerText}>
            Trading stocks, cryptocurrencies, and other financial instruments involves
            significant risk and may not be suitable for all investors. You should carefully
            consider your investment objectives, level of experience, and risk appetite before
            trading. The possibility exists that you could sustain a loss of some or all of
            your initial investment. You should only invest money that you can afford to lose.
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
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 4 : spacing.xxl * 2,
  },
  lastUpdated: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginBottom: spacing.md,
  },
  intro: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  paragraph: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    lineHeight: 24,
    marginBottom: spacing.sm,
  },
  bulletItem: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    lineHeight: 24,
    paddingLeft: spacing.sm,
  },
  contactBox: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  contactText: {
    ...typography.bodyMd,
    color: colors.primary[700],
    fontWeight: '500',
    textAlign: 'center',
  },
  disclaimerBox: {
    backgroundColor: colors.warning[50],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginVertical: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning[400],
  },
  disclaimer: {
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  disclaimerTitle: {
    ...typography.labelMd,
    color: colors.neutral[700],
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  disclaimerText: {
    ...typography.bodySm,
    color: colors.neutral[600],
    lineHeight: 20,
  },
});
