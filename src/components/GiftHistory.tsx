import { useState } from 'react';
import { useKV } from '@github/spark/hooks';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ClockCounterClockwise,
  CaretDown,
  CaretUp,
  Gift,
  Trash,
  Calendar,
  Package,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { GiftHistoryEntry } from '@/lib/types';

export function GiftHistory() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [giftHistory, setGiftHistory] = useKV<GiftHistoryEntry[]>('gift-history', []);

  const history = giftHistory || [];

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'daily':
        return 'bg-primary/20 border-primary/50 text-primary-foreground';
      case 'limited':
        return 'bg-destructive/20 border-destructive/50 text-destructive-foreground';
      case 'event':
        return 'bg-accent/20 border-accent/50 text-accent-foreground';
      default:
        return 'bg-secondary/50 border-secondary text-secondary-foreground';
    }
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
    
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  const clearHistory = () => {
    if (window.confirm('Are you sure you want to clear all gift history?')) {
      setGiftHistory([]);
    }
  };

  const sortedHistory = [...history].sort((a, b) => 
    new Date(b.claimedAt).getTime() - new Date(a.claimedAt).getTime()
  );

  const todayCount = history.filter(entry => {
    const entryDate = new Date(entry.claimedAt);
    const today = new Date();
    return entryDate.toDateString() === today.toDateString();
  }).length;

  return (
    <Card
      className={cn(
        'backdrop-blur-xl bg-card/90 border-2 border-primary/30 shadow-[0_4px_20px_rgba(100,181,246,0.2)] transition-all duration-300',
        !isExpanded && 'pb-2'
      )}
    >
      <div className="p-4 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-accent/20 p-2 rounded-lg border-2 border-accent/50">
              <ClockCounterClockwise weight="fill" className="w-6 h-6 md:w-8 md:h-8 text-accent" />
            </div>
            <div>
              <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
                Gift History
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground">
                {history.length === 0 
                  ? 'No gifts claimed yet'
                  : `${history.length} total • ${todayCount} today`
                }
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {history.length > 0 && (
              <Badge
                variant="outline"
                className="uppercase tracking-wider text-xs font-medium border-2 bg-accent/20 border-accent/50 text-accent-foreground"
              >
                <Gift weight="fill" className="w-3 h-3 mr-1" />
                {history.length}
              </Badge>
            )}

            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsExpanded(!isExpanded)}
              className="border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10"
            >
              {isExpanded ? (
                <CaretUp weight="bold" className="w-5 h-5" />
              ) : (
                <CaretDown weight="bold" className="w-5 h-5" />
              )}
            </Button>
          </div>
        </div>

        {isExpanded && (
          <div className="mt-6 space-y-4">
            {history.length === 0 ? (
              <div className="text-center py-12 space-y-3">
                <div className="inline-block bg-muted/50 p-6 rounded-2xl border-2 border-border">
                  <Package weight="fill" className="w-16 h-16 text-muted-foreground mx-auto" />
                </div>
                <p className="text-muted-foreground text-sm">
                  Your claimed gifts will appear here
                </p>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground font-medium">
                    Recent Claims
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearHistory}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash weight="bold" className="w-4 h-4 mr-2" />
                    Clear History
                  </Button>
                </div>

                <ScrollArea className="h-[400px] pr-4">
                  <div className="space-y-3">
                    {sortedHistory.map((entry, index) => (
                      <div key={entry.id}>
                        <div className="flex items-start gap-3 p-3 rounded-lg bg-secondary/30 border border-border hover:bg-secondary/50 transition-colors">
                          <div className="shrink-0 mt-1">
                            <div className="bg-accent/20 p-2 rounded-lg border border-accent/30">
                              <Gift weight="fill" className="w-5 h-5 text-accent" />
                            </div>
                          </div>

                          <div className="flex-1 min-w-0 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <h3 className="font-semibold text-foreground text-sm leading-tight">
                                {entry.giftTitle}
                              </h3>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'uppercase tracking-wider text-xs font-medium border shrink-0',
                                  getCategoryColor(entry.category)
                                )}
                              >
                                {entry.category}
                              </Badge>
                            </div>

                            <p className="text-xs text-muted-foreground leading-relaxed">
                              {entry.giftDescription}
                            </p>

                            <div className="flex items-center justify-between gap-4">
                              <span className="font-mono text-xs font-medium text-card-foreground">
                                {entry.quantity}
                              </span>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Calendar weight="fill" className="w-3 h-3" />
                                {formatDate(entry.claimedAt)}
                              </div>
                            </div>
                          </div>
                        </div>
                        {index < sortedHistory.length - 1 && (
                          <Separator className="my-2" />
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
