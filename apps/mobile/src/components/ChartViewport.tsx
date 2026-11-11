import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import { panView, zoomView, isSameView, clampView, type ChartView } from '../lib/chartViewport';

/** Zoom applied by one press of + or -. */
const BUTTON_ZOOM = 1.5;
/** Horizontal travel (px) before a one-finger drag scrolls the chart instead of the page. */
const DRAG_START_PX = 8;
/**
 * A drag never scrolls faster than one bar per this many pixels. With many bars
 * on a narrow screen each bar is about 2px wide, and following the finger
 * exactly makes a short drag jump a whole session.
 */
const MIN_DRAG_PX_PER_BAR = 5;
/** Largest wheel step counted per event, so one mouse-wheel notch zooms about 20%, not 2.7x. */
const MAX_WHEEL_STEP = 18;

interface ChartViewportProps {
  /** Bars available to scroll through (history plus the default window). */
  total: number;
  /** The view shown before any zoom or scroll. */
  defaultView: ChartView;
  /** Current view. */
  view: ChartView;
  onChange: (view: ChartView) => void;
  /** Called by the Reset button. */
  onReset: () => void;
  children: ReactNode;
}

/**
 * Wraps the chart with zoom and scroll:
 *  - two fingers: pinch to zoom
 *  - one finger (or mouse drag): slide sideways to scroll through bars
 *  - web: ctrl/cmd + wheel (or trackpad pinch) zooms, sideways wheel scrolls
 *  - buttons under the chart: zoom out, zoom in, reset
 *
 * A vertical drag is left alone so the page still scrolls.
 */
export function ChartViewport({ total, defaultView, view, onChange, onReset, children }: ChartViewportProps) {
  const containerRef = useRef<View>(null);
  const layout = useRef({ left: 0, width: 1 });

  // Latest props for the gesture handlers, which are created once.
  const latest = useRef({ total, view, onChange });
  latest.current = { total, view, onChange };

  const gesture = useRef<{
    pan: { view: ChartView; dx: number } | null;
    pinch: { view: ChartView; distance: number; anchor: number } | null;
  }>({ pan: null, pinch: null });

  const measure = () => {
    containerRef.current?.measureInWindow((x, _y, width) => {
      if (width > 0) layout.current = { left: x, width };
    });
  };

  const responder = useMemo(() => {
    const wantsGesture = (_e: GestureResponderEvent, g: PanResponderGestureState) =>
      g.numberActiveTouches >= 2 ||
      (Math.abs(g.dx) > DRAG_START_PX && Math.abs(g.dx) > Math.abs(g.dy) * 1.5);

    const end = () => {
      gesture.current = { pan: null, pinch: null };
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: wantsGesture,
      // Capture, so a drag that starts on a level line still scrolls the chart.
      onMoveShouldSetPanResponderCapture: wantsGesture,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        measure();
        gesture.current = { pan: null, pinch: null };
      },
      onPanResponderMove: (e, g) => {
        const { total: n, view: current, onChange: change } = latest.current;
        if (n <= 0) return;
        const touches = e.nativeEvent.touches ?? [];
        const state = gesture.current;

        if (touches.length >= 2) {
          const [a, b] = touches;
          const distance = Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
          if (!state.pinch) {
            const mid = (a.pageX + b.pageX) / 2;
            const anchor = (mid - layout.current.left) / layout.current.width;
            state.pinch = { view: current, distance: Math.max(distance, 1), anchor };
            state.pan = null;
            return;
          }
          const next = zoomView(state.pinch.view, distance / state.pinch.distance, state.pinch.anchor, n);
          if (!isSameView(next, current)) change(next);
          return;
        }

        // One finger. After a pinch ends, start the drag from where the view is now.
        if (state.pinch || !state.pan) {
          state.pinch = null;
          state.pan = { view: current, dx: g.dx };
          return;
        }
        const pxPerBar = Math.max(
          MIN_DRAG_PX_PER_BAR,
          layout.current.width / Math.max(1, state.pan.view.count),
        );
        // Dragging right pulls older bars into view.
        const next = panView(state.pan.view, (g.dx - state.pan.dx) / pxPerBar, n);
        if (!isSameView(next, current)) change(next);
      },
      onPanResponderRelease: end,
      onPanResponderTerminate: end,
    });
  }, []);

  // Web: wheel and trackpad. A plain vertical wheel is left to scroll the page.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = containerRef.current as unknown as {
      addEventListener?: (type: string, fn: (ev: any) => void, opts?: { passive: boolean }) => void;
      removeEventListener?: (type: string, fn: (ev: any) => void) => void;
      getBoundingClientRect?: () => { left: number; width: number };
    } | null;
    if (!node?.addEventListener || !node.getBoundingClientRect) return;

    const onWheel = (ev: any) => {
      const { total: n, view: current, onChange: change } = latest.current;
      if (n <= 0) return;
      const rect = node.getBoundingClientRect!();
      if (!(rect.width > 0)) return;
      // deltaMode 1 reports lines, not pixels.
      const unit = ev.deltaMode === 1 ? 16 : 1;
      const clampStep = (d: number) => Math.max(-MAX_WHEEL_STEP, Math.min(MAX_WHEEL_STEP, d * unit));
      let next: ChartView;
      if (ev.ctrlKey || ev.metaKey) {
        // Trackpad pinch arrives as many small ctrl + wheel steps; a mouse wheel
        // sends one large step, which is capped.
        next = zoomView(current, Math.exp(-clampStep(ev.deltaY) * 0.01), (ev.clientX - rect.left) / rect.width, n);
      } else if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) {
        const pxPerBar = Math.max(MIN_DRAG_PX_PER_BAR, rect.width / Math.max(1, current.count));
        next = panView(current, -(ev.deltaX * unit) / pxPerBar, n);
      } else {
        return;
      }
      ev.preventDefault();
      if (!isSameView(next, current)) change(next);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener?.('wheel', onWheel);
  }, []);

  const current = clampView(view, total);
  const base = clampView(defaultView, total);
  const changed = !isSameView(current, base);
  const canZoomIn = zoomView(current, BUTTON_ZOOM, 1, total).count < current.count;
  const canZoomOut = current.count < total;

  return (
    <View>
      <View
        ref={containerRef}
        onLayout={measure}
        // Web: let the browser scroll the page vertically, but leave pinch and
        // sideways drags to the chart instead of zooming or swiping the page.
        style={Platform.OS === 'web' ? WEB_TOUCH_STYLE : undefined}
        {...responder.panHandlers}
      >
        {children}
      </View>
      <View style={styles.controls}>
        {changed ? (
          <Pressable
            onPress={onReset}
            style={styles.resetButton}
            accessibilityRole="button"
            accessibilityLabel="Reset chart view"
          >
            <Ionicons name="refresh" size={14} color={colors.primary[600]} />
            <Text style={styles.resetText}>Reset</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onChange(zoomView(current, 1 / BUTTON_ZOOM, 1, total))}
          disabled={!canZoomOut}
          style={[styles.zoomButton, !canZoomOut && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Zoom out"
        >
          <Ionicons name="remove" size={20} color={colors.neutral[700]} />
        </Pressable>
        <Pressable
          onPress={() => onChange(zoomView(current, BUTTON_ZOOM, 1, total))}
          disabled={!canZoomIn}
          style={[styles.zoomButton, !canZoomIn && styles.disabled]}
          accessibilityRole="button"
          accessibilityLabel="Zoom in"
        >
          <Ionicons name="add" size={20} color={colors.neutral[700]} />
        </Pressable>
      </View>
    </View>
  );
}

const WEB_TOUCH_STYLE = { touchAction: 'pan-y' } as unknown as { width?: number };

const styles = StyleSheet.create({
  controls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  zoomButton: {
    width: 48,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[100],
  },
  disabled: {
    opacity: 0.4,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
  },
  resetText: {
    ...typography.labelMd,
    color: colors.primary[600],
  },
});
