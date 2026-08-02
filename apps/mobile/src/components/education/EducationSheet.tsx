/**
 * Bottom sheet that explains one education topic. Mounted once by EducationProvider.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {
  EDUCATION_DISCLAIMER,
  INDICATOR_EDUCATION,
  type EducationEntry,
} from '@chartsignl/core';
import { borderRadius, colors, spacing, typography } from '../../theme';

export interface EducationSheetProps {
  entry: EducationEntry | null;
  visible: boolean;
  onClose: () => void;
  onNavigate?: (topicId: string) => void;
}

export function EducationSheet({
  entry,
  visible,
  onClose,
  onNavigate,
}: EducationSheetProps) {
  const { height } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(height)).current;
  const backdrop = useRef(new Animated.Value(0)).current;
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (visible) {
      setShowAdvanced(false);
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: 0,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdrop, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      translateY.setValue(height);
      backdrop.setValue(0);
    }
  }, [visible, height, translateY, backdrop]);

  const handleClose = () => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: height,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start(onClose);
  };

  if (!entry) return null;

  const related = (entry.related ?? [])
    .map((id) => INDICATOR_EDUCATION[id])
    .filter(Boolean);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close explanation"
          />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: height * 0.85, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.grabber} />

          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title}>{entry.title}</Text>
              <Text style={styles.short}>{entry.short}</Text>
            </View>
            <Pressable
              onPress={handleClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [
                styles.close,
                { opacity: pressed ? 0.5 : 1 },
              ]}
            >
              <Text style={styles.closeGlyph}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Section title="What it is">
              <Text style={styles.body}>{entry.what}</Text>
            </Section>

            <Section title="Why it matters">
              <Text style={styles.body}>{entry.why}</Text>
            </Section>

            <Section title="How to read it">
              {entry.howToRead.map((line, i) => (
                <View key={i} style={styles.bulletRow}>
                  <View style={styles.bulletDot} />
                  <Text style={[styles.body, styles.bulletText]}>{line}</Text>
                </View>
              ))}
            </Section>

            <View style={styles.caution}>
              <Text style={styles.cautionLabel}>Common mistake</Text>
              <Text style={styles.cautionBody}>{entry.caution}</Text>
            </View>

            {entry.advanced ? (
              <Pressable
                onPress={() => setShowAdvanced((v) => !v)}
                accessibilityRole="button"
                style={styles.advancedToggle}
              >
                <Text style={styles.advancedToggleText}>
                  {showAdvanced ? '− Hide the details' : '+ More detail'}
                </Text>
              </Pressable>
            ) : null}

            {showAdvanced && entry.advanced ? (
              <Text style={[styles.body, styles.advancedBody]}>
                {entry.advanced}
              </Text>
            ) : null}

            {related.length > 0 ? (
              <Section title="Related">
                <View style={styles.chips}>
                  {related.map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => onNavigate?.(r.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Explain ${r.title}`}
                      style={({ pressed }) => [
                        styles.chip,
                        { opacity: pressed ? 0.6 : 1 },
                      ]}
                    >
                      <Text style={styles.chipText}>{r.title}</Text>
                    </Pressable>
                  ))}
                </View>
              </Section>
            ) : null}

            <Text style={styles.disclaimer}>{EDUCATION_DISCLAIMER}</Text>
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.xl : spacing.lg,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral[200],
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerText: { flex: 1, paddingRight: spacing.md },
  title: {
    ...typography.headingMd,
    color: colors.neutral[900],
    marginBottom: 2,
  },
  short: { ...typography.bodySm, color: colors.neutral[600] },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  closeGlyph: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.neutral[600],
  },
  scroll: { paddingHorizontal: spacing.lg },
  scrollContent: { paddingBottom: spacing.lg },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.labelSm,
    color: colors.neutral[400],
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
  },
  body: {
    ...typography.bodyMd,
    color: colors.neutral[900],
    lineHeight: 22,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.neutral[400],
    marginTop: 9,
    marginRight: spacing.sm,
  },
  bulletText: { flex: 1 },
  caution: {
    backgroundColor: colors.amber[50],
    borderLeftWidth: 3,
    borderLeftColor: colors.warning,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cautionLabel: {
    ...typography.labelSm,
    color: colors.warning,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 2,
    fontWeight: '700',
  },
  cautionBody: {
    ...typography.bodySm,
    color: colors.neutral[900],
    lineHeight: 20,
  },
  advancedToggle: { paddingVertical: spacing.xs, marginBottom: spacing.sm },
  advancedToggleText: {
    ...typography.bodySm,
    color: colors.primary[600],
    fontWeight: '600',
  },
  advancedBody: {
    ...typography.bodySm,
    color: colors.neutral[600],
    marginBottom: spacing.lg,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    backgroundColor: colors.neutral[100],
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipText: { ...typography.labelSm, color: colors.neutral[600] },
  disclaimer: {
    ...typography.labelSm,
    color: colors.neutral[400],
    lineHeight: 16,
    marginTop: spacing.sm,
  },
});
