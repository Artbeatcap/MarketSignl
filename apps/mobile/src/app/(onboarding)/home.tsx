import { View, Text, StyleSheet, Image, Platform, ScrollView, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Button } from '../../components';
import { colors, typography, spacing } from '../../theme';

export default function HomeScreen() {
  const router = useRouter();

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
          {/* Decorative gradient */}
          <View style={styles.gradientTop} />

          {Platform.OS === 'web' ? (
            <>
              <View style={styles.content}>
                {/* Hero section */}
                <View style={styles.heroSection}>
                  <Text style={styles.brandName}>ChartSignl</Text>
                  <View style={styles.logoContainer}>
                    <Image
                      source={require('../../../assets/logo.png')}
                      style={styles.logo}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.title}>Levels shouldn't{'\n'}feel like guesswork</Text>
                  <Text style={styles.subtitle}>
                    Search any stock. Get the key levels instantly. 
                    Trade with more clarity and less stress.
                  </Text>
                </View>

                {/* Features */}
                <View style={styles.features}>
                  <FeatureItem
                    emoji="🗺️"
                    text="Atlas AI-powered level detection"
                  />
                  <FeatureItem
                    emoji="🎯"
                    text="Support & resistance in seconds"
                  />
                  <FeatureItem
                    emoji="🧘"
                    text="Calm, focused trading"
                  />
                </View>
              </View>

              {/* Bottom CTA */}
              <View style={styles.bottomSection}>
                <Button
                  title="Get Started"
                  onPress={() => router.push('/(onboarding)/style')}
                  size="lg"
                  fullWidth
                />
                <Text style={styles.alreadyText}>
                  Already have an account?{' '}
                  <Text
                    style={styles.signInLink}
                    onPress={() => router.push('/(onboarding)/account')}
                  >
                    Sign in
                  </Text>
                </Text>
                <Text style={styles.privacyText}>
                  By continuing, you agree to our{' '}
                  <Text style={styles.privacyLink} onPress={openPrivacy}>
                    Privacy Policy
                  </Text>
                </Text>
              </View>
            </>
          ) : (
            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={true}
            >
              <View style={styles.content}>
                {/* Hero section */}
                <View style={styles.heroSection}>
                  <Text style={styles.brandName}>ChartSignl</Text>
                  <View style={styles.logoContainer}>
                    <Image
                      source={require('../../../assets/logo.png')}
                      style={styles.logo}
                      resizeMode="contain"
                    />
                  </View>
                  <Text style={styles.title}>Levels shouldn't{'\n'}feel like guesswork</Text>
                  <Text style={styles.subtitle}>
                    Search any stock. Get the key levels instantly. 
                    Trade with more clarity and less stress.
                  </Text>
                </View>

                {/* Features */}
                <View style={styles.features}>
                  <FeatureItem
                    emoji="🗺️"
                    text="Atlas AI-powered level detection"
                  />
                  <FeatureItem
                    emoji="🎯"
                    text="Support & resistance in seconds"
                  />
                  <FeatureItem
                    emoji="🧘"
                    text="Calm, focused trading"
                  />
                </View>
              </View>

              {/* Bottom CTA */}
              <View style={styles.bottomSection}>
                <Button
                  title="Get Started"
                  onPress={() => router.push('/(onboarding)/style')}
                  size="lg"
                  fullWidth
                />
                <Text style={styles.alreadyText}>
                  Already have an account?{' '}
                  <Text
                    style={styles.signInLink}
                    onPress={() => router.push('/(onboarding)/account')}
                  >
                    Sign in
                  </Text>
                </Text>
                <Text style={styles.privacyText}>
                  By continuing, you agree to our{' '}
                  <Text style={styles.privacyLink} onPress={openPrivacy}>
                    Privacy Policy
                  </Text>
                </Text>
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ emoji, text }: { emoji: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureEmoji}>{emoji}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
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
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '40%',
    backgroundColor: colors.primary[50],
    opacity: 0.6,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  heroSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  brandName: {
    ...typography.displaySm,
    color: colors.primary[600],
    fontWeight: '700',
    marginBottom: spacing.md,
    letterSpacing: -0.5,
  },
  logoContainer: {
    marginBottom: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 120,
    height: 120,
  },
  title: {
    ...typography.displayMd,
    color: colors.neutral[900],
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  subtitle: {
    ...typography.bodyLg,
    color: colors.neutral[600],
    textAlign: 'center',
    lineHeight: 28,
    paddingHorizontal: spacing.md,
  },
  features: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: 16,
  },
  featureEmoji: {
    fontSize: 24,
    marginRight: spacing.md,
  },
  featureText: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    flex: 1,
  },
  bottomSection: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  alreadyText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    textAlign: 'center',
  },
  signInLink: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  privacyText: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  privacyLink: {
    color: colors.primary[600],
    fontWeight: '600',
  },
});
