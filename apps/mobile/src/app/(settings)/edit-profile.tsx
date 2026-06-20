import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getCurrentUser, updateProfile } from '../../lib/api';
import { colors, typography, spacing, borderRadius } from '../../theme';
import {
  TRADING_STYLE_OPTIONS,
  EXPERIENCE_LEVEL_OPTIONS,
  type TradingStyle,
  type ExperienceLevel,
} from '@chartsignl/core';

export default function EditProfileScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: profileData, isLoading: isLoadingProfile } = useQuery({
    queryKey: ['profile'],
    queryFn: getCurrentUser,
  });

  const [displayName, setDisplayName] = useState('');
  const [tradingStyle, setTradingStyle] = useState<TradingStyle | null>(null);
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Initialize form with current profile data
  useEffect(() => {
    if (profileData?.user) {
      setDisplayName(profileData.user.displayName || '');
      setTradingStyle(profileData.user.tradingStyle || null);
      setExperienceLevel(profileData.user.experienceLevel || null);
    }
  }, [profileData]);

  const handleSave = async () => {
    if (!displayName.trim()) {
      Alert.alert('Error', 'Please enter a display name');
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        display_name: displayName.trim(),
        trading_style: tradingStyle,
        experience_level: experienceLevel,
      });

      // Invalidate profile query to refetch updated data
      await queryClient.invalidateQueries({ queryKey: ['profile'] });

      // Navigate back to profile page - do this immediately for web compatibility
      // Alert button callbacks don't work reliably on web
      router.replace('/(tabs)/profile');
    } catch (error) {
      console.error('Failed to update profile:', error);
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setIsSaving(false);
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
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.closeButton}>
              <Text style={styles.closeText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Edit Profile</Text>
            <TouchableOpacity
              onPress={handleSave}
              disabled={isSaving}
              style={styles.saveButton}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color={colors.primary[500]} />
              ) : (
                <Text style={styles.saveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Display Name */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Display Name</Text>
          <TextInput
            style={styles.input}
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="Enter your name"
            placeholderTextColor={colors.neutral[400]}
            autoCapitalize="words"
          />
        </View>

        {/* Trading Style */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trading Style</Text>
          <Text style={styles.sectionSubtitle}>
            How do you typically approach the markets?
          </Text>
          <View style={styles.optionsGrid}>
            {TRADING_STYLE_OPTIONS.map((style) => (
              <TouchableOpacity
                key={style.value}
                style={[
                  styles.optionChip,
                  tradingStyle === style.value && styles.optionChipSelected,
                ]}
                onPress={() => setTradingStyle(style.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    tradingStyle === style.value && styles.optionTextSelected,
                  ]}
                >
                  {style.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Experience Level */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Experience Level</Text>
          <Text style={styles.sectionSubtitle}>
            How familiar are you with technical analysis?
          </Text>
          <View style={styles.optionsGrid}>
            {EXPERIENCE_LEVEL_OPTIONS.map((level) => (
              <TouchableOpacity
                key={level.value}
                style={[
                  styles.optionChip,
                  experienceLevel === level.value && styles.optionChipSelected,
                ]}
                onPress={() => setExperienceLevel(level.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    experienceLevel === level.value && styles.optionTextSelected,
                  ]}
                >
                  {level.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
  closeButton: {
    minWidth: 60,
  },
  closeText: {
    ...typography.bodyMd,
    color: colors.neutral[600],
  },
  headerTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  saveButton: {
    minWidth: 60,
    alignItems: 'flex-end',
  },
  saveText: {
    ...typography.bodyMd,
    color: colors.primary[600],
    fontWeight: '600',
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
  section: {
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  sectionSubtitle: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginBottom: spacing.md,
  },
  input: {
    height: 52,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    ...typography.bodyMd,
    color: colors.neutral[900],
  },
  optionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  optionChip: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  optionChipSelected: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[500],
  },
  optionText: {
    ...typography.bodySm,
    color: colors.neutral[600],
  },
  optionTextSelected: {
    color: colors.primary[700],
    fontWeight: '600',
  },
});
