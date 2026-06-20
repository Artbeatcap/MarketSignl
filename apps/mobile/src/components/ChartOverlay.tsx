import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Line, Rect, G } from 'react-native-svg';
import type { ChartAnalysis, MarkupLine, MarkupHighlight, MarkupLabel } from '@chartsignl/core';
import { MARKUP_COLORS } from '@chartsignl/core';
import { colors, typography, borderRadius } from '../theme';

interface ChartOverlayProps {
  analysis: ChartAnalysis;
  imageWidth: number;
  imageHeight: number;
}

export function ChartOverlay({ analysis, imageWidth, imageHeight }: ChartOverlayProps) {
  const { markupInstructions } = analysis;

  return (
    <View style={[styles.overlay, { width: imageWidth, height: imageHeight }]}>
      {/* SVG layer for lines and highlights */}
      <Svg width={imageWidth} height={imageHeight} style={styles.svg}>
        {/* Render highlights (zones) */}
        {markupInstructions.highlights.map((highlight, index) => (
          <HighlightRect
            key={`highlight-${index}`}
            highlight={highlight}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
          />
        ))}

        {/* Render lines */}
        {markupInstructions.lines.map((line, index) => (
          <LevelLine
            key={`line-${index}`}
            line={line}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
          />
        ))}
      </Svg>

      {/* HTML layer for labels */}
      {markupInstructions.labels.map((label, index) => (
        <LevelLabel
          key={`label-${index}`}
          label={label}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
        />
      ))}
    </View>
  );
}

// Individual level line
function LevelLine({
  line,
  imageWidth,
  imageHeight,
}: {
  line: MarkupLine;
  imageWidth: number;
  imageHeight: number;
}) {
  const y = line.imageY * imageHeight;
  const color = MARKUP_COLORS[line.colorRole] || colors.primary[500];
  const strokeWidth = line.thickness === 'thick' ? 3 : line.thickness === 'thin' ? 1 : 2;
  const dashArray = line.style === 'dashed' ? '8,4' : line.style === 'dotted' ? '2,2' : undefined;

  return (
    <Line
      x1={0}
      y1={y}
      x2={imageWidth}
      y2={y}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeDasharray={dashArray}
      opacity={0.8}
    />
  );
}

// Highlight rectangle (for zones)
function HighlightRect({
  highlight,
  imageWidth,
  imageHeight,
}: {
  highlight: MarkupHighlight;
  imageWidth: number;
  imageHeight: number;
}) {
  const { imageRegion, style } = highlight;
  const x = imageRegion.x0 * imageWidth;
  const y = imageRegion.y0 * imageHeight;
  const width = (imageRegion.x1 - imageRegion.x0) * imageWidth;
  const height = (imageRegion.y1 - imageRegion.y0) * imageHeight;

  let fillColor = colors.primary[500];
  let opacity = 0.15;

  if (style === 'halo') {
    opacity = 0.25;
  }

  return (
    <Rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={fillColor}
      opacity={opacity}
      rx={4}
    />
  );
}

// Level label
function LevelLabel({
  label,
  imageWidth,
  imageHeight,
}: {
  label: MarkupLabel;
  imageWidth: number;
  imageHeight: number;
}) {
  const left = label.anchor.x * imageWidth;
  const top = label.anchor.y * imageHeight;

  return (
    <View style={[styles.labelContainer, { left, top }]}>
      <Text style={styles.labelText} numberOfLines={1}>
        {label.text}
      </Text>
    </View>
  );
}

// Summary panel shown below the chart
interface AnalysisSummaryProps {
  analysis: ChartAnalysis;
}

export function AnalysisSummary({ analysis }: AnalysisSummaryProps) {
  const { summary, meta, levels } = analysis;

  return (
    <View style={styles.summaryContainer}>
      {/* Headline */}
      <Text style={styles.headline}>{summary.headline}</Text>

      {/* Meta info */}
      <View style={styles.metaRow}>
        {meta.symbol && (
          <View style={styles.metaTag}>
            <Text style={styles.metaTagText}>{meta.symbol}</Text>
          </View>
        )}
        {meta.timeframe && (
          <View style={styles.metaTag}>
            <Text style={styles.metaTagText}>{meta.timeframe}</Text>
          </View>
        )}
        <View style={[styles.metaTag, styles.trendTag]}>
          <Text style={styles.metaTagText}>
            {meta.trend.type.charAt(0).toUpperCase() + meta.trend.type.slice(1)}
          </Text>
        </View>
      </View>

      {/* Key levels */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Key Levels</Text>
        {summary.keyLevelsCommentary.map((comment, index) => (
          <Text key={index} style={styles.commentText}>
            • {comment}
          </Text>
        ))}
      </View>

      {/* Level details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Detected Levels ({levels.length})</Text>
        {levels.slice(0, 5).map((level) => (
          <View key={level.id} style={styles.levelRow}>
            <View
              style={[
                styles.levelIndicator,
                {
                  backgroundColor:
                    level.role.includes('support')
                      ? colors.support.strong
                      : colors.resistance.strong,
                },
              ]}
            />
            <View style={styles.levelInfo}>
              <Text style={styles.levelLabel}>{level.label}</Text>
              {level.approxPrice && (
                <Text style={styles.levelPrice}>${level.approxPrice.toFixed(2)}</Text>
              )}
            </View>
            <View style={styles.levelStrength}>
              <Text style={styles.strengthText}>{level.strength}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Trading ideas */}
      {summary.tradingIdeas.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Trading Ideas</Text>
          {summary.tradingIdeas.map((idea, index) => (
            <View key={index} style={styles.ideaCard}>
              <Text style={styles.ideaText}>{idea.idea}</Text>
              <Text style={styles.riskNote}>{idea.riskNote}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  svg: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  labelContainer: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    maxWidth: 150,
  },
  labelText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '500',
  },
  // Summary styles
  summaryContainer: {
    padding: 20,
  },
  headline: {
    ...typography.headingLg,
    color: colors.neutral[900],
    marginBottom: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  metaTag: {
    backgroundColor: colors.neutral[100],
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: borderRadius.sm,
  },
  trendTag: {
    backgroundColor: colors.primary[100],
  },
  metaTagText: {
    ...typography.labelSm,
    color: colors.neutral[700],
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.neutral[600],
    marginBottom: 12,
  },
  commentText: {
    ...typography.bodyMd,
    color: colors.neutral[700],
    marginBottom: 8,
    lineHeight: 24,
  },
  levelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  levelIndicator: {
    width: 4,
    height: 32,
    borderRadius: 2,
    marginRight: 12,
  },
  levelInfo: {
    flex: 1,
  },
  levelLabel: {
    ...typography.bodyMd,
    fontWeight: '500',
    color: colors.neutral[800],
  },
  levelPrice: {
    ...typography.bodySm,
    color: colors.neutral[500],
  },
  levelStrength: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.sm,
  },
  strengthText: {
    ...typography.labelSm,
    color: colors.neutral[600],
    textTransform: 'capitalize',
  },
  ideaCard: {
    backgroundColor: colors.primary[50],
    padding: 16,
    borderRadius: borderRadius.lg,
    marginBottom: 12,
  },
  ideaText: {
    ...typography.bodyMd,
    color: colors.neutral[800],
    marginBottom: 8,
  },
  riskNote: {
    ...typography.bodySm,
    color: colors.neutral[500],
    fontStyle: 'italic',
  },
});
