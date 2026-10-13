export interface Theme {
  id: string;
  name: string;
  background: string;
  /** Far → near (depth ramps), start → end (ramps along a line). */
  ramp: string[];
}

export const THEMES: Theme[] = [
  { id: 'graphite', name: 'Graphite', background: '#111214', ramp: ['#3e4250', '#9da3b4', '#ffffff'] },
  { id: 'signal', name: 'Signal', background: '#f4f5f7', ramp: ['#b7c0ff', '#3b4bff', '#5a1bd6'] },
  { id: 'kiln', name: 'Kiln', background: '#ede6dd', ramp: ['#e0b6a2', '#b4532f', '#3f1d12'] },
  { id: 'ozone', name: 'Ozone', background: '#0b1220', ramp: ['#16384a', '#2fb3c8', '#d4f86a'] },
  { id: 'bloom', name: 'Bloom', background: '#fff8f3', ramp: ['#ffc9b3', '#ff5c6c', '#a3106e'] },
];

export const themeFor = (id: string) => THEMES.find((t) => t.id === id);

export const ARTBOARD_SIZES = [
  { label: '1:1', w: 1000, h: 1000 },
  { label: '4:3', w: 1200, h: 900 },
  { label: '3:2', w: 1500, h: 1000 },
  { label: '16:9', w: 1600, h: 900 },
  { label: '4:5', w: 1080, h: 1350 },
  { label: '9:16', w: 900, h: 1600 },
];
