import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, ProgressIndicator } from '../../components';
import { useOnboardingStore } from '../../store/onboardingStore';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { STRESS_REDUCER_OPTIONS } from '@chartsignl/core';

export default function StressReducerScreen() {
  const router = useRouter();
  const { answers, setStressReducer } = useOnboardingStore();

  const handleContinue = () => {
    router.push('/(onboarding)/account');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={styles.backButton}>←</Text>
            </TouchableOpacity>
            <ProgressIndicator current={3} total={4} />
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>What would help you trade with less stress?</Text>
          <Text style={styles.subtitle}>
            Pick what matters most to you.
          </Text>
        </View>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {STRESS_REDUCER_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.optionCard,
                answers.stressReducer === option.value && styles.optionCardSelected,
              ]}
              onPress={() => setStressReducer(option.value)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionEmoji}>{option.emoji}</Text>
              <Text
                style={[
                  styles.optionLabel,
                  answers.stressReducer === option.value && styles.optionLabelSelected,
                ]}
              >
                {option.label}
              </Text>
              {answers.stressReducer === option.value && (
                <View style={styles.checkmark}>
                  <Text style={styles.checkmarkText}>✓</Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
          </ScrollView>

          {/* Bottom CTA */}
          <View style={styles.bottomSection}>
            <Button
              title="Almost done"
              onPress={handleContinue}
              size="lg"
              fullWidth
              disabled={!answers.stressReducer}
            />
            <TouchableOpacity onPress={handleContinue}>
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const WEB_MAX_WIDTH = 800;

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  backButton: {
    fontSize: 24,
    color: colors.neutral[600],
    width: 40,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.xl,
  },
  titleSection: {
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.displaySm,
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodyLg,
    color: colors.neutral[500],
  },
  optionsContainer: {
    gap: spacing.md,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.neutral[200],
    ...shadows.sm,
  },
  optionCardSelected: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  optionEmoji: {
    fontSize: 28,
    marginRight: spacing.md,
  },
  optionLabel: {
    ...typography.labelLg,
    color: colors.neutral[900],
    flex: 1,
  },
  optionLabelSelected: {
    color: colors.primary[700],
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkmarkText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  bottomSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.md,
    alignItems: 'center',
  },
  skipText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
  },
});


