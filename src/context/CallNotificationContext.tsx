import React, { createContext, useContext, useState, ReactNode } from 'react';
import type { CallDetailSnapshot } from '@/components/dashboard/callDetailSnapshot';

interface CallNotificationContextType {
  selectedCall: CallDetailSnapshot | null;
  setSelectedCall: (call: CallDetailSnapshot | null) => void;
}

const CallNotificationContext = createContext<CallNotificationContextType | undefined>(undefined);

export function CallNotificationProvider({ children }: { children: ReactNode }) {
  const [selectedCall, setSelectedCall] = useState<CallDetailSnapshot | null>(null);

  return (
    <CallNotificationContext.Provider value={{ selectedCall, setSelectedCall }}>
      {children}
    </CallNotificationContext.Provider>
  );
}

export function useCallNotification() {
  const context = useContext(CallNotificationContext);
  if (context === undefined) {
    throw new Error('useCallNotification must be used within a CallNotificationProvider');
  }
  return context;
}
