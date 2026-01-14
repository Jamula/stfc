import { useState, useMemo } from 'react';
import { useKV } from '@github/spark/hooks';
import { GiftCard } from '@/components/GiftCard';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { DotsThreeVertical, ArrowCounterClockwise, Rocket } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { gifts } from '@/lib/gifts-data';
import { GiftCategory } from '@/lib/types';

function App() {
  const [claimedGifts, setClaimedGifts] = useKV<string[]>('claimed-gifts', []);
  const [activeCategory, setActiveCategory] = useState<GiftCategory>('all');
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  const handleClaim = (giftId: string) => {
    setClaimedGifts((current) => {
      const currentList = current || [];
      if (currentList.includes(giftId)) {
        return currentList;
      }
      toast.success('Gift Claimed!', {
        description: 'Successfully marked as claimed.',
      });
      return [...currentList, giftId];
    });
  };

  const handleReset = () => {
    setClaimedGifts([]);
    setShowResetDialog(false);
    setSheetOpen(false);
    toast.success('Reset Complete', {
      description: 'All gift claims have been cleared.',
    });
  };

  const filteredGifts = useMemo(() => {
    if (activeCategory === 'all') return gifts;
    return gifts.filter((gift) => gift.category === activeCategory);
  }, [activeCategory]);

  const stats = useMemo(() => {
    const total = gifts.length;
    const claimed = gifts.filter((g) => claimedGifts?.includes(g.id) || false).length;
    const available = total - claimed;
    return { total, claimed, available };
  }, [claimedGifts]);

  return (
    <div className="min-h-screen bg-background">
      <div className="relative">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.25_0.08_240),transparent_50%),radial-gradient(circle_at_70%_60%,oklch(0.20_0.10_145),transparent_50%)] pointer-events-none" />

        <div className="relative">
          <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/80 border-b-2 border-primary/30 shadow-[0_4px_20px_rgba(100,181,246,0.1)]">
            <div className="container mx-auto px-4 py-4 md:py-6">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="bg-primary/20 p-2 rounded-lg border-2 border-primary/50">
                    <Rocket weight="fill" className="w-6 h-6 md:w-8 md:h-8 text-primary" />
                  </div>
                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-foreground tracking-tight">
                      STFC Gift Tracker
                    </h1>
                    <p className="text-xs md:text-sm text-muted-foreground">
                      Fleet Command Web Store
                    </p>
                  </div>
                </div>

                <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
                  <SheetTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="border-2 border-primary/30 hover:border-primary/50 hover:bg-primary/10"
                    >
                      <DotsThreeVertical weight="bold" className="w-5 h-5" />
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="bg-card border-l-2 border-primary/30">
                    <SheetHeader>
                      <SheetTitle className="text-xl font-bold">Settings</SheetTitle>
                      <SheetDescription>
                        Manage your gift tracking preferences
                      </SheetDescription>
                    </SheetHeader>
                    <div className="mt-8 space-y-6">
                      <div className="space-y-2">
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                          Statistics
                        </h3>
                        <div className="space-y-2 font-mono text-sm">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Gifts:</span>
                            <span className="text-foreground font-semibold">{stats.total}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Claimed:</span>
                            <span className="text-accent font-semibold">{stats.claimed}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Available:</span>
                            <span className="text-primary font-semibold">{stats.available}</span>
                          </div>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-border">
                        <Button
                          variant="destructive"
                          className="w-full font-semibold"
                          onClick={() => setShowResetDialog(true)}
                        >
                          <ArrowCounterClockwise weight="bold" className="w-4 h-4 mr-2" />
                          Reset All Claims
                        </Button>
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </header>

          <div className="container mx-auto px-4 py-6 md:py-8">
            <div className="space-y-6">
              <Tabs
                value={activeCategory}
                onValueChange={(value) => setActiveCategory(value as GiftCategory)}
                className="w-full"
              >
                <TabsList className="w-full justify-start overflow-x-auto bg-card border-2 border-primary/30 p-1 h-auto flex-nowrap">
                  <TabsTrigger
                    value="all"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                  >
                    All Gifts
                  </TabsTrigger>
                  <TabsTrigger
                    value="daily"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                  >
                    Daily
                  </TabsTrigger>
                  <TabsTrigger
                    value="limited"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                  >
                    Limited Time
                  </TabsTrigger>
                  <TabsTrigger
                    value="permanent"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                  >
                    Permanent
                  </TabsTrigger>
                  <TabsTrigger
                    value="event"
                    className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold"
                  >
                    Event
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {filteredGifts.length === 0 ? (
                <div className="text-center py-16 space-y-4">
                  <div className="inline-block bg-primary/20 p-6 rounded-2xl border-2 border-primary/30">
                    <Rocket weight="fill" className="w-16 h-16 text-primary mx-auto" />
                  </div>
                  <h3 className="text-xl font-semibold text-foreground">No Gifts in This Category</h3>
                  <p className="text-muted-foreground">Try selecting a different category</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                  {filteredGifts.map((gift) => (
                    <GiftCard
                      key={gift.id}
                      gift={gift}
                      isClaimed={claimedGifts?.includes(gift.id) || false}
                      onClaim={handleClaim}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent className="bg-card border-2 border-destructive/30">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold">Reset All Claims?</AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              This will mark all gifts as unclaimed. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-semibold">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
            >
              Reset All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default App;