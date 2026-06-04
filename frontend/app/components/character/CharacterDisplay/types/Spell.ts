export interface Spell {
  id: string;
  name: string;
  nameEn?: string;
  level: number; // 0 for cantrips
  school?: string;
  castingTime?: string;
  casting_time?: string;
  range?: string;
  components?: string[] | string;
  duration?: string;
  description?: string;
  classes?: string[]; // who can learn/cast
  ritual?: boolean;
  concentration?: boolean;
  [key: string]: any;
}

