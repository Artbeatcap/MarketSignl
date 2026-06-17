import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { publicFetch } from '../lib/api';
import './Login.css';

type Step = 'email' | 'password';
type AccountStatus = 'unknown' | 'exists' | 'new';

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/terminal';

  const [step, setStep] = useState<Step>('email');
  const [accountStatus, setAccountStatus] = useState<AccountStatus>('unknown');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!normalizedEmail) {
      setError('Please enter your email');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setError('Please enter a valid email address');
      return;
    }

    setIsCheckingEmail(true);
    setError(null);
    setMessage(null);

    try {
      let exists = false;
      try {
        const data = await publicFetch<{ exists?: boolean }>('/api/auth/check-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: normalizedEmail }),
        });
        exists = data.exists === true;
      } catch {
        // Default to sign-up flow if check fails
      }

      setAccountStatus(exists ? 'exists' : 'new');
      setStep('password');
    } finally {
      setIsCheckingEmail(false);
    }
  };

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (signInError) throw signInError;
      if (!data.session) throw new Error('Sign in failed');

      navigate(redirect, { replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign in failed';
      if (msg.toLowerCase().includes('invalid login credentials')) {
        setError('Incorrect password. Please try again.');
      } else if (msg.toLowerCase().includes('email not confirmed')) {
        setError('Please verify your email before signing in.');
      } else {
        setError(msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
      });

      if (signUpError) {
        if (signUpError.message.toLowerCase().includes('already registered')) {
          setAccountStatus('exists');
          setConfirmPassword('');
          setError('This email is already registered. Please sign in instead.');
          return;
        }
        throw signUpError;
      }

      if (data.session) {
        navigate(redirect, { replace: true });
        return;
      }

      setMessage('Account created! Check your email to verify, then sign in.');
      setAccountStatus('exists');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!normalizedEmail) {
      setError('Enter your email first');
      return;
    }

    setIsLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${window.location.origin}/login`,
      });
      if (resetError) throw resetError;
      setMessage('Password reset email sent. Check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset email');
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendVerification = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: normalizedEmail,
      });
      if (resendError) throw resendError;
      setMessage('Verification email sent. Check your inbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send verification email');
    } finally {
      setIsLoading(false);
    }
  };

  const backToEmail = () => {
    setStep('email');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setMessage(null);
    setAccountStatus('unknown');
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <Link to="/" className="login-logo">
          MarketSignl
        </Link>

        {step === 'email' && (
          <>
            <h1>Welcome</h1>
            <p className="login-subtitle">Enter your email to sign in or create an account</p>
            <form onSubmit={handleEmailSubmit} className="login-form">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setError(null);
                }}
                disabled={isCheckingEmail}
              />
              {error && <p className="login-error">{error}</p>}
              <button type="submit" className="login-primary" disabled={isCheckingEmail || !email.trim()}>
                {isCheckingEmail ? 'Checking…' : 'Continue'}
              </button>
            </form>
          </>
        )}

        {step === 'password' && accountStatus === 'exists' && (
          <>
            <button type="button" className="login-back" onClick={backToEmail}>
              ← Back
            </button>
            <h1>Welcome back</h1>
            <p className="login-subtitle">
              Sign in as <strong>{normalizedEmail}</strong>
            </p>
            <form onSubmit={handleSignIn} className="login-form">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                disabled={isLoading}
                autoFocus
              />
              <button type="button" className="login-link-btn" onClick={handleForgotPassword} disabled={isLoading}>
                Forgot password?
              </button>
              {error && (
                <div>
                  <p className="login-error">{error}</p>
                  {error.toLowerCase().includes('verify') && (
                    <button type="button" className="login-link-btn" onClick={handleResendVerification} disabled={isLoading}>
                      Resend verification email
                    </button>
                  )}
                </div>
              )}
              {message && <p className="login-message">{message}</p>}
              <button type="submit" className="login-primary" disabled={isLoading || !password}>
                {isLoading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          </>
        )}

        {step === 'password' && accountStatus === 'new' && (
          <>
            <button type="button" className="login-back" onClick={backToEmail}>
              ← Back
            </button>
            <h1>Create your account</h1>
            <p className="login-subtitle">
              Set a password for <strong>{normalizedEmail}</strong>
            </p>
            <form onSubmit={handleSignUp} className="login-form">
              <label htmlFor="new-password">Password</label>
              <input
                id="new-password"
                type="password"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                disabled={isLoading}
                autoFocus
              />
              <label htmlFor="confirm-password">Confirm password</label>
              <input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError(null);
                }}
                disabled={isLoading}
              />
              {error && <p className="login-error">{error}</p>}
              {message && <p className="login-message">{message}</p>}
              <button
                type="submit"
                className="login-primary"
                disabled={isLoading || !password || !confirmPassword}
              >
                {isLoading ? 'Creating account…' : 'Create Account'}
              </button>
            </form>
            <p className="login-terms">
              By creating an account, you agree to our Terms of Service and Privacy Policy.
            </p>
          </>
        )}

        <p className="login-footer">
          <Link to={redirect}>Continue without signing in</Link>
        </p>
      </div>
    </div>
  );
}
