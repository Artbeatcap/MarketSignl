import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Card } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
}

const FAQ_ITEMS: FAQItem[] = [
  {
    id: '1',
    question: 'Who is Atlas?',
    answer:
      'Atlas is your AI-powered chart analysis assistant. Named after the Greek Titan who held up the celestial heavens, Atlas helps you navigate charts and identify key support/resistance levels with confidence.',
  },
  {
    id: '2',
    question: 'How does Atlas analyze charts?',
    answer:
      'Atlas uses advanced technical analysis to identify confluence zones where multiple factors align - including EMAs, Fibonacci levels, volume profiles, and historical price action. This multi-factor approach helps Atlas find the most reliable trading levels.',
  },
  {
    id: '3',
    question: 'What symbols can I search for?',
    answer:
      'You can search for US stocks, ETFs, and major indices. Simply enter a ticker symbol (like AAPL, SPY, or QQQ) in the search bar to view charts and get Atlas analysis.',
  },
  {
    id: '4',
    question: 'How many free analyses do I get?',
    answer:
      'Free accounts include 3 Atlas analyses per week. After that, you can upgrade to Pro for unlimited analyses. Pro subscribers also get access to additional features like price alerts and advanced technical indicators.',
  },
  {
    id: '5',
    question: 'What timeframes are available?',
    answer:
      'ChartSignl supports multiple timeframes including 1-hour, 4-hour, daily, and weekly charts. Different timeframes are useful for different trading styles - day traders often use shorter timeframes, while swing traders prefer daily or weekly charts.',
  },
  {
    id: '6',
    question: 'How accurate is Atlas analysis?',
    answer:
      'Atlas identifies technical levels based on historical price action and multiple indicators. While no analysis is perfect, we use confluence scoring to highlight the strongest levels. Always combine Atlas analysis with your own research and risk management.',
  },
  {
    id: '7',
    question: 'Can I delete my analysis history?',
    answer:
      'Yes! Go to the History tab, swipe left on any analysis to delete it. You can also view past analyses by tapping on them.',
  },
  {
    id: '8',
    question: 'How do I change my trading style profile?',
    answer:
      'Tap on your Profile tab, then select "Edit Profile" to update your trading style, experience level, and display name. This helps us tailor the analysis to your trading approach.',
  },
];

export default function HelpScreen() {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpanded = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const handleContactSupport = () => {
    Linking.openURL('mailto:support@chartsignl.com?subject=ChartSignl Support Request');
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
            <Text style={styles.headerTitle}>Help & Support</Text>
            <View style={styles.placeholder} />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
        {/* FAQ Section */}
        <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>

        <Card style={styles.faqCard}>
          {FAQ_ITEMS.map((item, index) => (
            <TouchableOpacity
              key={item.id}
              style={[
                styles.faqItem,
                index < FAQ_ITEMS.length - 1 && styles.faqItemBorder,
              ]}
              onPress={() => toggleExpanded(item.id)}
              activeOpacity={0.7}
            >
              <View style={styles.faqHeader}>
                <Text style={styles.faqQuestion}>{item.question}</Text>
                <Text style={styles.faqArrow}>
                  {expandedId === item.id ? '−' : '+'}
                </Text>
              </View>
              {expandedId === item.id && (
                <Text style={styles.faqAnswer}>{item.answer}</Text>
              )}
            </TouchableOpacity>
          ))}
        </Card>

        {/* Contact Section */}
        <Text style={styles.sectionTitle}>Need More Help?</Text>

        <Card style={styles.contactCard}>
          <Text style={styles.contactEmoji}>📧</Text>
          <Text style={styles.contactTitle}>Contact Support</Text>
          <Text style={styles.contactDescription}>
            Can't find what you're looking for? Our team is here to help with any questions
            about ChartSignl.
          </Text>
          <TouchableOpacity style={styles.contactButton} onPress={handleContactSupport}>
            <Text style={styles.contactButtonText}>Email Support</Text>
          </TouchableOpacity>
        </Card>

        {/* Tips Section */}
        <View style={styles.tipsSection}>
          <Text style={styles.tipsTitle}>💡 Quick Tips</Text>
          <Text style={styles.tipItem}>
            • Use daily charts for swing trading setups
          </Text>
          <Text style={styles.tipItem}>
            • Higher confluence scores indicate stronger levels
          </Text>
          <Text style={styles.tipItem}>
            • Always set stop losses based on key levels
          </Text>
          <Text style={styles.tipItem}>
            • Review your analysis history to track your progress
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
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.xxl,
  },
  sectionTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.md,
  },
  // FAQ
  faqCard: {
    marginBottom: spacing.xl,
  },
  faqItem: {
    paddingVertical: spacing.md,
  },
  faqItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  faqHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  faqQuestion: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    fontWeight: '500',
    flex: 1,
  },
  faqArrow: {
    fontSize: 20,
    color: colors.primary[500],
    fontWeight: '600',
  },
  faqAnswer: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  // Contact
  contactCard: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    marginBottom: spacing.xl,
  },
  contactEmoji: {
    fontSize: 40,
    marginBottom: spacing.sm,
  },
  contactTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  contactDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textAlign: 'center',
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  contactButton: {
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.lg,
  },
  contactButtonText: {
    ...typography.labelMd,
    color: '#fff',
    fontWeight: '600',
  },
  // Tips
  tipsSection: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  tipsTitle: {
    ...typography.labelMd,
    color: colors.primary[700],
    marginBottom: spacing.sm,
  },
  tipItem: {
    ...typography.bodySm,
    color: colors.primary[800],
    lineHeight: 22,
  },
});

