import { useKV } from '@github/spark/hooks';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Gift,
  Trash,
  Calendar,
  Package,
} from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { GiftHistoryEntry } from '@/lib/types';

export function GiftHistory() {
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
    <div className="space-y-4">
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
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Recent Claims
              </p>
              <p className="text-xs text-muted-foreground">
                {history.length} total • {todayCount} today
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHistory}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash weight="bold" className="w-4 h-4 mr-2" />
              Clear
            </Button>
          </div>

          <ScrollArea className="h-[calc(100vh-24rem)]">
            <div className="space-y-3 pr-4">
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

                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
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
  );
}
