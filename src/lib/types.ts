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
