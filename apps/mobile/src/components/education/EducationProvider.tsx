/**
 * One shared bottom sheet for the whole app.
 * Buttons dispatch a topic id; the root mounts a single EducationSheet.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { INDICATOR_EDUCATION, type EducationEntry } from '@chartsignl/core';
import { EducationSheet } from './EducationSheet';

interface EducationContextValue {
  open: (topicId: string) => void;
  close: () => void;
  activeTopic: string | null;
}

const EducationContext = createContext<EducationContextValue | null>(null);

export interface EducationProviderProps {
  children: React.ReactNode;
  onTopicOpened?: (topicId: string) => void;
}

export function EducationProvider({
  children,
  onTopicOpened,
}: EducationProviderProps) {
  const [activeTopic, setActiveTopic] = useState<string | null>(null);

  const open = useCallback(
    (topicId: string) => {
      if (!INDICATOR_EDUCATION[topicId]) {
        if (__DEV__) {
          console.warn(
            `[EducationProvider] Unknown topic "${topicId}". ` +
              `Valid ids: ${Object.keys(INDICATOR_EDUCATION).join(', ')}`
          );
        }
        return;
      }
      setActiveTopic(topicId);
      onTopicOpened?.(topicId);
    },
    [onTopicOpened]
  );

  const close = useCallback(() => setActiveTopic(null), []);

  const value = useMemo(
    () => ({ open, close, activeTopic }),
    [open, close, activeTopic]
  );

  const entry: EducationEntry | null = activeTopic
    ? INDICATOR_EDUCATION[activeTopic] ?? null
    : null;

  return (
    <EducationContext.Provider value={value}>
      {children}
      <EducationSheet
        entry={entry}
        visible={!!entry}
        onClose={close}
        onNavigate={open}
      />
    </EducationContext.Provider>
  );
}

export function useEducation(): EducationContextValue {
  const ctx = useContext(EducationContext);
  if (!ctx) {
    throw new Error(
      'useEducation must be used inside <EducationProvider>. ' +
        'Add it to apps/mobile/src/app/_layout.tsx.'
    );
  }
  return ctx;
}

export function useEducationOptional(): EducationContextValue | null {
  return useContext(EducationContext);
}
