export type GiftCategory = 'all' | 'daily' | 'limited' | 'permanent' | 'event';

export type GiftStatus = 'available' | 'limited' | 'maxed';

export interface Gift {
  id: string;
  title: string;
  description: string;
  category: GiftCategory;
  status: GiftStatus;
  quantity: string;
  imageUrl?: string;
}

export interface GiftHistoryEntry {
  id: string;
  giftTitle: string;
  giftDescription: string;
  quantity: string;
  claimedAt: string;
  category: GiftCategory;
}
