// API Request/Response Types

import type { ChartAnalysis, AnalysisHistoryItem } from './chartAnalysis';
import type { UserProfile } from './user';

// Auth
export interface AuthResponse {
  success: boolean;
  user?: UserProfile;
  error?: string;
}

// Analyze Chart
export interface AnalyzeChartRequest {
  // File is sent as multipart form data
}

export interface AnalyzeChartResponse {
  success: boolean;
  analysisId?: string;
  analysis?: ChartAnalysis;
  error?: string;
}

// Get Analysis History
export interface GetHistoryRequest {
  page?: number;
  limit?: number;
}

export interface GetHistoryResponse {
  success: boolean;
  analyses?: AnalysisHistoryItem[];
  total?: number;
  hasMore?: boolean;
  error?: string;
}

// Get Single Analysis
export interface GetAnalysisResponse {
  success: boolean;
  analysis?: ChartAnalysis;
  createdAt?: string;
  predictionId?: string;
  error?: string;
}

// Usage
export interface UsageResponse {
  success: boolean;
  freeAnalysesUsed?: number;
  freeAnalysesLimit?: number;
  freePredictionsUsed?: number;
  freePredictionsLimit?: number;
  isPro?: boolean;
  error?: string;
}

// Generic API Error
export interface ApiError {
  success: false;
  error: string;
  code?: string;
}
