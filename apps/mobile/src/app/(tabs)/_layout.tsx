import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography } from '../../theme';

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  // Icon row + label, plus the home-indicator inset. The old 80px bar with
  // 24px of bottom padding left ~48px for both, and the label collapsed.
  const tabBarHeight = 56 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          styles.tabBar,
          { height: tabBarHeight, paddingBottom: Math.max(insets.bottom, 6) },
        ],
        tabBarActiveTintColor: colors.primary[600],
        tabBarInactiveTintColor: colors.neutral[400],
        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      <Tabs.Screen
        name="analyze"
        options={{
          title: 'Analyze',
          tabBarIcon: ({ color }) => <TabIcon icon="📊" color={color} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => <TabIcon icon="📋" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <TabIcon icon="👤" color={color} />,
        }}
      />
      {/* "Alerts" route exists but is not shown as a tab item. */}
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          href: null,
        }}
      />
    </Tabs>
  );
}

function TabIcon({ icon, color }: { icon: string; color: string }) {
  return (
    <View style={[styles.iconContainer, { opacity: color === colors.primary[600] ? 1 : 0.6 }]}>
      <Text style={styles.icon}>{icon}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
    paddingTop: 6,
  },
  tabBarItem: {
    paddingTop: 0,
    paddingBottom: 0,
    justifyContent: 'center',
  },
  tabBarLabel: {
    ...typography.labelSm,
    lineHeight: 14,
    height: 14,
    marginTop: 2,
    marginBottom: 0,
    flexShrink: 0,
  },
  iconContainer: {
    height: 22,
    maxHeight: 22,
    minHeight: 0,
    overflow: 'hidden',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 18,
    lineHeight: 22,
  },
});
