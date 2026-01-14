import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import {
  Rocket,
  Gift,
  Lightning,
  CheckCircle,
  WarningCircle,
  ArrowSquareOut,
  CaretDown,
  CaretUp,
  CircleNotch,
} from '@phosphor-icons/react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ScriptGenerator } from '@/components/ScriptGenerator';

type ConnectionStatus = 'disconnected' | 'connected' | 'loading';
type RedemptionStatus = 'idle' | 'redeeming' | 'complete' | 'error';

function App() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [redemptionStatus, setRedemptionStatus] = useState<RedemptionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [giftsRedeemed, setGiftsRedeemed] = useState(0);
  const [totalGifts, setTotalGifts] = useState(0);
  const [isPanelExpanded, setIsPanelExpanded] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const STORE_URL = 'https://home.startrekfleetcommand.com/store';

  const handleIframeLoad = () => {
    setConnectionStatus('connected');
    toast.success('Store Connected', {
      description: 'Ready to redeem gifts',
    });
  };

  const handleIframeError = () => {
    setConnectionStatus('disconnected');
    setErrorMessage('Failed to load store. The site may block embedding or have CORS restrictions.');
    toast.error('Connection Failed', {
      description: 'Unable to load the STFC store',
    });
  };

  const handleRedeemAll = async () => {
    setRedemptionStatus('redeeming');
    setProgress(0);
    setGiftsRedeemed(0);
    setErrorMessage(null);

    try {
      const iframe = iframeRef.current;
      if (!iframe || !iframe.contentWindow) {
        throw new Error('Store not loaded');
      }

      toast.info('Scanning for gifts...', {
        description: 'Looking for available free gifts',
      });

      const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
      
      if (!iframeDoc) {
        throw new Error('Cannot access store content. Cross-origin restrictions may apply.');
      }

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
          const elements = iframeDoc.querySelectorAll(selector);
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
        throw new Error('No gift buttons found. Make sure you are logged in to the STFC store.');
      }

      setTotalGifts(giftButtons.length);
      
      toast.info(`Found ${giftButtons.length} potential gifts`, {
        description: 'Starting redemption process...',
      });

      for (let i = 0; i < giftButtons.length; i++) {
        const button = giftButtons[i];
        
        try {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await new Promise((resolve) => setTimeout(resolve, 500));
          
          button.click();
          
          await new Promise((resolve) => setTimeout(resolve, 1200));
          
          const confirmButtons = iframeDoc.querySelectorAll(
            'button, [role="button"], a'
          );
          
          for (const confirmBtn of Array.from(confirmButtons)) {
            const text = (confirmBtn as HTMLElement).textContent?.toLowerCase() || '';
            if (
              text.includes('confirm') ||
              text.includes('accept') ||
              text.includes('claim') ||
              text.includes('yes')
            ) {
              (confirmBtn as HTMLElement).click();
              await new Promise((resolve) => setTimeout(resolve, 800));
              break;
            }
          }
          
          setGiftsRedeemed(i + 1);
          setProgress(((i + 1) / giftButtons.length) * 100);
          
          toast.success(`Gift ${i + 1} claimed`, {
            description: `${giftButtons.length - i - 1} remaining`,
          });
        } catch (btnError) {
          console.warn(`Failed to click button ${i + 1}:`, btnError);
        }
      }

      setRedemptionStatus('complete');
      toast.success('All Gifts Processed!', {
        description: `Attempted to claim ${giftButtons.length} gifts`,
      });
    } catch (error) {
      setRedemptionStatus('error');
      const message = error instanceof Error ? error.message : 'Unknown error occurred';
      setErrorMessage(message);
      toast.error('Redemption Failed', {
        description: message,
      });
    }
  };

  const openInNewTab = () => {
    window.open(STORE_URL, '_blank');
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.25_0.08_240),transparent_50%),radial-gradient(circle_at_70%_60%,oklch(0.20_0.10_145),transparent_50%)] pointer-events-none" />

      <div className="relative z-10 m-4 md:m-6 space-y-4">
        <Card
          className={cn(
            'backdrop-blur-xl bg-card/90 border-2 border-primary/30 shadow-[0_4px_20px_rgba(100,181,246,0.2)] transition-all duration-300',
            !isPanelExpanded && 'pb-2'
          )}
        >
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="bg-primary/20 p-2 rounded-lg border-2 border-primary/50">
                  <Rocket weight="fill" className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                </div>
                <div>
                  <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
                    STFC Gift Redeemer
                  </h1>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    Automated Fleet Command Store
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'uppercase tracking-wider text-xs font-medium border-2',
                    connectionStatus === 'connected' &&
                      'bg-accent/20 border-accent/50 text-accent-foreground',
                    connectionStatus === 'disconnected' &&
                      'bg-destructive/20 border-destructive/50 text-destructive-foreground',
                    connectionStatus === 'loading' && 'bg-primary/20 border-primary/50 text-primary-foreground'
                  )}
                >
                  {connectionStatus === 'connected' && <CheckCircle weight="fill" className="w-3 h-3 mr-1" />}
                  {connectionStatus === 'disconnected' && <WarningCircle weight="fill" className="w-3 h-3 mr-1" />}
                  {connectionStatus === 'loading' && <CircleNotch className="w-3 h-3 mr-1 animate-spin" />}
                  {connectionStatus}
                </Badge>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsPanelExpanded(!isPanelExpanded)}
                  className="border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10"
                >
                  {isPanelExpanded ? (
                    <CaretUp weight="bold" className="w-5 h-5" />
                  ) : (
                    <CaretDown weight="bold" className="w-5 h-5" />
                  )}
                </Button>
              </div>
            </div>

            {isPanelExpanded && (
              <div className="mt-6 space-y-4">
                {errorMessage && (
                  <Alert variant="destructive" className="border-2">
                    <WarningCircle weight="fill" className="w-4 h-4" />
                    <AlertDescription>{errorMessage}</AlertDescription>
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
                    <AlertDescription className="text-accent-foreground">
                      Successfully redeemed {giftsRedeemed} gifts!
                    </AlertDescription>
                  </Alert>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <Button
                    onClick={handleRedeemAll}
                    disabled={
                      connectionStatus !== 'connected' ||
                      redemptionStatus === 'redeeming'
                    }
                    className={cn(
                      'flex-1 font-semibold tracking-wide transition-all duration-200',
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
                    onClick={openInNewTab}
                    variant="outline"
                    className="border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10 font-semibold"
                  >
                    <ArrowSquareOut weight="bold" className="w-5 h-5 mr-2" />
                    Open Store
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  Authenticate with your STFC account in the embedded store below
                </p>
                
                <Alert className="border-2 border-primary/30">
                  <Gift weight="fill" className="w-4 h-4" />
                  <AlertDescription className="text-xs">
                    <strong>Note:</strong> If automation fails due to cross-origin restrictions, 
                    open the store in a new tab and run the redemption script there. 
                    The app will attempt to interact with the embedded store first.
                  </AlertDescription>
                </Alert>
              </div>
            )}
          </div>
        </Card>

        <ScriptGenerator />
      </div>

      <div className="relative flex-1 mx-4 md:mx-6 mb-4 md:mb-6 rounded-lg overflow-hidden border-2 border-primary/30 shadow-[0_4px_20px_rgba(100,181,246,0.2)]">
        <div className="absolute inset-0 bg-card/50 backdrop-blur-sm flex items-center justify-center z-10 pointer-events-none transition-opacity duration-300" style={{ opacity: connectionStatus === 'loading' ? 1 : 0 }}>
          <div className="text-center space-y-4">
            <CircleNotch className="w-12 h-12 text-primary mx-auto animate-spin" />
            <p className="text-sm font-medium text-muted-foreground">Loading Store...</p>
          </div>
        </div>

        {connectionStatus === 'disconnected' && errorMessage ? (
          <div className="absolute inset-0 bg-card flex items-center justify-center p-8">
            <div className="text-center space-y-4 max-w-md">
              <div className="inline-block bg-destructive/20 p-6 rounded-2xl border-2 border-destructive/30">
                <WarningCircle weight="fill" className="w-16 h-16 text-destructive mx-auto" />
              </div>
              <h3 className="text-xl font-semibold text-foreground">Unable to Embed Store</h3>
              <p className="text-muted-foreground leading-relaxed">
                The STFC store cannot be embedded due to security restrictions. Please use the "Open Store" button to access it in a new tab.
              </p>
              <Button
                onClick={openInNewTab}
                className="bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <ArrowSquareOut weight="bold" className="w-5 h-5 mr-2" />
                Open Store in New Tab
              </Button>
            </div>
          </div>
        ) : (
          <iframe
            ref={iframeRef}
            src={STORE_URL}
            className="w-full h-full"
            title="STFC Web Store"
            onLoad={handleIframeLoad}
            onError={handleIframeError}
            sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
          />
        )}
      </div>
    </div>
  );
}

export default App;