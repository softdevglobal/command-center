import { useRef, useState, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useDashboard } from '@/context/DashboardDataContext';
import { useCallNotification } from '@/context/CallNotificationContext';
import { CallDetailsSheet } from '@/components/dashboard/CallDetailsSheet';
import { buildIncomingCallSnapshot } from '@/components/dashboard/callDetailSnapshot';
import { Card } from '@/components/ui/card';
import { Phone, ExternalLink, GripVertical } from 'lucide-react';
import { formatPhone } from '@/utils/formatters';
import { Button } from '@/components/ui/button';

export function GlobalCallMonitor() {
  const { incomingCalls, now } = useDashboard();
  const { selectedCall, setSelectedCall } = useCallNotification();

  // Position state for the draggable card
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const { pathname } = useLocation();
  const isBookingPage = pathname === '/booking' || pathname.startsWith('/bookings');

  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    const card = (e.currentTarget as HTMLElement).closest('.draggable-card');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    
    // Drag delta from default anchor: top center (top-6), card w-80 (320px)
    const cardWidth = 320;
    const anchorLeft = window.innerWidth / 2 - cardWidth / 2;
    const anchorTop = 24;
    const newX = e.clientX - anchorLeft - dragOffset.current.x;
    const newY = e.clientY - anchorTop - dragOffset.current.y;
    
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const showFloatingCard = incomingCalls.length > 0;

  const longestWaitMs = useMemo(() => {
    if (incomingCalls.length === 0) return 0;
    return Math.max(
      0,
      ...incomingCalls.map((c) => now - c.waitingSince),
    );
  }, [incomingCalls, now]);

  if (isBookingPage) return null;

  return (
    <>
      {showFloatingCard && (
        <div 
          className="fixed left-1/2 top-6 z-[100] animate-in fade-in slide-in-from-top-4 duration-300 draggable-card"
          style={{
            transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
            touchAction: 'none'
          }}
        >
          <Card className="w-80 overflow-hidden border-2 border-amber-500/50 bg-white shadow-2xl ring-4 ring-amber-500/10 transition-shadow hover:shadow-amber-500/20">
            <div className="relative p-4">
              <div 
                className="absolute top-2 right-2 cursor-grab active:cursor-grabbing p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
              >
                <GripVertical className="h-4 w-4" />
              </div>

              <div className="flex items-start gap-4 pr-7">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 animate-pulse">
                  <Phone className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-600 mb-0.5">
                    {incomingCalls.length === 1
                      ? 'Incoming Call'
                      : `Incoming Calls (${incomingCalls.length})`}
                  </p>
                  {incomingCalls.length === 1 ? (
                    <>
                      <h3 className="truncate font-mono text-lg font-bold text-slate-900">
                        {formatPhone(incomingCalls[0].callerNumber)}
                      </h3>
                      {incomingCalls[0].callerName && (
                        <p className="truncate text-sm text-slate-500">
                          {incomingCalls[0].callerName}
                        </p>
                      )}
                    </>
                  ) : (
                    <ul className="mt-1 max-h-[min(40vh,14rem)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                      {incomingCalls.map((call) => (
                        <li
                          key={call.id}
                          className="rounded-lg border border-amber-200/60 bg-amber-50/40 px-2.5 py-2"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-mono text-[13px] font-bold leading-tight text-slate-900">
                                {formatPhone(call.callerNumber)}
                              </p>
                              {call.callerName && (
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  {call.callerName}
                                </p>
                              )}
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 shrink-0 border-amber-300 bg-white px-2 text-amber-800 hover:bg-amber-100"
                              aria-label={`View details for ${formatPhone(call.callerNumber)}`}
                              onClick={() =>
                                setSelectedCall(
                                  buildIncomingCallSnapshot(call, now),
                                )
                              }
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              
              {incomingCalls.length === 1 && (
                <div className="mt-4 flex gap-2">
                  <Button 
                    onClick={() =>
                      setSelectedCall(
                        buildIncomingCallSnapshot(incomingCalls[0], now),
                      )
                    }
                    className="flex-1 bg-amber-500 text-white hover:bg-amber-600 shadow-lg shadow-amber-200"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View Details
                  </Button>
                </div>
              )}

              <div className="absolute bottom-0 left-0 h-1 bg-amber-100 w-full overflow-hidden">
                <div 
                  className="h-full bg-amber-500 transition-all duration-1000 ease-linear"
                  style={{
                    width: `${Math.min(100, (longestWaitMs / 30000) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </Card>
        </div>
      )}

      <CallDetailsSheet
        detail={selectedCall}
        open={Boolean(selectedCall)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedCall(null);
          }
        }}
      />
    </>
  );
}
