import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Rocket,
  Lightning,
  CheckCircle,
  WarningCircle,
  ArrowSquareOut,
  CircleNotch,
  ClockCounterClockwise,
  Globe,
  ShieldCheck,
  Trash,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { GiftHistoryEntry } from '@/lib/types';

type ConnectionStatus = 'disconnected' | 'connected' | 'checking';
type RedemptionStatus = 'idle' | 'redeeming' | 'complete' | 'error';
type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

declare const chrome: any;

export function ExtensionPopup() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');
  const [redemptionStatus, setRedemptionStatus] = useState<RedemptionStatus>('idle');
  const [authStatus, setAuthStatus] = useState<AuthStatus>('unknown');
  const [progress, setProgress] = useState(0);
  const [giftsRedeemed, setGiftsRedeemed] = useState(0);
  const [totalGifts, setTotalGifts] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [giftHistory, setGiftHistory] = useState<GiftHistoryEntry[]>([]);

  useEffect(() => {
    loadHistory();
    checkCurrentTab();
    
    const interval = setInterval(() => {
      checkAuthStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const loadHistory = async () => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      const result = await chrome.storage.local.get(['giftHistory']);
      if (result.giftHistory) {
        setGiftHistory(result.giftHistory);
      }
    }
  };

  const saveHistory = async (history: GiftHistoryEntry[]) => {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      await chrome.storage.local.set({ giftHistory: history });
      setGiftHistory(history);
    }
  };

  const checkCurrentTab = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url?.includes('startrekfleetcommand.com')) {
        setConnectionStatus('connected');
        checkAuthStatus();
      } else {
        setConnectionStatus('disconnected');
      }
    } catch (error) {
      setConnectionStatus('disconnected');
    }
  };

  const checkAuthStatus = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const loginButtons = document.querySelectorAll('[href*="login"], button[class*="login"], a[class*="signin"]');
          const userElements = document.querySelectorAll('[class*="user"], [class*="profile"], [class*="avatar"]');
          return {
            hasUserElements: userElements.length > 0,
            hasLoginButtons: loginButtons.length > 0
          };
        }
      });

      if (result && result[0]?.result) {
        const { hasUserElements, hasLoginButtons } = result[0].result;
        if (hasUserElements && !hasLoginButtons) {
          setAuthStatus('authenticated');
        } else if (hasLoginButtons) {
          setAuthStatus('unauthenticated');
        }
      }
    } catch (error) {
      console.warn('Cannot check auth status:', error);
    }
  };

  const openStore = async () => {
    await chrome.tabs.create({ url: 'https://home.startrekfleetcommand.com/store' });
  };

  const handleRedeemAll = async () => {
    setRedemptionStatus('redeeming');
    setProgress(0);
    setGiftsRedeemed(0);
    setErrorMessage(null);

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab?.id) {
        throw new Error('No active tab found');
      }

      if (!tab.url?.includes('startrekfleetcommand.com')) {
        throw new Error('Please navigate to the STFC store first');
      }

      const result = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async () => {
          const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
          
          const giftSelectors = [
            'button:not([disabled])',
            '[class*="gift"]',
            '[class*="free"]',
            '[class*="claim"]',
            '[class*="redeem"]',
            '[data-testid*="gift"]',
            '[data-testid*="claim"]',
            'a[href*="gift"]',
            'div[role="button"]',
          ];

          const allButtons: HTMLElement[] = [];
          
          for (const selector of giftSelectors) {
            try {
              const elements = document.querySelectorAll(selector);
              elements.forEach((el) => {
                const element = el as HTMLElement;
                const text = element.textContent?.toLowerCase() || '';
                const className = element.className?.toLowerCase() || '';
                const id = element.id?.toLowerCase() || '';
                
                if (
                  (text.includes('gift') || 
                   text.includes('free') || 
                   text.includes('claim') || 
                   text.includes('redeem')) &&
                  !text.includes('buy') &&
                  !text.includes('purchase') &&
                  !allButtons.includes(element)
                ) {
                  allButtons.push(element);
                } else if (
                  className.includes('gift') || 
                  className.includes('free') || 
                  className.includes('claim') ||
                  id.includes('gift') ||
                  id.includes('claim')
                ) {
                  if (!allButtons.includes(element)) {
                    allButtons.push(element);
                  }
                }
              });
            } catch (e) {
              console.warn(`Selector ${selector} failed:`, e);
            }
          }

          const giftButtons = allButtons.filter((btn) => {
            const rect = btn.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });

          if (giftButtons.length === 0) {
            throw new Error('No gift buttons found');
          }

          const claimed: string[] = [];

          for (let i = 0; i < giftButtons.length; i++) {
            const button = giftButtons[i];
            
            try {
              button.scrollIntoView({ behavior: 'smooth', block: 'center' });
              await delay(500);
              
              button.click();
              await delay(1200);
              
              const confirmButtons = document.querySelectorAll('button, [role="button"], a');
              
              for (const confirmBtn of Array.from(confirmButtons)) {
                const text = (confirmBtn as HTMLElement).textContent?.toLowerCase() || '';
                if (
                  text.includes('confirm') ||
                  text.includes('accept') ||
                  text.includes('claim') ||
                  text.includes('yes')
                ) {
                  (confirmBtn as HTMLElement).click();
                  await delay(800);
                  break;
                }
              }
              
              const giftTitle = button.textContent?.trim() || 'Unknown Gift';
              claimed.push(giftTitle);
            } catch (btnError) {
              console.warn(`Failed to click button ${i + 1}:`, btnError);
            }
          }

          return {
            total: giftButtons.length,
            claimed: claimed
          };
        }
      });

      if (result && result[0]?.result) {
        const { total, claimed } = result[0].result;
        setTotalGifts(total);
        setGiftsRedeemed(claimed.length);
        setProgress(100);

        const newEntries: GiftHistoryEntry[] = claimed.map((title, idx) => ({
          id: `${Date.now()}-${idx}`,
          giftTitle: title.substring(0, 100),
          giftDescription: 'Claimed via browser extension',
          quantity: '1',
          claimedAt: new Date().toISOString(),
          category: 'permanent',
        }));

        const updatedHistory = [...newEntries, ...giftHistory];
        await saveHistory(updatedHistory);

        setRedemptionStatus('complete');
      }
    } catch (error) {
      setRedemptionStatus('error');
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setErrorMessage(message);
    }
  };

  const clearHistory = async () => {
    await saveHistory([]);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="h-full bg-background flex flex-col">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.25_0.08_240),transparent_50%),radial-gradient(circle_at_70%_60%,oklch(0.20_0.10_145),transparent_50%)] pointer-events-none" />

      <div className="relative z-10 flex flex-col h-full">
        <div className="p-4 border-b-2 border-primary/30 space-y-3 bg-card/95 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-lg border-2 border-primary/50">
              <Rocket weight="fill" className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-lg font-bold text-foreground tracking-tight">
                STFC Gift Redeemer
              </h1>
              <p className="text-xs text-muted-foreground">
                Browser Extension
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Badge
              variant="outline"
              className={cn(
                'uppercase tracking-wider text-xs font-medium border-2',
                connectionStatus === 'connected' &&
                  'bg-accent/20 border-accent/50 text-accent-foreground',
                connectionStatus === 'disconnected' &&
                  'bg-destructive/20 border-destructive/50 text-destructive-foreground',
                connectionStatus === 'checking' && 'bg-primary/20 border-primary/50 text-primary-foreground'
              )}
            >
              <Globe weight="fill" className="w-3 h-3 mr-1" />
              {connectionStatus}
            </Badge>

            {authStatus !== 'unknown' && (
              <Badge
                variant="outline"
                className={cn(
                  'uppercase tracking-wider text-xs font-medium border-2',
                  authStatus === 'authenticated' &&
                    'bg-accent/20 border-accent/50 text-accent-foreground',
                  authStatus === 'unauthenticated' &&
                    'bg-destructive/20 border-destructive/50 text-destructive-foreground'
                )}
              >
                <ShieldCheck weight="fill" className="w-3 h-3 mr-1" />
                {authStatus === 'authenticated' ? 'Logged In' : 'Not Logged In'}
              </Badge>
            )}
          </div>

          {connectionStatus === 'disconnected' && (
            <Alert variant="destructive" className="border-2">
              <WarningCircle weight="fill" className="w-4 h-4" />
              <AlertDescription className="text-xs">
                Please navigate to the STFC store first
              </AlertDescription>
            </Alert>
          )}

          {authStatus === 'authenticated' && (
            <Alert className="border-2 border-accent/50 bg-accent/10">
              <CheckCircle weight="fill" className="w-4 h-4 text-accent" />
              <AlertDescription className="text-xs text-accent-foreground">
                <strong>Authentication persisted!</strong> Your login session is maintained by the extension.
              </AlertDescription>
            </Alert>
          )}

          {errorMessage && (
            <Alert variant="destructive" className="border-2">
              <WarningCircle weight="fill" className="w-4 h-4" />
              <AlertDescription className="text-xs">{errorMessage}</AlertDescription>
            </Alert>
          )}

          {redemptionStatus === 'redeeming' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground font-medium">
                  Redeeming gifts...
                </span>
                <span className="font-mono font-semibold text-primary">
                  {giftsRedeemed} / {totalGifts}
                </span>
              </div>
              <Progress
                value={progress}
                className="h-2 bg-secondary [&>div]:bg-gradient-to-r [&>div]:from-primary [&>div]:to-accent [&>div]:shadow-[0_0_10px_rgba(100,181,246,0.5)]"
              />
            </div>
          )}

          {redemptionStatus === 'complete' && (
            <Alert className="border-2 border-accent/50 bg-accent/10">
              <CheckCircle weight="fill" className="w-4 h-4 text-accent" />
              <AlertDescription className="text-accent-foreground text-xs">
                Successfully redeemed {giftsRedeemed} gifts!
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Button
              onClick={handleRedeemAll}
              disabled={
                connectionStatus !== 'connected' ||
                redemptionStatus === 'redeeming' ||
                authStatus === 'unauthenticated'
              }
              className={cn(
                'w-full font-semibold tracking-wide transition-all duration-200',
                'bg-accent text-accent-foreground hover:bg-accent/90 hover:scale-105 active:scale-95',
                'shadow-[0_0_15px_rgba(125,232,168,0.4)] border-2 border-accent/50'
              )}
            >
              {redemptionStatus === 'redeeming' ? (
                <>
                  <CircleNotch className="w-5 h-5 mr-2 animate-spin" />
                  Redeeming...
                </>
              ) : (
                <>
                  <Lightning weight="fill" className="w-5 h-5 mr-2" />
                  Redeem All Gifts
                </>
              )}
            </Button>

            <Button
              onClick={openStore}
              variant="outline"
              className="w-full border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10 font-semibold text-xs"
            >
              <ArrowSquareOut weight="bold" className="w-4 h-4 mr-2" />
              Open STFC Store
            </Button>
          </div>
        </div>

        <Tabs defaultValue="history" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-full rounded-none border-b border-primary/30 bg-transparent h-auto p-0">
            <TabsTrigger 
              value="history" 
              className="flex-1 rounded-none data-[state=active]:bg-primary/10 data-[state=active]:border-b-2 data-[state=active]:border-primary py-2"
            >
              <ClockCounterClockwise weight="fill" className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="history" className="flex-1 overflow-hidden m-0 p-0 flex flex-col">
            <div className="p-4 border-b border-primary/30">
              <Button
                onClick={clearHistory}
                variant="outline"
                size="sm"
                className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 text-xs"
              >
                <Trash weight="bold" className="w-3 h-3 mr-2" />
                Clear History
              </Button>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-3">
                {giftHistory.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <ClockCounterClockwise weight="fill" className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p className="text-sm">No gifts redeemed yet</p>
                  </div>
                ) : (
                  giftHistory.map((entry) => (
                    <Card key={entry.id} className="p-3 border-2 border-primary/20 bg-card/80">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm text-foreground line-clamp-2">
                            {entry.giftTitle}
                          </h3>
                          <Badge variant="outline" className="text-xs uppercase shrink-0">
                            {entry.category}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1">
                          {entry.giftDescription}
                        </p>
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span className="font-mono">Qty: {entry.quantity}</span>
                          <span>{formatDate(entry.claimedAt)}</span>
                        </div>
                      </div>
                    </Card>
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
