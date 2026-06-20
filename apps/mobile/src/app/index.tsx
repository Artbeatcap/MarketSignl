import { View, Text, StyleSheet, ActivityIndicator, Image, Platform } from 'react-native';
import { colors, typography } from '../theme';

export default function IndexScreen() {
  // Root layout handles all navigation logic
  // This screen just shows branding while that happens
  
  return (
    <View style={styles.container}>
      <View style={styles.webWrapper}>
        <View style={styles.webInner}>
          {/* Soft gradient background */}
          <View style={styles.gradientTop} />
          
          {/* Logo/Brand */}
          <View style={styles.content}>
            <View style={styles.logoContainer}>
              <Image
                source={require('../../assets/logo.png')}
                style={styles.logoImage}
                resizeMode="contain"
              />
            </View>
            <Text style={styles.logo}>ChartSignl</Text>
            <Text style={styles.tagline}>See the levels clearly</Text>
          </View>

          {/* Loading indicator */}
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary[500]} />
          </View>
        </View>
      </View>
    </View>
  );
}

const WEB_MAX_WIDTH = 600;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webWrapper: {
    flex: 1,
    width: '100%',
    ...(Platform.OS === 'web' && { alignItems: 'center' }),
  },
  webInner: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' && { maxWidth: WEB_MAX_WIDTH }),
  },
  gradientTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '50%',
    backgroundColor: colors.primary[50],
    opacity: 0.5,
  },
  content: {
    alignItems: 'center',
  },
  logoContainer: {
    marginBottom: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 100,
    height: 100,
  },
  logo: {
    ...typography.displayLg,
    color: colors.primary[600],
    marginBottom: 8,
  },
  tagline: {
    ...typography.bodyLg,
    color: colors.neutral[500],
  },
  loadingContainer: {
    position: 'absolute',
    bottom: 100,
  },
});
