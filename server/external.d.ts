
declare module 'arabic-persian-reshaper' {
  export interface ArabicShaperAPI {
    convertArabic(str: string): string;
  }

  export const PersianShaper: ArabicShaperAPI;

  export const ArabicShaper: ArabicShaperAPI;

  const reshaper: {
    PersianShaper: ArabicShaperAPI;
    ArabicShaper: ArabicShaperAPI;
  };

  export default reshaper;
}

declare module 'bidi-js' {
  export interface BidiApi {
    getEmbeddingLevels(
      text: string,
      baseDirection?: 'ltr' | 'rtl' | 'auto'
    ): any;

    getReorderedString(
      text: string,
      embeddingLevels: any
    ): string;
  }

  export default function bidiFactory(): BidiApi;
}

declare module 'leaflet.heat' {
  import * as L from 'leaflet';

  export function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: {
      minOpacity?: number;
      maxZoom?: number;
      max?: number;
      radius?: number;
      blur?: number;
      gradient?: Record<number, string>;
    }
  ): L.Layer;
}
