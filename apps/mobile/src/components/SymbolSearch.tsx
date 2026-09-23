import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { colors, typography, spacing, borderRadius, shadows } from '../theme';
import { API_URL } from '../lib/apiConfig';
import { SafeAreaView } from 'react-native-safe-area-context';

// Popular symbols for quick access
const POPULAR_SYMBOLS = [
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'CS' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'CS' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', type: 'CS' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'CS' },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: 'CS' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'CS' },
  { symbol: 'META', name: 'Meta Platforms Inc.', type: 'CS' },
  { symbol: 'SPY', name: 'S&P 500 ETF', type: 'ETF' },
  { symbol: 'QQQ', name: 'Nasdaq 100 ETF', type: 'ETF' },
  { symbol: 'AMD', name: 'Advanced Micro Devices', type: 'CS' },
  { symbol: 'NFLX', name: 'Netflix Inc.', type: 'CS' },
  { symbol: 'DIS', name: 'Walt Disney Co.', type: 'CS' },
];

interface SearchResult {
  symbol: string;
  name: string;
  type: string;
  market?: string;
  exchange?: string;
}

interface SymbolSearchProps {
  visible: boolean;
  onClose: () => void;
  onSelectSymbol: (symbol: string, name: string) => void;
  currentSymbol?: string;
}

export function SymbolSearch({
  visible,
  onClose,
  onSelectSymbol,
  currentSymbol,
}: SymbolSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTimeout, setSearchTimeout] = useState<NodeJS.Timeout | null>(null);

  // Search using our backend (which uses Polygon.io)
  const searchSymbols = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || searchQuery.length < 1) {
      setResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch(
        `${API_URL}/api/market-data/search/${encodeURIComponent(searchQuery)}`
      );
      
      if (!response.ok) {
        throw new Error('Search failed');
      }

      const data = await response.json();
      setResults(data.results || []);
    } catch (error) {
      console.error('Symbol search error:', error);
      // Fallback to filtering popular symbols locally
      const filtered = POPULAR_SYMBOLS.filter(
        (s) =>
          s.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setResults(filtered);
    } finally {
      setIsSearching(false);
    }
  }, []);

  // Debounced search
  const handleQueryChange = (text: string) => {
    setQuery(text);
    
    // Clear existing timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }

    // Set new debounced search
    const timeout = setTimeout(() => {
      searchSymbols(text);
    }, 300);
    
    setSearchTimeout(timeout);
  };

  const handleSelectSymbol = (symbol: string, name: string) => {
    onSelectSymbol(symbol, name);
    setQuery('');
    setResults([]);
    onClose();
  };

  const renderSearchResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelectSymbol(item.symbol, item.name)}
    >
      <View style={styles.resultLeft}>
        <Text style={styles.resultSymbol}>{item.symbol}</Text>
        <Text style={styles.resultName} numberOfLines={1}>
          {item.name}
        </Text>
      </View>
      <View style={styles.resultRight}>
        <Text style={styles.resultType}>{item.type}</Text>
        {item.exchange && (
          <Text style={styles.resultExchange}>{item.exchange}</Text>
        )}
      </View>
    </TouchableOpacity>
  );

  const renderPopularSymbol = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity
      style={[
        styles.popularItem,
        currentSymbol === item.symbol && styles.popularItemActive,
      ]}
      onPress={() => handleSelectSymbol(item.symbol, item.name)}
    >
      <Text
        style={[
          styles.popularSymbol,
          currentSymbol === item.symbol && styles.popularSymbolActive,
        ]}
      >
        {item.symbol}
      </Text>
      <Text style={styles.popularName} numberOfLines={1}>
        {item.name}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Search Symbol</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Search Input */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search stocks, ETFs..."
            placeholderTextColor={colors.neutral[400]}
            value={query}
            onChangeText={handleQueryChange}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />
          {isSearching && (
            <ActivityIndicator
              size="small"
              color={colors.primary[500]}
              style={styles.searchLoader}
            />
          )}
        </View>

        {/* Results or Popular */}
        {query.trim() ? (
          <FlatList
            data={results}
            renderItem={renderSearchResult}
            keyExtractor={(item) => item.symbol}
            style={styles.resultsList}
            ListEmptyComponent={
              !isSearching ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No results found</Text>
                  <Text style={styles.emptyHint}>Try searching for a stock symbol or company name</Text>
                </View>
              ) : null
            }
          />
        ) : (
          <View style={styles.popularSection}>
            <Text style={styles.sectionTitle}>Popular Stocks</Text>
            <FlatList
              data={POPULAR_SYMBOLS}
              renderItem={renderPopularSymbol}
              keyExtractor={(item) => item.symbol}
              numColumns={2}
              columnWrapperStyle={styles.popularRow}
            />
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[200],
  },
  title: {
    ...typography.headingLg,
    color: colors.neutral[900],
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 20,
    color: colors.neutral[500],
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.neutral[200],
    ...shadows.sm,
  },
  searchInput: {
    flex: 1,
    height: 52,
    paddingHorizontal: spacing.md,
    ...typography.bodyMd,
    color: colors.neutral[900],
  },
  searchLoader: {
    marginRight: spacing.md,
  },
  resultsList: {
    flex: 1,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  resultLeft: {
    flex: 1,
    marginRight: spacing.md,
  },
  resultSymbol: {
    ...typography.headingSm,
    color: colors.neutral[900],
  },
  resultName: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginTop: 2,
  },
  resultRight: {
    alignItems: 'flex-end',
  },
  resultExchange: {
    ...typography.labelSm,
    color: colors.primary[600],
  },
  resultType: {
    ...typography.labelSm,
    color: colors.neutral[400],
    textTransform: 'capitalize',
  },
  popularSection: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  sectionTitle: {
    ...typography.labelLg,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  popularRow: {
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  popularItem: {
    width: '48%',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.neutral[200],
  },
  popularItemActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  popularSymbol: {
    ...typography.headingSm,
    color: colors.neutral[900],
  },
  popularSymbolActive: {
    color: colors.primary[700],
  },
  popularName: {
    ...typography.bodySm,
    color: colors.neutral[500],
    marginTop: 2,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    ...typography.bodyMd,
    color: colors.neutral[500],
  },
  emptyHint: {
    ...typography.bodySm,
    color: colors.neutral[400],
    marginTop: spacing.xs,
    textAlign: 'center',
  },
});
