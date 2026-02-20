import { Platform } from 'react-native';

// Shared API configuration
// This ensures consistent API URL usage across the app
// Auto-detect local development: if running on localhost, use local backend
// On React Native, window exists but window.location is undefined — guard both so native skips browser logic
const hasWindow = typeof window !== 'undefined' && typeof window.location !== 'undefined';
const hostname = hasWindow ? window.location.hostname : '';
const origin = hasWindow ? window.location.origin : '';

const isLocalDev = hasWindow && (hostname === 'localhost' || hostname === '127.0.0.1');

// Determine API URL: env var takes precedence, then check if we're on localhost
// In production builds, EXPO_PUBLIC_API_URL should be set to https://api.chartsignl.com
// If env var is set to localhost but we're on a production domain, override it
let API_URL = process.env.EXPO_PUBLIC_API_URL ||
  (isLocalDev ? 'http://localhost:4000' : 'https://api.chartsignl.com');

// Safety check: only on web. On native, hostname is empty so !isProductionDomain would be true
// and we'd wrongly override prod API to localhost, breaking all API calls.
if (hasWindow && Platform.OS === 'web') {
  const isProductionDomain =
    hostname.includes('chartsignl.com') || hostname.includes('app.chartsignl.com') || hostname.includes('www.chartsignl.com');
  const isLocalhostUrl =
    API_URL &&
    (API_URL.includes('localhost') ||
      API_URL.includes('127.0.0.1') ||
      API_URL.startsWith('http://localhost') ||
      API_URL.startsWith('http://127.0.0.1'));

  // If we're on production but API_URL is localhost, force override
  if (isProductionDomain && isLocalhostUrl) {
    console.warn('[API Config] Overriding localhost API URL for production domain:', API_URL, '-> https://api.chartsignl.com');
    console.warn('[API Config] Hostname:', hostname, 'Origin:', origin);
    API_URL = 'https://api.chartsignl.com';
  }

  // If we're NOT on production domain but API_URL points to production, prefer local backend.
  // This prevents web dev/staging hosts (LAN IP, preview domains, etc.) from silently using prod API.
  const isProdApi = API_URL.includes('api.chartsignl.com');
  if (!isProductionDomain && isProdApi) {
    const overridden = 'http://localhost:4000';
    console.warn('[API Config] Overriding production API URL for non-production host:', API_URL, '->', overridden);
    console.warn('[API Config] Hostname:', hostname, 'Origin:', origin);
    API_URL = overridden;
  }
}

export { API_URL };
