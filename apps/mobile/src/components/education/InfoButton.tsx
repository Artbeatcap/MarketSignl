/**
 * Circled "i" that opens an education topic via EducationProvider.
 */

import React, { memo, useCallback } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { INDICATOR_EDUCATION } from '@chartsignl/core';
import { colors, spacing, typography } from '../../theme';
import { useEducationOptional } from './EducationProvider';

export interface InfoButtonProps {
  topic: string;
  size?: 'sm' | 'md';
  tone?: 'default' | 'muted';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZES = {
  sm: { box: 14, font: 9, radius: 7 },
  md: { box: 18, font: 11, radius: 9 },
} as const;

function InfoButtonBase({
  topic,
  size = 'sm',
  tone = 'default',
  style,
  testID,
}: InfoButtonProps) {
  const education = useEducationOptional();
  const dims = SIZES[size];

  const handlePress = useCallback(() => {
    education?.open(topic);
  }, [education, topic]);

  if (!education || !INDICATOR_EDUCATION[topic]) return null;

  const title = INDICATOR_EDUCATION[topic].title;
  const fg = tone === 'muted' ? colors.neutral[400] : colors.neutral[600];
  const bg = tone === 'muted' ? 'transparent' : colors.surfaceElevated;

  return (
    <Pressable
      onPress={handlePress}
      testID={testID ?? `info-${topic}`}
      hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
      accessibilityRole="button"
      accessibilityLabel={`Explain ${title}`}
      accessibilityHint="Opens a plain-English explanation"
      style={({ pressed }) => [
        styles.pressable,
        { opacity: pressed ? 0.5 : 1 },
        style,
      ]}
    >
      <View
        style={[
          styles.circle,
          {
            width: dims.box,
            height: dims.box,
            borderRadius: dims.radius,
            backgroundColor: bg,
            borderColor: fg,
          },
        ]}
      >
        <Text
          style={[styles.glyph, { fontSize: dims.font, color: fg }]}
          allowFontScaling={false}
        >
          i
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: {
    marginLeft: spacing.xs,
    alignSelf: 'center',
  },
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  glyph: {
    ...typography.labelSm,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: -0.5,
  },
});

export const InfoButton = memo(InfoButtonBase);
