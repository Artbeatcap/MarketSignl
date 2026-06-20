import { create } from 'zustand';
import type {
  OnboardingAnswers,
  TradingStyle,
  ExperienceLevel,
  StressReducer,
} from '@chartsignl/core';

interface OnboardingState {
  answers: OnboardingAnswers;
  currentStep: number;
  totalSteps: number;
  
  // Actions
  setTradingStyle: (style: TradingStyle) => void;
  setExperienceLevel: (level: ExperienceLevel) => void;
  setStressReducer: (reducer: StressReducer) => void;
  setDisplayName: (name: string) => void;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  reset: () => void;
}

const initialAnswers: OnboardingAnswers = {
  tradingStyle: null,
  experienceLevel: null,
  stressReducer: null,
  displayName: '',
};

export const useOnboardingStore = create<OnboardingState>((set) => ({
  answers: initialAnswers,
  currentStep: 0,
  totalSteps: 5, // Welcome, Style, Experience, StressReducer, Account

  setTradingStyle: (style) =>
    set((state) => ({
      answers: { ...state.answers, tradingStyle: style },
    })),

  setExperienceLevel: (level) =>
    set((state) => ({
      answers: { ...state.answers, experienceLevel: level },
    })),

  setStressReducer: (reducer) =>
    set((state) => ({
      answers: { ...state.answers, stressReducer: reducer },
    })),

  setDisplayName: (displayName) =>
    set((state) => ({
      answers: { ...state.answers, displayName },
    })),

  nextStep: () =>
    set((state) => ({
      currentStep: Math.min(state.currentStep + 1, state.totalSteps - 1),
    })),

  prevStep: () =>
    set((state) => ({
      currentStep: Math.max(state.currentStep - 1, 0),
    })),

  goToStep: (step) =>
    set((state) => ({
      currentStep: Math.max(0, Math.min(step, state.totalSteps - 1)),
    })),

  reset: () =>
    set({
      answers: initialAnswers,
      currentStep: 0,
    }),
}));
