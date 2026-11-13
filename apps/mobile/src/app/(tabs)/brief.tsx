import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  TextInput,
  Platform,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { DailyContent, LevelSet } from '@chartsignl/core';

import { Button, Card } from '../../components';
import { colors, typography, spacing, borderRadius } from '../../theme';
import { API_URL } from '../../lib/apiConfig';
import { subscribeToNewsletter } from '../../lib/api';
import { htmlToBlocks, type HtmlBlock } from '../../lib/briefHtml';
import { useAuthStore } from '../../store/authStore';

type BriefSource = 'push' | 'email' | 'tab' | 'link';

interface LatestBrief {
  asOf: string;
  edition: string;
  publishedAt: string;
  complete: boolean;
  isToday: boolean;
  content: DailyContent;
}

class BriefLoadError extends Error {
  constructor(readonly kind: 'empty' | 'network') {
    super(kind);
  }
}

const openedAsOf = new Set<string>();

function openSource(src: string | string[] | undefined): BriefSource {
  const value = Array.isArray(src) ? src[0] : src;
  if (value === 'push' || value === 'email' || value === 'link') return value;
  return 'tab';
}

function formatTapePct(pct: number | null): string {
  if (pct == null || Number.isNaN(pct)) return '';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

async function fetchLatestBrief(): Promise<LatestBrief> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/api/daily-brief/latest`);
  } catch {
    throw new BriefLoadError('network');
  }
  if (response.status === 404) throw new BriefLoadError('empty');
  if (!response.ok) throw new BriefLoadError('network');
  return response.json() as Promise<LatestBrief>;
}

export default function BriefScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ src?: string }>();
  const session = useAuthStore((state) => state.session);
  const isGuest = Platform.OS === 'web' && !session;
  const source = openSource(params.src);

  const query = useQuery({
    queryKey: ['daily-brief', 'latest'],
    queryFn: fetchLatestBrief,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  useFocusEffect(
    useCallback(() => {
      if (query.isFetched && query.isStale) void query.refetch();
    }, [query.isFetched, query.isStale, query.refetch])
  );

  useEffect(() => {
    const brief = query.data;
    if (!brief?.asOf || openedAsOf.has(brief.asOf)) return;
    openedAsOf.add(brief.asOf);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    void fetch(`${API_URL}/api/daily-brief/opened`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ asOf: brief.asOf, source, platform: Platform.OS }),
    }).catch(() => {});
  }, [query.data, session?.access_token, source]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const label = query.data?.content.date_label;
    if (!label) return;
    document.title = `ChartSignl Morning Brief · ${label}`;
  }, [query.data?.content.date_label]);

  const openSymbol = (symbol: string) => {
    router.push({ pathname: '/(tabs)/analyze', params: { symbol } });
  };

  const content = query.data?.content;
  const bias = content?.sections.opening_bias?.trim() ?? '';
  const setup = htmlToBlocks(content?.sections.session_setup_html);
  const watch = htmlToBlocks(content?.sections.todays_watch_html);
  const risk = content?.sections.biggest_risk?.trim() ?? '';

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={() => void query.refetch()}
            tintColor={colors.primary[600]}
          />
        }
      >
        <Text style={styles.kicker}>ChartSignl · Morning Brief</Text>
        {query.isLoading ? (
          <Skeleton />
        ) : query.isError || !query.data || !content ? (
          <ErrorCard
            kind={query.error instanceof BriefLoadError ? query.error.kind : 'network'}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <>
            {!query.data.isToday && (
              <View style={styles.banner}>
                <Text style={styles.bannerText}>
                  Today&apos;s brief publishes around 8:30 AM ET on market days.
                </Text>
              </View>
            )}
            <Text style={styles.date}>{content.date_label}</Text>
            {content.generated_at ? (
              <Text style={styles.disclosure}>
                Figures reflect data available at {content.generated_at}.
              </Text>
            ) : null}

            {bias ? (
              <Card style={styles.biasCard}>
                <Text style={styles.kickerAccent}>Opening bias</Text>
                <Text style={styles.biasText}>{bias}</Text>
              </Card>
            ) : null}

            {isGuest ? <GuestCard /> : null}

            {content.tape?.length ? (
              <Section title="Tape">
                {content.tape.map((item) => (
                  <Pressable key={item.symbol} onPress={() => openSymbol(item.symbol)} style={styles.row}>
                    <Text style={styles.symbol}>{item.symbol}</Text>
                    <Text style={styles.price}>{item.price}</Text>
                    <Text style={[styles.pct, item.pct != null && item.pct < 0 ? styles.down : styles.up]}>
                      {formatTapePct(item.pct)}
                    </Text>
                  </Pressable>
                ))}
              </Section>
            ) : null}

            {setup.length ? (
              <Section title="Session Setup">
                <RichBlocks blocks={setup} />
              </Section>
            ) : null}

            {content.movers?.length ? (
              <Section title="Movers">
                {content.movers.map((mover) => (
                  <View key={mover.ticker} style={styles.mover}>
                    <Pressable onPress={() => openSymbol(mover.ticker)}>
                      <View style={styles.row}>
                        <Text style={styles.symbol}>{mover.ticker}</Text>
                        <Text style={[styles.pct, mover.dir === 'down' ? styles.down : styles.up]}>
                          {mover.pct} · {mover.dir === 'down' ? 'Down' : 'Up'}
                        </Text>
                      </View>
                      {mover.why ? <Text style={styles.body}>{mover.why}</Text> : null}
                    </Pressable>
                    {mover.reasonUrl ? (
                      <Pressable onPress={() => void Linking.openURL(mover.reasonUrl!)}>
                        <Text style={styles.link}>Source</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </Section>
            ) : null}

            {content.levels && Object.keys(content.levels).length ? (
              <Section title="Levels for Today">
                {Object.entries(content.levels).map(([symbol, level]) => (
                  <Card key={symbol} style={styles.levelCard}>
                    <Text style={styles.symbol}>{symbol}</Text>
                    <LevelLines level={level} />
                    <Button
                      title="See the chart"
                      variant="outline"
                      size="sm"
                      onPress={() => openSymbol(symbol)}
                    />
                  </Card>
                ))}
              </Section>
            ) : null}

            {watch.length || content.catalyst_bullets?.length ? (
              <Section title="Today's Watch">
                {watch.length ? <RichBlocks blocks={watch} /> : null}
                {content.catalyst_bullets?.map((bullet, index) => (
                  <View key={`${bullet.date}-${index}`} style={styles.bullet}>
                    <Text style={styles.symbol}>{bullet.date}</Text>
                    <Text style={styles.body}>{bullet.event}</Text>
                    {bullet.why ? <Text style={styles.muted}>{bullet.why}</Text> : null}
                  </View>
                ))}
              </Section>
            ) : null}

            {content.headlines?.length ? (
              <Section title="Headlines in Focus">
                {content.headlines.map((item, index) => (
                  <View key={`${item.headline}-${index}`} style={styles.bullet}>
                    <Text style={styles.heading}>{item.headline}</Text>
                    {item.summary ? <Text style={styles.body}>{item.summary}</Text> : null}
                    {item.url ? (
                      <Pressable onPress={() => void Linking.openURL(item.url!)}>
                        <Text style={styles.link}>Open story</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </Section>
            ) : null}

            {risk ? (
              <Card style={styles.riskCard}>
                <Text style={styles.riskKicker}>The biggest risk</Text>
                <Text style={styles.biasText}>{risk}</Text>
              </Card>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function RichBlocks({ blocks }: { blocks: HtmlBlock[] }) {
  return (
    <View style={styles.blocks}>
      {blocks.map((block, index) => (
        <Text key={index} style={styles.body}>
          {block.runs.map((run, runIndex) => (
            <Text key={runIndex} style={run.bold ? styles.bold : undefined}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </View>
  );
}

function LevelLines({ level }: { level: LevelSet }) {
  const rows: Array<[string, string | undefined]> = [
    ['Pivot', level.pivot],
    ['Support', level.support],
    ['Support 2', level.support2],
    ['Resistance', level.resistance],
    ['Resistance 2', level.resistance2],
  ];
  return (
    <View style={styles.levelLines}>
      {rows
        .filter((row) => row[1])
        .map(([label, value]) => (
          <Text key={label} style={styles.body}>
            {label} {value}
          </Text>
        ))}
    </View>
  );
}

function Skeleton() {
  return (
    <View style={styles.section}>
      <ActivityIndicator color={colors.primary[600]} />
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeleton} />
      ))}
    </View>
  );
}

function ErrorCard({ kind, onRetry }: { kind: 'empty' | 'network'; onRetry: () => void }) {
  return (
    <Card>
      <Text style={styles.heading}>
        {kind === 'empty' ? 'No morning brief has been published yet.' : "The brief didn't load."}
      </Text>
      <Text style={styles.muted}>
        {kind === 'empty'
          ? 'It publishes around 8:30 AM ET on market days.'
          : 'Check the connection and try again.'}
      </Text>
      <Button title="Retry" onPress={onRetry} />
    </Card>
  );
}

function GuestCard() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (state === 'submitting') return;
    setError(null);
    setState('submitting');
    try {
      const result = await subscribeToNewsletter({ email, source: 'brief', website });
      if (result.invalid) {
        setState('error');
        setError("That doesn't look like an email address.");
        return;
      }
      setState('success');
    } catch {
      setState('error');
      setError("Couldn't reach us — try again");
    }
  };

  return (
    <Card style={styles.guestCard}>
      <Text style={styles.heading}>Get this by email each morning</Text>
      {state === 'success' ? (
        <Text style={styles.success}>You&apos;re in. The first brief lands before tomorrow&apos;s open.</Text>
      ) : (
        <>
          <TextInput
            accessibilityLabel="Email"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.neutral[400]}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
          />
          <TextInput
            value={website}
            onChangeText={setWebsite}
            autoComplete="off"
            caretHidden
            style={styles.honeypot}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Button
            title={state === 'submitting' ? 'Sending…' : 'Get this by email each morning'}
            onPress={() => void onSubmit()}
            disabled={state === 'submitting'}
            fullWidth
          />
          {error ? <Text style={styles.error}>{error}</Text> : (
            <Text style={styles.muted}>Free. One email each market morning. Unsubscribe anytime.</Text>
          )}
        </>
      )}
      <Button
        title="Create a free account"
        variant="outline"
        onPress={() => router.push('/(onboarding)/account')}
        fullWidth
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  kicker: { ...typography.labelSm, color: colors.primary[700], letterSpacing: 1.2, textTransform: 'uppercase' },
  kickerAccent: { ...typography.labelSm, color: colors.primary[700], marginBottom: spacing.xs },
  date: { ...typography.headingLg, color: colors.neutral[900] },
  disclosure: { ...typography.bodySm, color: colors.neutral[500] },
  banner: {
    backgroundColor: colors.amber[50],
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  bannerText: { ...typography.bodySm, color: colors.neutral[800] },
  biasCard: { backgroundColor: colors.primary[50] },
  biasText: { ...typography.bodyMd, color: colors.neutral[900] },
  riskCard: { backgroundColor: colors.red[50] },
  riskKicker: { ...typography.labelSm, color: colors.error, marginBottom: spacing.xs },
  section: { gap: spacing.sm },
  sectionTitle: {
    ...typography.headingSm,
    color: colors.neutral[900],
    borderBottomWidth: 2,
    borderBottomColor: colors.neutral[100],
    paddingBottom: spacing.xs,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  symbol: { ...typography.bodyMd, fontWeight: '700', color: colors.neutral[900] },
  price: { ...typography.bodyMd, color: colors.neutral[700], flex: 1 },
  pct: { ...typography.bodySm, fontWeight: '600' },
  up: { color: colors.success },
  down: { color: colors.error },
  mover: { gap: spacing.xs, paddingVertical: spacing.sm },
  body: { ...typography.bodyMd, color: colors.neutral[800] },
  bold: { fontWeight: '700' },
  muted: { ...typography.bodySm, color: colors.neutral[500] },
  heading: { ...typography.headingSm, color: colors.neutral[900] },
  link: { ...typography.bodySm, color: colors.primary[700], fontWeight: '600' },
  bullet: { gap: 4, paddingVertical: spacing.xs },
  blocks: { gap: spacing.sm },
  levelCard: { gap: spacing.sm },
  levelLines: { gap: 2 },
  guestCard: { gap: spacing.sm },
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
  success: { ...typography.bodyMd, color: colors.primary[700], fontWeight: '600' },
  error: { ...typography.bodySm, color: colors.error },
  skeleton: { height: 72, borderRadius: borderRadius.md, backgroundColor: colors.neutral[100] },
  honeypot: { position: 'absolute', left: -10000, height: 1, width: 1, opacity: 0 },
});
