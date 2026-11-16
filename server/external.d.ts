declare module 'arabic-persian-reshaper' {
  export const PersianShaper: { convertArabic: (str: string) => string };
  const reshaper: {
    PersianShaper: { convertArabic: (str: string) => string };
    ArabicShaper: { convertArabic: (str: string) => string };
  };
  export default reshaper;
}

declare module 'bidi-js' {
  export interface BidiApi {
    getEmbeddingLevels: (text: string, baseDirection?: 'ltr' | 'rtl' | 'auto') => any;
    getReorderedString: (text: string, embeddingLevels: any) => string;
  }
  export default function bidiFactory(): BidiApi;
}

declare module 'leaflet.heat' {
  import L from 'leaflet';
  export function heatLayer(latlngs: Array<[number, number, number?]>, options?: any): L.Layer;
}
