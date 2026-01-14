import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Gift, CheckCircle, Clock, LockKey } from '@phosphor-icons/react';
import { Gift as GiftType } from '@/lib/types';
import { cn } from '@/lib/utils';

interface GiftCardProps {
  gift: GiftType;
  isClaimed: boolean;
  onClaim: (id: string) => void;
}

export function GiftCard({ gift, isClaimed, onClaim }: GiftCardProps) {
  const isMaxed = gift.status === 'maxed';
  const isLimited = gift.status === 'limited';
  const canClaim = !isClaimed && !isMaxed;

  return (
    <Card
      className={cn(
        'relative overflow-hidden transition-all duration-300 border-2',
        canClaim && 'hover:shadow-[0_0_20px_rgba(100,181,246,0.3)] hover:scale-[1.02] border-primary/30',
        isClaimed && 'opacity-60 bg-card/50',
        isMaxed && 'opacity-50 border-destructive/30'
      )}
    >
      {isClaimed && (
        <div className="absolute inset-0 bg-gradient-to-br from-accent/10 to-transparent z-10 pointer-events-none">
          <div className="absolute top-4 right-4 bg-accent rounded-full p-2">
            <CheckCircle weight="fill" className="w-6 h-6 text-accent-foreground" />
          </div>
        </div>
      )}

      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap gap-2">
              {isLimited && (
                <Badge
                  variant="outline"
                  className="bg-destructive/20 border-destructive/50 text-destructive-foreground uppercase tracking-wider text-xs font-medium"
                >
                  <Clock weight="fill" className="w-3 h-3 mr-1" />
                  Limited Time
                </Badge>
              )}
              {gift.category === 'daily' && (
                <Badge
                  variant="outline"
                  className="bg-primary/20 border-primary/50 text-primary-foreground uppercase tracking-wider text-xs font-medium"
                >
                  Daily Gift
                </Badge>
              )}
              {isMaxed && (
                <Badge
                  variant="outline"
                  className="bg-destructive/20 border-destructive/50 text-destructive-foreground uppercase tracking-wider text-xs font-medium"
                >
                  <LockKey weight="fill" className="w-3 h-3 mr-1" />
                  Max Capacity
                </Badge>
              )}
            </div>
            <h3 className="text-lg md:text-xl font-semibold text-card-foreground leading-tight">
              {gift.title}
            </h3>
          </div>
          <div className="shrink-0">
            <Gift
              weight={canClaim ? 'fill' : 'regular'}
              className={cn(
                'w-8 h-8 md:w-10 md:h-10',
                canClaim ? 'text-primary' : 'text-muted-foreground'
              )}
            />
          </div>
        </div>

        <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
          {gift.description}
        </p>

        <div className="flex items-center justify-between pt-2 gap-4">
          <span className="font-mono text-sm md:text-base font-medium text-card-foreground">
            {gift.quantity}
          </span>
          <Button
            onClick={() => onClaim(gift.id)}
            disabled={!canClaim}
            size="sm"
            className={cn(
              'transition-all duration-200 font-semibold tracking-wide',
              canClaim &&
                'bg-accent text-accent-foreground hover:bg-accent/90 hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(125,232,168,0.4)]',
              isClaimed && 'bg-accent/50 text-accent-foreground'
            )}
          >
            {isClaimed ? (
              <>
                <CheckCircle weight="fill" className="w-4 h-4 mr-2" />
                Claimed
              </>
            ) : isMaxed ? (
              <>
                <LockKey weight="fill" className="w-4 h-4 mr-2" />
                Maxed
              </>
            ) : (
              'Claim'
            )}
          </Button>
        </div>
      </div>
    </Card>
  );
}
