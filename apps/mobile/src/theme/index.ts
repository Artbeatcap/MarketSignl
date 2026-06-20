// ChartSignl Theme - Calm, habit-app inspired design
// Inspired by Quittr's soft, supportive aesthetic

export const colors = {
  // Primary: Soft teal/mint
  primary: {
    50: '#F0FDFA',
    100: '#CCFBF1',
    200: '#99F6E4',
    300: '#5EEAD4',
    400: '#2DD4BF',
    500: '#14B8A6',
    600: '#0D9488',
    700: '#0F766E',
    800: '#115E59',
    900: '#134E4A',
  },
  // Secondary: Warm lavender
  secondary: {
    50: '#FAF5FF',
    100: '#F3E8FF',
    200: '#E9D5FF',
    300: '#D8B4FE',
    400: '#C084FC',
    500: '#A855F7',
    600: '#9333EA',
  },
  // Neutrals: Warm gray
  neutral: {
    50: '#FAFAF9',
    100: '#F5F5F4',
    200: '#E7E5E4',
    300: '#D6D3D1',
    400: '#A8A29E',
    500: '#78716C',
    600: '#57534E',
    700: '#44403C',
    800: '#292524',
    900: '#1C1917',
  },
  // Amber: For warnings and email verification
  amber: {
    50: '#FFFBEB',
    100: '#FEF3C7',
    200: '#FDE68A',
    300: '#FCD34D',
    400: '#FBBF24',
    500: '#F59E0B',
    600: '#D97706',
    700: '#B45309',
    800: '#92400E',
    900: '#78350F',
  },
  // Green: For success states and verification
  green: {
    50: '#F0FDF4',
    100: '#DCFCE7',
    200: '#BBF7D0',
    300: '#86EFAC',
    400: '#4ADE80',
    500: '#22C55E',
    600: '#16A34A',
    700: '#15803D',
    800: '#166534',
    900: '#14532D',
  },
  // Semantic
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  white: '#FFFFFF',
  // Red palette for bearish elements
  red: {
    50: '#FEF2F2',
    100: '#FEE2E2',
    200: '#FECACA',
    300: '#FCA5A5',
    400: '#F87171',
    500: '#EF4444',
    600: '#DC2626',
    700: '#B91C1C',
    800: '#991B1B',
    900: '#7F1D1D',
  },
  // Chart colors
  support: {
    strong: '#10B981',
    medium: '#34D399',
    weak: '#6EE7B7',
  },
  resistance: {
    strong: '#EF4444',
    medium: '#F87171',
    weak: '#FCA5A5',
  },
  breakout: '#3B82F6',
  breakdown: '#F97316',
  // Backgrounds
  background: '#FAFAF9',
  surface: '#FFFFFF',
  surfaceElevated: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const typography = {
  // Display - Large headings
  displayLg: {
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
  displayMd: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
  },
  displaySm: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '600' as const,
  },
  // Headings
  headingLg: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600' as const,
  },
  headingMd: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600' as const,
  },
  headingSm: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600' as const,
  },
  // Body
  bodyLg: {
    fontSize: 18,
    lineHeight: 28,
    fontWeight: '400' as const,
  },
  bodyMd: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '400' as const,
  },
  bodySm: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400' as const,
  },
  // Label
  labelLg: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500' as const,
  },
  labelMd: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500' as const,
  },
  labelSm: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500' as const,
  },
};

export const shadows = {
  sm: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  md: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  lg: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
};

// Gradient presets
export const gradients = {
  primary: ['#14B8A6', '#0D9488'],
  secondary: ['#A855F7', '#9333EA'],
  warm: ['#F97316', '#EA580C'],
  cool: ['#3B82F6', '#2563EB'],
  soft: ['#F0FDFA', '#CCFBF1'],
  lavender: ['#FAF5FF', '#F3E8FF'],
};
