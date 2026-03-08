import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button, ProgressIndicator } from '../../components';
import { useOnboardingStore } from '../../store/onboardingStore';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { EXPERIENCE_LEVEL_OPTIONS } from '@chartsignl/core';

export default function ExperienceScreen() {
  const router = useRouter();
  const { answers, setExperienceLevel } = useOnboardingStore();

  const handleContinue = () => {
    router.push('/(onboarding)/stress-reducer');
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
            <ProgressIndicator current={2} total={4} />
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>How familiar are you with technical analysis?</Text>
          <Text style={styles.subtitle}>
            We'll adjust our explanations to match your level.
          </Text>
        </View>

        {/* Options */}
        <View style={styles.optionsContainer}>
          {EXPERIENCE_LEVEL_OPTIONS.map((level) => (
            <TouchableOpacity
              key={level.value}
              style={[
                styles.optionCard,
                answers.experienceLevel === level.value && styles.optionCardSelected,
              ]}
              onPress={() => setExperienceLevel(level.value)}
              activeOpacity={0.7}
            >
              <Text style={styles.optionEmoji}>{level.emoji}</Text>
              <View style={styles.optionContent}>
                <Text
                  style={[
                    styles.optionLabel,
                    answers.experienceLevel === level.value && styles.optionLabelSelected,
                  ]}
                >
                  {level.label}
                </Text>
                <Text style={styles.optionDescription}>{level.description}</Text>
              </View>
              {answers.experienceLevel === level.value && (
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
              title="Continue"
              onPress={handleContinue}
              size="lg"
              fullWidth
              disabled={!answers.experienceLevel}
            />
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
    fontSize: 32,
    marginRight: spacing.md,
  },
  optionContent: {
    flex: 1,
  },
  optionLabel: {
    ...typography.labelLg,
    color: colors.neutral[900],
    marginBottom: 2,
  },
  optionLabelSelected: {
    color: colors.primary[700],
  },
  optionDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
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
  },
});


