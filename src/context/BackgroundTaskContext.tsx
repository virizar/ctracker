import React, { createContext, useContext, useState, useRef, useEffect, ReactNode } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export interface BackgroundTaskProgress {
  current: number;
  total: number;
}

export interface BackgroundTaskInfo {
  id: string;
  title: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  progress?: BackgroundTaskProgress;
  message?: string;
  canStop?: boolean;
}

interface StartTaskParams {
  id: string;
  title: string;
  progress?: BackgroundTaskProgress;
  canStop?: boolean;
  onStop?: () => void;
}

interface BackgroundTaskContextType {
  activeTask: BackgroundTaskInfo | null;
  startTask: (params: StartTaskParams) => AbortController;
  updateProgress: (progress: BackgroundTaskProgress, message?: string) => void;
  stopTask: () => void;
  completeTask: (resultMessage?: string) => void;
  failTask: (errorMessage?: string) => void;
  isTaskRunning: (id?: string) => boolean;
}

const BackgroundTaskContext = createContext<BackgroundTaskContextType | undefined>(undefined);

export function BackgroundTaskProvider({ children }: { children: ReactNode }) {
  const [activeTask, setActiveTask] = useState<BackgroundTaskInfo | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const onStopCallbackRef = useRef<(() => void) | null>(null);
  const currentTaskIdRef = useRef<string | null>(null);
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);

  const clearDismissTimer = () => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const startTask = ({ id, title, progress, canStop = true, onStop }: StartTaskParams): AbortController => {
    clearDismissTimer();

    // If an existing task is running with a wake lock, release it first
    if (currentTaskIdRef.current && currentTaskIdRef.current !== id) {
      deactivateKeepAwake(currentTaskIdRef.current).catch(() => {});
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    onStopCallbackRef.current = onStop || null;
    currentTaskIdRef.current = id;

    // Keep screen awake while this task is running
    activateKeepAwakeAsync(id).catch((err) => {
      console.warn(`[BackgroundTask] Could not activate wake lock for ${id}:`, err);
    });

    setActiveTask({
      id,
      title,
      status: 'running',
      progress: progress || { current: 0, total: 0 },
      canStop,
    });

    return controller;
  };

  const updateProgress = (progress: BackgroundTaskProgress, message?: string) => {
    setActiveTask((prev) => {
      if (!prev || prev.status !== 'running') return prev;
      return {
        ...prev,
        progress,
        message: message !== undefined ? message : prev.message,
      };
    });
  };

  const stopTask = () => {
    const taskId = currentTaskIdRef.current;
    if (taskId) {
      deactivateKeepAwake(taskId).catch(() => {});
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    if (onStopCallbackRef.current) {
      try {
        onStopCallbackRef.current();
      } catch (e) {
        console.warn('[BackgroundTask] Error in onStop callback:', e);
      }
    }

    setActiveTask((prev) => (prev ? { ...prev, status: 'stopped', message: 'Stopped' } : null));

    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      setActiveTask(null);
      currentTaskIdRef.current = null;
      abortControllerRef.current = null;
      onStopCallbackRef.current = null;
    }, 2000);
  };

  const completeTask = (resultMessage?: string) => {
    const taskId = currentTaskIdRef.current;
    if (taskId) {
      deactivateKeepAwake(taskId).catch(() => {});
    }

    setActiveTask((prev) =>
      prev
        ? {
            ...prev,
            status: 'completed',
            message: resultMessage || 'Done!',
          }
        : null
    );

    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      setActiveTask(null);
      currentTaskIdRef.current = null;
      abortControllerRef.current = null;
      onStopCallbackRef.current = null;
    }, 3500);
  };

  const failTask = (errorMessage?: string) => {
    const taskId = currentTaskIdRef.current;
    if (taskId) {
      deactivateKeepAwake(taskId).catch(() => {});
    }

    setActiveTask((prev) =>
      prev
        ? {
            ...prev,
            status: 'error',
            message: errorMessage || 'Failed',
          }
        : null
    );

    clearDismissTimer();
    dismissTimerRef.current = setTimeout(() => {
      setActiveTask(null);
      currentTaskIdRef.current = null;
      abortControllerRef.current = null;
      onStopCallbackRef.current = null;
    }, 4000);
  };

  const isTaskRunning = (id?: string) => {
    if (!activeTask || activeTask.status !== 'running') return false;
    if (id) return activeTask.id === id;
    return true;
  };

  // Cleanup wake locks on unmount
  useEffect(() => {
    return () => {
      clearDismissTimer();
      if (currentTaskIdRef.current) {
        deactivateKeepAwake(currentTaskIdRef.current).catch(() => {});
      }
    };
  }, []);

  return (
    <BackgroundTaskContext.Provider
      value={{
        activeTask,
        startTask,
        updateProgress,
        stopTask,
        completeTask,
        failTask,
        isTaskRunning,
      }}
    >
      {children}
    </BackgroundTaskContext.Provider>
  );
}

export function useBackgroundTask() {
  const context = useContext(BackgroundTaskContext);
  if (!context) {
    throw new Error('useBackgroundTask must be used within a BackgroundTaskProvider');
  }
  return context;
}
