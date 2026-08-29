import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  Platform,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, typography, spacing, borderRadius } from '../theme';
import { API_URL } from '../lib/apiConfig';

export interface NewsletterSignupProps {
  variant: 'hero' | 'footer';
  style?: StyleProp<ViewStyle>;
}

type FormState = 'idle' | 'submitting' | 'success' | 'error';

const SUCCESS_COPY = "You're in. The first brief lands before tomorrow's open.";
const FREQUENCY_COPY = 'Free. One email each market morning. Unsubscribe anytime.';

export function NewsletterSignup({ variant, style }: NewsletterSignupProps) {
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<FormState>('idle');
  const [error, setError] = useState<string | null>(null);

  const source = variant === 'hero' ? 'landing_hero' : 'landing_footer';
  const isHero = variant === 'hero';

  const onSubmit = async () => {
    if (state === 'submitting') return;
    setError(null);
    setState('submitting');

    try {
      const response = await fetch(`${API_URL}/api/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ email, source, website }),
      });

      if (response.status === 400) {
        setState('error');
        setError("That doesn't look like an email address.");
        return;
      }

      if (!response.ok) {
        setState('error');
        setError("Couldn't reach us — try again");
        return;
      }

      setState('success');
    } catch {
      setState('error');
      setError("Couldn't reach us — try again");
    }
  };

  if (state === 'success') {
    return (
      <View
        style={[isHero ? styles.heroWrap : styles.footerWrap, style]}
        accessibilityRole="status"
      >
        <Text style={isHero ? styles.successHero : styles.successFooter}>{SUCCESS_COPY}</Text>
      </View>
    );
  }

  return (
    <View style={[isHero ? styles.heroWrap : styles.footerWrap, style]}>
      {isHero && (
        <>
          <Text style={styles.headline}>The levels, before the open.</Text>
          <Text style={styles.subhead}>
            A short daily brief on what's moving and where the lines are. Free.
          </Text>
        </>
      )}
      {!isHero && (
        <Text style={styles.footerCopy}>Get the ChartSignl daily brief.</Text>
      )}

      <View style={[styles.row, isHero && styles.heroRow]}>
        <View style={styles.field}>
          <Text style={styles.visuallyHidden} nativeID={`${source}-label`}>
            Email
          </Text>
          <TextInput
            accessibilityLabel="Email"
            accessibilityLabelledBy={`${source}-label`}
            style={styles.input}
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (error) setError(null);
              if (state === 'error') setState('idle');
            }}
            placeholder="you@example.com"
            placeholderTextColor={colors.neutral[400]}
            keyboardType="email-address"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="send"
            onSubmitEditing={() => void onSubmit()}
            editable={state !== 'submitting'}
          />
        </View>
        <Pressable
          onPress={() => void onSubmit()}
          disabled={state === 'submitting'}
          style={({ pressed }) => [
            styles.button,
            pressed && styles.buttonPressed,
            state === 'submitting' && styles.buttonDisabled,
          ]}
          accessibilityRole="button"
        >
          <Text style={styles.buttonText}>
            {state === 'submitting' ? 'Sending…' : 'Subscribe'}
          </Text>
        </Pressable>
      </View>

      <TextInput
        value={website}
        onChangeText={setWebsite}
        nativeID={`${source}-website`}
        autoComplete="off"
        // @ts-expect-error web-only; ignored on native
        tabIndex={-1}
        caretHidden
        style={styles.honeypot}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <View accessibilityLiveRegion="polite" style={styles.status}>
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : (
          <Text style={styles.frequency}>{FREQUENCY_COPY}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heroWrap: {
    width: '100%',
    maxWidth: 540,
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  footerWrap: {
    width: '100%',
    maxWidth: 420,
    gap: spacing.xs,
  },
  headline: {
    ...typography.headingLg,
    color: colors.neutral[900],
  },
  subhead: {
    ...typography.bodyMd,
    color: colors.neutral[600],
    marginBottom: spacing.xs,
  },
  footerCopy: {
    ...typography.bodySm,
    color: colors.neutral[600],
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'stretch',
    flexWrap: 'wrap',
  },
  heroRow: {
    marginTop: spacing.xs,
  },
  field: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 180,
  },
  input: {
    ...typography.bodyMd,
    height: 48,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    color: colors.neutral[900],
  },
  button: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 120,
  },
  buttonPressed: {
    backgroundColor: colors.primary[700],
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    ...typography.labelMd,
    color: colors.white,
    fontWeight: '600',
  },
  frequency: {
    ...typography.labelSm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  errorText: {
    ...typography.labelSm,
    color: colors.error,
    marginTop: spacing.xs,
  },
  status: {
    minHeight: 20,
  },
  successHero: {
    ...typography.bodyLg,
    color: colors.primary[700],
    fontWeight: '600',
  },
  successFooter: {
    ...typography.bodyMd,
    color: colors.primary[700],
    fontWeight: '500',
  },
  visuallyHidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0,
  },
  honeypot: {
    position: 'absolute',
    left: -10000,
    top: 0,
    height: 1,
    width: 1,
    opacity: 0,
    ...(Platform.OS === 'web' ? { display: 'flex' } : {}),
  },
});
