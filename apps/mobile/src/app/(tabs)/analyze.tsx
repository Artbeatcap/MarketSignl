import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Image,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Card, SymbolSearch, StockChart, EmailVerificationBanner, PredictionSummary } from '../../components';
import { useAuthStore } from '../../store/authStore';
import { fetchMarketDataWithIndicators, formatPrice, calculatePriceChange } from '../../lib/marketData';
import { findLocalLevels, detectTrend, analyzeChartData } from '../../lib/chartAnalysis';
import { getUsage, getAnalysis, getPrediction, createPrediction } from '../../lib/api';
import { getWeeklyAtlasUsed } from '../../lib/usage';
import { colors, typography, spacing, borderRadius, shadows } from '../../theme';
import { API_URL } from '../../lib/apiConfig';
import { Ionicons } from '@expo/vector-icons';
import { FREE_ANALYSIS_LIMIT, FREE_PREDICTION_LIMIT, CHART_INTERVAL_OPTIONS, CHART_COLORS } from '@chartsignl/core';
import type { ChartViewType, ChartInterval, AILevel, EnhancedAIAnalysis, ScoredLevel, AIPrediction } from '@chartsignl/core';
import * as SecureStore from 'expo-secure-store';
import * as Haptics from 'expo-haptics';

import { useActiveAlerts, useCreateAlert, useDeleteAlert } from '../../hooks/useAlerts';

export default function AnalyzeScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, isEmailVerified, showEmailVerificationModal, setShowEmailVerificationModal, pendingEmailVerification, setPendingEmailVerification } = useAuthStore();

  const activeAlertsQuery = useActiveAlerts();
  const createAlertMutation = useCreateAlert();
  const deleteAlertMutation = useDeleteAlert();

  const activeAlerts = activeAlertsQuery.data ?? [];
  const isNative = Platform.OS !== 'web';

  const [alertFeedback, setAlertFeedback] = useState<{
    message: string;
    tone: 'success' | 'neutral';
  } | null>(null);
  const [showAlertBellHint, setShowAlertBellHint] = useState(false);

  // Chart state
  const [selectedSymbol, setSelectedSymbol] = useState('AAPL');
  const [selectedName, setSelectedName] = useState('Apple Inc.');
  const [selectedInterval, setSelectedInterval] = useState<ChartInterval>('3mo');
  const [viewType, setViewType] = useState<ChartViewType>('line');
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [showEMA, setShowEMA] = useState(true);

  // Atlas Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<EnhancedAIAnalysis | null>(null);
  const [localLevels, setLocalLevels] = useState<{ support: AILevel[]; resistance: AILevel[] }>({
    support: [],
    resistance: [],
  });
  const [showLevels, setShowLevels] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // AI Prediction state
  const [prediction, setPrediction] = useState<AIPrediction | null>(null);
  const [showPredictionOverlay, setShowPredictionOverlay] = useState(false);

  const { analysisId, predictionId, symbol } = useLocalSearchParams<{
    analysisId?: string;
    predictionId?: string;
    symbol?: string;
  }>();

  // Load unified Atlas run when navigated from history
  useEffect(() => {
    if (!analysisId && !predictionId) return;

    let cancelled = false;

    async function loadAtlasRun() {
      try {
        let analysisData = analysisId ? await getAnalysis(analysisId) : null;
        let predictionData = predictionId ? await getPrediction(predictionId) : null;

        if (cancelled) return;

        const siblingPredictionId = predictionId ?? analysisData?.predictionId;
        const siblingAnalysisId = analysisId ?? predictionData?.analysisId;

        if (!predictionData && siblingPredictionId) {
          predictionData = await getPrediction(siblingPredictionId);
        }
        if (!analysisData && siblingAnalysisId) {
          analysisData = await getAnalysis(siblingAnalysisId);
        }

        if (cancelled) return;

        if (analysisData?.success && analysisData.analysis) {
          const saved = analysisData.analysis as unknown as EnhancedAIAnalysis;
          setAiAnalysis(saved);
          setShowLevels(true);
          if (saved.symbol) setSelectedSymbol(saved.symbol);
          if (saved.timeframe) setSelectedInterval(saved.timeframe as ChartInterval);
        }

        if (predictionData?.success && predictionData.prediction) {
          setPrediction(predictionData.prediction);
          setShowPredictionOverlay(true);
          if (predictionData.prediction.symbol) {
            setSelectedSymbol(predictionData.prediction.symbol);
          }
          if (predictionData.prediction.interval) {
            setSelectedInterval(predictionData.prediction.interval as ChartInterval);
          }
        }
      } catch (err) {
        console.error('Failed to load Atlas run from history:', err);
      }
    }

    void loadAtlasRun();
    return () => {
      cancelled = true;
    };
  }, [analysisId, predictionId]);

  // When navigated from a push notification, preselect the symbol.
  useEffect(() => {
    if (!symbol) return;
    if (analysisId || predictionId) return;

    setAiAnalysis(null);
    setShowLevels(false);
    setErrorMessage(null);

    // Keep the name simple; we can enhance with a search later if needed.
    setSelectedSymbol(String(symbol));
    setSelectedName(String(symbol));
  }, [symbol, analysisId, predictionId]);

  // Clear push-alert feedback after a short delay.
  useEffect(() => {
    if (!alertFeedback) return;
    const t = setTimeout(() => setAlertFeedback(null), 3200);
    return () => clearTimeout(t);
  }, [alertFeedback]);

  useEffect(() => {
    if (!isNative) return;
    let isMounted = true;

    SecureStore.getItemAsync('alert_bell_hint_shown')
      .then((value) => {
        if (isMounted && value !== 'true') {
          setShowAlertBellHint(true);
        }
      })
      .catch(() => {
        // Ignore storage issues and keep default hint visibility.
      });

    return () => {
      isMounted = false;
    };
  }, [isNative]);

  const isPriceWithinTolerance = (priceA: number, priceB: number) => {
    const denom = Math.max(Math.abs(priceA), Math.abs(priceB));
    if (denom === 0) return true;
    const diffRatio = Math.abs(priceA - priceB) / denom;
    return diffRatio <= 0.005; // 0.5%
  };

  const handleToggleLevelAlert = async (
    level: ScoredLevel,
    levelType: 'support' | 'resistance'
  ) => {
    if (!isNative) return;
    if (createAlertMutation.isPending || deleteAlertMutation.isPending) return;
    if (!aiAnalysis) return;

    if (showAlertBellHint) {
      setShowAlertBellHint(false);
      SecureStore.setItemAsync('alert_bell_hint_shown', 'true').catch(() => {
        // Ignore storage failures; hint is still hidden for this session.
      });
    }

    const symbol = aiAnalysis.symbol ?? selectedSymbol;

    const existing = activeAlerts.find(
      (a) =>
        a.symbol === symbol &&
        a.level_type === levelType &&
        isPriceWithinTolerance(level.price, a.level_price)
    );

    try {
      if (existing) {
        await deleteAlertMutation.mutateAsync(existing.id);
        setAlertFeedback({
          message: `Alert removed for ${symbol} at $${formatPrice(level.price)}`,
          tone: 'neutral',
        });
      } else {
        await createAlertMutation.mutateAsync({
          symbol,
          levelPrice: level.price,
          levelType,
          direction: levelType === 'support' ? 'crosses_below' : 'crosses_above',
          levelDescription: level.description,
        });
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
          // Ignore haptics failures.
        });
        setAlertFeedback({
          message: `Alert set for ${symbol} at $${formatPrice(level.price)}`,
          tone: 'success',
        });
      }
    } catch (e) {
      console.error('[ALERTS] Toggle failed:', e);
      setAlertFeedback(null);
    }
  };

  // Fetch usage stats
  const { data: usage } = useQuery({
    queryKey: ['usage'],
    queryFn: getUsage,
    staleTime: 1000 * 60,
  });

  // Fetch market data
  const {
    data: chartData,
    isLoading: isLoadingData,
    error: dataError,
    refetch,
  } = useQuery({
    queryKey: ['marketData', selectedSymbol, selectedInterval],
    queryFn: () => fetchMarketDataWithIndicators(selectedSymbol, selectedInterval),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });
  const safeChartData = chartData ?? [];

  // Calculate local levels when data changes
  useEffect(() => {
    if (safeChartData.length > 0) {
      const levels = findLocalLevels(safeChartData);
      setLocalLevels(levels);
    }
  }, [safeChartData]);

  // Check for pending email verification on mount and trigger modal
  useEffect(() => {
    if (pendingEmailVerification && !isEmailVerified) {
      setShowEmailVerificationModal(true);
      setPendingEmailVerification(false);
    }
  }, [pendingEmailVerification, isEmailVerified, setShowEmailVerificationModal, setPendingEmailVerification]);

  // Price change calculation
  const priceChange = useMemo(() => {
    return calculatePriceChange(safeChartData);
  }, [safeChartData]);

  // Current price
  const currentPrice = safeChartData.length > 0 ? safeChartData[safeChartData.length - 1].close : 0;

  // Trend detection
  const trend = useMemo(() => {
    return detectTrend(safeChartData);
  }, [safeChartData]);

  const weeklyAtlasUsed = getWeeklyAtlasUsed(usage);

  // The unified analysis consumes one prediction + one analysis per tap, so it
  // is locked once either weekly free counter is exhausted (they move in lockstep).
  const analyzeLocked =
    !usage?.isPro && !!usage
      ? (usage.freePredictionsUsed ?? 0) >= FREE_PREDICTION_LIMIT ||
        (usage.freeAnalysesUsed ?? 0) >= FREE_ANALYSIS_LIMIT
      : false;

  // Handle symbol selection
  const handleSelectSymbol = (symbol: string, name: string) => {
    setSelectedSymbol(symbol);
    setSelectedName(name);
    setAiAnalysis(null);
    setPrediction(null);
    setShowPredictionOverlay(false);
    setShowLevels(false);
  };

  // Unified analysis: forecast first, then levels/setups conditioned on the
  // forecast lean so the two outputs stay consistent and never contradict.
  const handleAnalyze = async () => {
    if (!usage) {
      Alert.alert('Please Wait', 'Loading your account information...');
      return;
    }

    if (analyzeLocked) {
      router.push('/premium');
      return;
    }

    setIsAnalyzing(true);
    setErrorMessage(null);

    try {
      const result = await createPrediction(selectedSymbol, selectedInterval, safeChartData);
      if (!result.success || !result.prediction) {
        throw new Error(result.error || 'Analysis failed');
      }
      const pred = result.prediction;
      setPrediction(pred);
      setShowPredictionOverlay(true);

      const analysis = await analyzeChartData(selectedSymbol, selectedInterval, safeChartData, {
        direction: pred.direction,
        confidence: pred.confidence,
        predictionId: pred.id ?? result.predictionId,
      });
      setAiAnalysis(analysis);
      setShowLevels(true);

      queryClient.invalidateQueries({ queryKey: ['usage'] });
    } catch (err) {
      console.error('Analyze error:', err);
      const errorMsg = err instanceof Error ? err.message : 'Please try again';
      const isLimitError =
        errorMsg.toLowerCase().includes('limit') ||
        errorMsg.toLowerCase().includes('upgrade') ||
        errorMsg.toLowerCase().includes('free tier');
      setErrorMessage(errorMsg);
      if (Platform.OS !== 'web') {
        if (isLimitError) {
          Alert.alert('🔒 Free Limit Reached', errorMsg, [
            { text: 'Maybe Later', style: 'cancel' },
            { text: '✨ Upgrade to Pro', onPress: () => router.push('/premium'), style: 'default' },
          ]);
        } else {
          Alert.alert('Analysis Failed', errorMsg);
        }
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Toggle local levels (instant, no API)
  const handleToggleLevels = () => {
    setShowLevels(!showLevels);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.webWrapper} pointerEvents="box-none">
        <View style={styles.webInner} pointerEvents="box-none">
          {/* Email Verification Modal - shows once after signup */}
          {showEmailVerificationModal && (
            <EmailVerificationBanner 
              variant="modal" 
              onDismiss={() => setShowEmailVerificationModal(false)}
            />
          )}
          
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
        {/* Email Verification Banner - persistent reminder */}
        {!isEmailVerified && <EmailVerificationBanner variant="banner" />}
        
        {/* Header */}
        <View style={styles.header}>
          {/* Left side - Logo + Brand Name */}
          <View style={styles.headerLeft}>
            <Image
              source={require('../../../assets/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>ChartSignl</Text>
          </View>
          
          {/* Right side - Usage Badge */}
          <View style={styles.headerRight}>
            <View style={[
              styles.usageBadge,
              !usage?.isPro && usage && weeklyAtlasUsed >= FREE_ANALYSIS_LIMIT && styles.usageBadgeWarning
            ]}>
              <Text style={[
                styles.usageText,
                !usage?.isPro && usage && weeklyAtlasUsed >= FREE_ANALYSIS_LIMIT && styles.usageTextWarning
              ]}>
                {usage?.isPro ? '✨ Pro' : usage ? `${weeklyAtlasUsed}/${FREE_ANALYSIS_LIMIT} free` : '—'}
              </Text>
            </View>
            {!usage?.isPro && (
              <TouchableOpacity
                style={styles.upgradeButton}
                onPress={() => router.push('/premium')}
                activeOpacity={0.7}
              >
                <Text style={styles.upgradeButtonText}>Upgrade</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Symbol Selector */}
        <TouchableOpacity
          style={styles.symbolSelector}
          onPress={() => setShowSymbolSearch(true)}
        >
          <View style={styles.symbolInfo}>
            <Text style={styles.symbolText}>{selectedSymbol}</Text>
            <Text style={styles.symbolName}>{selectedName}</Text>
          </View>
          <View style={styles.priceInfo}>
            <Text style={styles.priceText}>${formatPrice(currentPrice)}</Text>
            <Text
              style={[
                styles.priceChange,
                { color: priceChange.isPositive ? CHART_COLORS.support : CHART_COLORS.resistance },
              ]}
            >
              {priceChange.isPositive ? '+' : ''}
              {priceChange.changePercent.toFixed(2)}%
            </Text>
          </View>
          <Text style={styles.selectorArrow}>▼</Text>
        </TouchableOpacity>

        {/* Interval Selector */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.intervalScroll}
          contentContainerStyle={styles.intervalContainer}
        >
          {CHART_INTERVAL_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[
                styles.intervalButton,
                selectedInterval === opt.value && styles.intervalButtonActive,
              ]}
              onPress={() => {
                setSelectedInterval(opt.value);
                setAiAnalysis(null);
                setPrediction(null);
                setShowPredictionOverlay(false);
              }}
            >
              <Text
                style={[
                  styles.intervalText,
                  selectedInterval === opt.value && styles.intervalTextActive,
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* View Type Toggle */}
        <View style={styles.viewToggle}>
          <TouchableOpacity
            style={[styles.viewButton, viewType === 'line' && styles.viewButtonActive]}
            onPress={() => setViewType('line')}
          >
            <Text style={[styles.viewButtonText, viewType === 'line' && styles.viewButtonTextActive]}>
              Line
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewButton, viewType === 'candle' && styles.viewButtonActive]}
            onPress={() => setViewType('candle')}
          >
            <Text style={[styles.viewButtonText, viewType === 'candle' && styles.viewButtonTextActive]}>
              Candle
            </Text>
          </TouchableOpacity>
          <View style={styles.viewSpacer} />
          <TouchableOpacity
            style={[styles.toggleButton, showEMA && styles.toggleButtonActive]}
            onPress={() => setShowEMA(!showEMA)}
          >
            <Text style={[styles.toggleText, showEMA && styles.toggleTextActive]}>EMA</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleButton, showLevels && styles.toggleButtonActive]}
            onPress={handleToggleLevels}
          >
            <Text style={[styles.toggleText, showLevels && styles.toggleTextActive]}>S/R</Text>
          </TouchableOpacity>
        </View>

        {/* Chart */}
        <Card style={styles.chartCard} padding="none">
          {isLoadingData ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary[500]} />
              <Text style={styles.loadingText}>Loading chart...</Text>
            </View>
          ) : dataError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorEmoji}>📊</Text>
              <Text style={styles.chartErrorText}>Failed to load chart data</Text>
              <Button title="Retry" onPress={() => refetch()} variant="outline" size="sm" />
            </View>
          ) : (
            <StockChart
              data={safeChartData}
              symbol={selectedSymbol}
              interval={selectedInterval}
              viewType={viewType}
              showEMA={showEMA}
              supportLevels={showLevels ? (aiAnalysis ? convertToAILevels(aiAnalysis.supportLevels) : localLevels.support) : []}
              resistanceLevels={showLevels ? (aiAnalysis ? convertToAILevels(aiAnalysis.resistanceLevels) : localLevels.resistance) : []}
              height={320}
              projectedPath={prediction?.projectedPath}
              expectedChangePct={prediction?.expectedChangePct}
              showPrediction={showPredictionOverlay && !!prediction}
            />
          )}
        </Card>

        {/* Trend / Atlas summary */}
        <View style={[styles.trendCard, prediction ? styles.trendCardStacked : null]}>
          {!prediction ? (
            <>
              <Text style={styles.trendLabel}>Recent EMA trend</Text>
              <View style={styles.trendValue}>
                <View
                  style={[
                    styles.trendDot,
                    { backgroundColor: trendDirectionColor(trend.trend) },
                  ]}
                />
                <Text style={styles.trendText}>
                  {trend.trend.charAt(0).toUpperCase() + trend.trend.slice(1)}
                </Text>
                <Text style={styles.trendStrength}>({(trend.strength * 100).toFixed(0)}%)</Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.trendCombinedRow}>
                <View style={styles.trendSegment}>
                  <View
                    style={[
                      styles.trendDot,
                      { backgroundColor: trendDirectionColor(trend.trend) },
                    ]}
                  />
                  <Text style={styles.trendCombinedText}>
                    EMA trend: {trend.trend.charAt(0).toUpperCase() + trend.trend.slice(1)} (
                    {(trend.strength * 100).toFixed(0)}%)
                  </Text>
                </View>
                <Text style={styles.trendSeparator}>·</Text>
                <View style={styles.trendSegment}>
                  <View
                    style={[
                      styles.trendDot,
                      { backgroundColor: trendDirectionColor(prediction.direction) },
                    ]}
                  />
                  <Text style={styles.trendCombinedText}>
                    Atlas forecast:{' '}
                    {prediction.direction.charAt(0).toUpperCase() + prediction.direction.slice(1)} (
                    {prediction.expectedChangePct >= 0 ? '+' : ''}
                    {prediction.expectedChangePct.toFixed(2)}%, {prediction.confidence}% conf)
                  </Text>
                </View>
              </View>
              <Text style={styles.trendFootnote}>
                EMA reflects recent price action; Atlas forecast looks ahead over this timeframe.
              </Text>
            </>
          )}
        </View>

        {/* Unified AI Analysis CTA */}
        <View style={styles.aiSection}>
          <View style={styles.ctaWrap}>
            <Button
              title={
                isAnalyzing
                  ? 'Atlas is analyzing…'
                  : analyzeLocked
                  ? '🔒 Upgrade for More'
                  : `✨ Ask Atlas · ${selectedSymbol}`
              }
              onPress={handleAnalyze}
              size="lg"
              fullWidth
              loading={isAnalyzing}
              disabled={isLoadingData || safeChartData.length === 0 || !usage}
              variant={analyzeLocked ? 'secondary' : 'primary'}
            />
          </View>
          {errorMessage && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>⚠️ {errorMessage}</Text>
              {(errorMessage.toLowerCase().includes('limit') ||
                errorMessage.toLowerCase().includes('upgrade') ||
                errorMessage.toLowerCase().includes('free tier')) && (
                <Button
                  title="Upgrade for More"
                  onPress={() => router.push('/premium')}
                  variant="primary"
                  size="sm"
                  fullWidth
                  style={styles.errorUpgradeButton}
                />
              )}
            </View>
          )}
          <Text style={[styles.aiHint, analyzeLocked && styles.aiHintWarning]}>
            {!usage?.isPro && usage
              ? analyzeLocked
                ? `🔓 You've used all ${FREE_ANALYSIS_LIMIT} free Atlas runs this week. Tap to upgrade!`
                : `${weeklyAtlasUsed}/${FREE_ANALYSIS_LIMIT} free Atlas runs this week`
              : 'Atlas forecast + key levels — in one tap'}
          </Text>
        </View>

        {prediction && <PredictionSummary prediction={prediction} />}

        {/* Levels & setups — consistent with the forecast above */}
        {aiAnalysis && (
          <Card style={styles.analysisCard}>
            <View style={styles.analysisHeader}>
              <Text style={styles.analysisTitle}>Atlas levels & setups</Text>
              <View style={styles.confidenceBadge}>
                <Text style={styles.confidenceText}>{aiAnalysis.overallConfidence}% confluence</Text>
              </View>
            </View>

            {/* Lightweight confirmation after setting/removing alerts */}
            {alertFeedback && isNative && (
              <View
                style={[
                  styles.alertFeedback,
                  alertFeedback.tone === 'neutral' && styles.alertFeedbackNeutral,
                ]}
              >
                <Text
                  style={[
                    styles.alertFeedbackText,
                    alertFeedback.tone === 'neutral' && styles.alertFeedbackTextNeutral,
                  ]}
                >
                  {alertFeedback.message}
                </Text>
              </View>
            )}

            {/* Key Levels */}
            <View style={styles.levelsSection}>
              <Text style={styles.levelsSectionTitle}>Support Levels</Text>
              {aiAnalysis.supportLevels.map((level, index) => {
                const symbol = aiAnalysis.symbol ?? selectedSymbol;
                const isAlertActive = activeAlerts.some(
                  (a) =>
                    a.symbol === symbol &&
                    a.level_type === 'support' &&
                    isPriceWithinTolerance(level.price, a.level_price)
                );

                return (
                  <EnhancedLevelRow
                    key={level.id}
                    level={level}
                    type="support"
                    showBell={isNative}
                    isAlertActive={isAlertActive}
                    isAlertBusy={
                      createAlertMutation.isPending ||
                      deleteAlertMutation.isPending
                    }
                    showBellHint={showAlertBellHint && index === 0}
                    onToggleAlert={() => handleToggleLevelAlert(level, 'support')}
                  />
                );
              })}
            </View>

            <View style={styles.levelsSection}>
              <Text style={styles.levelsSectionTitle}>Resistance Levels</Text>
              {aiAnalysis.resistanceLevels.map((level, index) => {
                const symbol = aiAnalysis.symbol ?? selectedSymbol;
                const isAlertActive = activeAlerts.some(
                  (a) =>
                    a.symbol === symbol &&
                    a.level_type === 'resistance' &&
                    isPriceWithinTolerance(level.price, a.level_price)
                );

                return (
                  <EnhancedLevelRow
                    key={level.id}
                    level={level}
                    type="resistance"
                    showBell={isNative}
                    isAlertActive={isAlertActive}
                    isAlertBusy={
                      createAlertMutation.isPending ||
                      deleteAlertMutation.isPending
                    }
                    showBellHint={
                      showAlertBellHint &&
                      aiAnalysis.supportLevels.length === 0 &&
                      index === 0
                    }
                    onToggleAlert={() => handleToggleLevelAlert(level, 'resistance')}
                  />
                );
              })}
            </View>

            {/* Key Observations */}
            {aiAnalysis.keyObservations && aiAnalysis.keyObservations.length > 0 && (
              <View style={styles.observationsSection}>
                <Text style={styles.observationsTitle}>Key Observations</Text>
                {aiAnalysis.keyObservations.map((obs, i) => (
                  <Text key={i} style={styles.observationText}>
                    • {obs}
                  </Text>
                ))}
              </View>
            )}

            {/* Trading Ideas */}
            {aiAnalysis.tradeIdeas && aiAnalysis.tradeIdeas.length > 0 && (
              <View style={styles.ideasSection}>
                <Text style={styles.ideasTitle}>Trading Ideas</Text>
                {aiAnalysis.tradeIdeas.map((idea, i) => (
                  <View key={i} style={styles.ideaCard}>
                    <View style={styles.ideaHeader}>
                      <Text style={styles.ideaScenario}>{idea.scenario}</Text>
                      <View style={[styles.directionBadge, { 
                        backgroundColor: idea.direction === 'long' ? colors.primary[100] : colors.red[100]
                      }]}>
                        <Text style={[styles.directionText, {
                          color: idea.direction === 'long' ? colors.primary[700] : colors.red[700]
                        }]}>
                          {idea.direction.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.ideaDetail}>Entry: ${idea.entryZone.low.toFixed(2)} - ${idea.entryZone.high.toFixed(2)}</Text>
                    <Text style={styles.ideaDetail}>Target: ${idea.target.toFixed(2)}</Text>
                    <Text style={styles.ideaDetail}>Stop: ${idea.stop.toFixed(2)}</Text>
                    <Text style={styles.ideaDetail}>R/R: {idea.riskRewardRatio.toFixed(1)}:1</Text>
                    <Text style={styles.ideaRisk}>Invalidation: {idea.invalidation}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Risk Factors */}
            {aiAnalysis.riskFactors && aiAnalysis.riskFactors.length > 0 && (
              <View style={styles.riskSection}>
                <Text style={styles.riskTitle}>⚠️ Risk Factors</Text>
                {aiAnalysis.riskFactors.map((risk, i) => (
                  <Text key={i} style={styles.riskText}>
                    • {risk}
                  </Text>
                ))}
              </View>
            )}
          </Card>
        )}

          </ScrollView>

          {/* Symbol Search Modal */}
          <SymbolSearch
            visible={showSymbolSearch}
            onClose={() => setShowSymbolSearch(false)}
            onSelectSymbol={handleSelectSymbol}
            currentSymbol={selectedSymbol}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

// Helper function to convert ScoredLevel to AILevel for the chart component
function trendDirectionColor(direction: 'bullish' | 'bearish' | 'neutral') {
  if (direction === 'bullish') return CHART_COLORS.support;
  if (direction === 'bearish') return CHART_COLORS.resistance;
  return colors.neutral[400];
}

function convertToAILevels(scoredLevels: ScoredLevel[]): AILevel[] {
  return scoredLevels.map(level => ({
    id: level.id,
    type: level.type,
    price: level.price,
    strength: level.strength,
    touches: level.factors.historicalTouches.count,
    description: level.description,
  }));
}

function LevelRow({ level, type }: { level: AILevel; type: 'support' | 'resistance' }) {
  const color = type === 'support' ? CHART_COLORS.support : CHART_COLORS.resistance;

  return (
    <View style={styles.levelRow}>
      <View style={[styles.levelIndicator, { backgroundColor: color }]} />
      <View style={styles.levelInfo}>
        <Text style={styles.levelPrice}>${formatPrice(level.price)}</Text>
        <Text style={styles.levelDescription}>{level.description}</Text>
      </View>
      <View style={[styles.strengthBadge, { borderColor: color }]}>
        <Text style={[styles.strengthText, { color }]}>{level.strength}</Text>
      </View>
    </View>
  );
}

function EnhancedLevelRow({
  level,
  type,
  showBell,
  showBellHint,
  isAlertActive,
  isAlertBusy,
  onToggleAlert,
}: {
  level: ScoredLevel;
  type: 'support' | 'resistance';
  showBell: boolean;
  showBellHint: boolean;
  isAlertActive: boolean;
  isAlertBusy: boolean;
  onToggleAlert: () => void;
}) {
  const color = type === 'support' ? CHART_COLORS.support : CHART_COLORS.resistance;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const hasPulsed = useRef(false);

  useEffect(() => {
    if (!showBell || isAlertActive || hasPulsed.current) return;
    hasPulsed.current = true;

    Animated.sequence([
      Animated.timing(pulseScale, {
        toValue: 1.15,
        duration: 750,
        useNativeDriver: true,
      }),
      Animated.timing(pulseScale, {
        toValue: 1,
        duration: 750,
        useNativeDriver: true,
      }),
    ]).start();
  }, [showBell, isAlertActive, pulseScale]);

  return (
    <View style={styles.levelRow}>
      <View style={[styles.levelIndicator, { backgroundColor: color }]} />
      <View style={styles.levelInfo}>
        <Text style={styles.levelPrice}>${formatPrice(level.price)}</Text>
        <Text style={styles.levelDescription}>{level.description}</Text>
        <Text style={styles.levelZone}>Zone: ${level.zone.low.toFixed(2)} - ${level.zone.high.toFixed(2)}</Text>
      </View>
      <View>
        <View style={styles.strengthAndBellRow}>
          {showBell && (
            <View style={styles.bellHintGroup}>
              <Animated.View style={{ transform: [{ scale: pulseScale }] }}>
                <TouchableOpacity
                  style={styles.bellButton}
                  onPress={onToggleAlert}
                  disabled={isAlertBusy}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons
                    name={isAlertActive ? 'notifications' : 'notifications-outline'}
                    size={18}
                    color={
                      isAlertActive ? colors.primary[500] : colors.neutral[400]
                    }
                  />
                </TouchableOpacity>
              </Animated.View>
              {showBellHint && !isAlertActive && (
                <Text style={styles.bellHintText}>Tap to set alert</Text>
              )}
            </View>
          )}

          <View style={[styles.strengthBadge, { borderColor: color }]}>
            <Text style={[styles.strengthText, { color }]}>{level.strength}</Text>
          </View>
        </View>
        <Text style={styles.confluenceScore}>{level.confluenceScore}/100</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    ...(Platform.OS === 'web' && { height: '100vh', overflow: 'auto' }),
    backgroundColor: colors.background,
  },
  webWrapper: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
  },
  webInner: {
    ...(Platform.OS !== 'web' && { flex: 1 }),
    width: '100%',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.lg,
    paddingBottom: Platform.OS === 'web' ? spacing.xxl * 3 : spacing.xxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logo: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    marginRight: spacing.sm,
  },
  brandName: {
    ...typography.headingLg,
    color: colors.primary[600],
    fontWeight: '600',
  },
  usageBadge: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  usageText: {
    ...typography.labelSm,
    color: colors.primary[700],
  },
  usageBadgeWarning: {
    backgroundColor: colors.red[50],
    borderColor: colors.red[300],
    borderWidth: 1,
  },
  usageTextWarning: {
    color: colors.red[700],
    fontWeight: '700',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  upgradeButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    marginTop: spacing.xs,
  },
  upgradeButtonText: {
    ...typography.labelSm,
    color: colors.white,
    fontWeight: '600',
  },
  // Symbol selector
  symbolSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.xl,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  symbolInfo: {
    flex: 1,
  },
  symbolText: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  symbolName: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  priceInfo: {
    alignItems: 'flex-end',
    marginRight: spacing.sm,
  },
  priceText: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  priceChange: {
    ...typography.labelSm,
  },
  selectorArrow: {
    fontSize: 12,
    color: colors.neutral[400],
  },
  // Intervals
  intervalScroll: {
    marginBottom: spacing.md,
  },
  intervalContainer: {
    gap: spacing.xs,
  },
  intervalButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[100],
  },
  intervalButtonActive: {
    backgroundColor: colors.primary[500],
  },
  intervalText: {
    ...typography.labelMd,
    color: colors.neutral[600],
  },
  intervalTextActive: {
    color: '#fff',
  },
  // View toggle
  viewToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
    gap: spacing.xs,
  },
  viewButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[100],
  },
  viewButtonActive: {
    backgroundColor: colors.primary[100],
  },
  viewButtonText: {
    ...typography.labelMd,
    color: colors.neutral[600],
  },
  viewButtonTextActive: {
    color: colors.primary[700],
  },
  viewSpacer: {
    flex: 1,
  },
  toggleButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  toggleButtonActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[500],
  },
  toggleText: {
    ...typography.labelSm,
    color: colors.neutral[500],
  },
  toggleTextActive: {
    color: colors.primary[700],
  },
  // Chart
  chartCard: {
    marginBottom: spacing.md,
    overflow: 'visible', // Allow legend to render when it wraps.
  },
  loadingContainer: {
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    marginTop: spacing.md,
  },
  errorContainer: {
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  errorEmoji: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  chartErrorText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
    marginBottom: spacing.md,
  },
  // Trend
  trendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  trendCardStacked: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: spacing.sm,
  },
  trendLabel: {
    ...typography.labelMd,
    color: colors.neutral[600],
  },
  trendValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  trendCombinedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  trendSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  trendSeparator: {
    ...typography.bodySm,
    color: colors.neutral[400],
  },
  trendCombinedText: {
    ...typography.bodySm,
    color: colors.neutral[800],
    flexShrink: 1,
  },
  trendFootnote: {
    ...typography.labelSm,
    color: colors.neutral[500],
    lineHeight: 18,
  },
  trendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  trendText: {
    ...typography.headingSm,
    color: colors.neutral[900],
  },
  trendStrength: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  // AI Section
  aiSection: {
    marginBottom: spacing.lg,
  },
  ctaWrap: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  aiHint: {
    ...typography.bodySm,
    color: colors.neutral[500],
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  aiHintWarning: {
    color: colors.primary[600],
    fontWeight: '600',
  },
  errorBanner: {
    backgroundColor: colors.red[50],
    borderColor: colors.red[300],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.bodySm,
    color: colors.red[700],
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  errorUpgradeButton: {
    marginTop: spacing.sm,
  },
  // Analysis card
  analysisCard: {
    marginBottom: spacing.lg,
  },
  analysisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  analysisTitle: {
    ...typography.headingMd,
    color: colors.neutral[900],
  },
  confidenceBadge: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.md,
  },
  confidenceText: {
    ...typography.labelSm,
    color: colors.primary[700],
    fontWeight: '600',
  },
  analysisHeadline: {
    ...typography.bodyLg,
    color: colors.neutral[900],
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  alertFeedback: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[200],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  alertFeedbackNeutral: {
    backgroundColor: colors.neutral[100],
    borderColor: colors.neutral[200],
  },
  alertFeedbackText: {
    ...typography.bodySm,
    color: colors.primary[700],
    fontWeight: '600',
    textAlign: 'center',
  },
  alertFeedbackTextNeutral: {
    color: colors.neutral[600],
  },
  analysisSummary: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  levelsSection: {
    marginBottom: spacing.md,
  },
  levelsSectionTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  levelIndicator: {
    width: 4,
    height: 32,
    borderRadius: 2,
    marginRight: spacing.sm,
  },
  levelInfo: {
    flex: 1,
  },
  levelPrice: {
    ...typography.headingSm,
    color: colors.neutral[900],
  },
  levelDescription: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  strengthBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
  },
  strengthText: {
    ...typography.labelSm,
    textTransform: 'capitalize',
  },
  levelZone: {
    ...typography.bodySm,
    color: colors.neutral[400],
    marginTop: 2,
  },
  confluenceScore: {
    ...typography.labelSm,
    color: colors.neutral[500],
    textAlign: 'center',
    marginTop: 2,
  },
  strengthAndBellRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  bellHintGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary[50],
  },
  bellHintText: {
    color: colors.neutral[400],
    fontSize: 11,
  },
  observationsSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  observationsTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  observationText: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
  ideasSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  ideasTitle: {
    ...typography.labelMd,
    color: colors.neutral[600],
    marginBottom: spacing.sm,
  },
  ideaCard: {
    backgroundColor: colors.primary[50],
    padding: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  ideaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.xs,
  },
  ideaScenario: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    fontWeight: '500',
    flex: 1,
    marginRight: spacing.sm,
  },
  directionBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  directionText: {
    ...typography.labelSm,
    fontWeight: '600',
  },
  ideaDetail: {
    ...typography.bodySm,
    color: colors.neutral[600],
  },
  ideaRisk: {
    ...typography.bodySm,
    color: colors.neutral[500],
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  riskSection: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
    backgroundColor: colors.red[50],
    padding: spacing.md,
    borderRadius: borderRadius.md,
  },
  riskTitle: {
    ...typography.labelMd,
    color: colors.red[700],
    marginBottom: spacing.sm,
  },
  riskText: {
    ...typography.bodyMd,
    color: colors.red[600],
    marginBottom: spacing.xs,
    lineHeight: 22,
  },
});
