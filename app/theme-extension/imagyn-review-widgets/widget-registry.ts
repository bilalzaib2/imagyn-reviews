import type { ThemeWidgetRenderer } from "./widget-renderer";

export const THEME_WIDGET_BLOCK_NAME = "IMAGYN Reviews";

export interface ThemeWidgetDefinition {
  blockHandle: "imagyn-reviews";
  widgetType: "review-list";
  assetScript: "imagyn-review-widgets.js";
  assetStylesheet: "imagyn-review-widgets.css";
}

export const THEME_WIDGET_DEFINITION: ThemeWidgetDefinition = {
  blockHandle: "imagyn-reviews",
  widgetType: "review-list",
  assetScript: "imagyn-review-widgets.js",
  assetStylesheet: "imagyn-review-widgets.css",
};

export const createThemeWidgetRegistry = (renderer: ThemeWidgetRenderer) => ({
  [renderer.type]: renderer,
});