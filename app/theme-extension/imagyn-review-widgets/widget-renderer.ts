export interface ThemeWidgetBlockSettings {
  maxItems: number;
  showHeading: boolean;
  heading: string;
  layoutMode: string;
  showRatingSummary: boolean;
  showVerifiedBadge: boolean;
  showReviewDate: boolean;
  showWriteReviewButton: boolean;
  colorMode: "light" | "dark";
}

export interface ThemeWidgetBlockConfig {
  blockId: string;
  widgetId: string;
  widgetType: "review-list";
  widgetName: string;
  configEndpoint: string;
  placement: "product-page";
  productContext: boolean;
  productId: string | null;
  productHandle: string | null;
  shopDomain: string;
  blockSettings: ThemeWidgetBlockSettings;
}

export interface ThemeReviewRecord {
  id: string;
  rating: number;
  title: string;
  body: string;
  author: string;
  verified: boolean;
  date?: string;
}

export interface ThemeWidgetDataPayload {
  source: "window" | "future-api" | "demo";
  reviews: ThemeReviewRecord[];
}

export interface ThemeWidgetConfigLoader {
  load(config: ThemeWidgetBlockConfig): Promise<ThemeWidgetDataPayload>;
}

export interface ThemeWidgetRenderer {
  type: ThemeWidgetBlockConfig["widgetType"];
  mount(root: HTMLElement, config: ThemeWidgetBlockConfig, data: ThemeWidgetDataPayload): void;
}