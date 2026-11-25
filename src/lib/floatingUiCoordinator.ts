export type FloatingPanelId =
  | 'none'
  | 'notifications'
  | 'support_hub'
  | 'live_chat'
  | 'menu'
  | 'categories_sheet'
  | 'search_modal';

export const OVERLAY_Z_INDEX = {
  floatingLauncher: 30,
  chromeAndCookie: 40,
  popoverBackdrop: 45,
  floatingPopoverAndDrawer: 50,
  detailAndSupportModal: 55,
  checkoutModal: 60,
  legalPreviewModal: 70,
} as const;

export function resolveFloatingPanelTransition(
  current: FloatingPanelId,
  action:
    | { type: 'open'; panel: Exclude<FloatingPanelId, 'none'> }
    | { type: 'toggle'; panel: Exclude<FloatingPanelId, 'none'> }
    | { type: 'close'; panel?: Exclude<FloatingPanelId, 'none'> }
    | { type: 'escape' }
    | { type: 'external_modal_opened' }
): FloatingPanelId {
  if (action.type === 'open') {
    return action.panel;
  }
  if (action.type === 'toggle') {
    return current === action.panel ? 'none' : action.panel;
  }
  if (action.type === 'close') {
    if (!action.panel || current === action.panel) {
      return 'none';
    }
    return current;
  }
  if (action.type === 'escape' || action.type === 'external_modal_opened') {
    return 'none';
  }
  return current;
}

export interface FloatingLauncherVisibilityInput {
  activeFloatingPanel: FloatingPanelId;
  isCartOpen: boolean;
  isSupportModalOpen: boolean;
  hasSelectedProduct: boolean;
  isCheckoutOpen: boolean;
  isOwnerRoute: boolean;
  isCookieBannerVisible: boolean;
  isMobileViewport?: boolean;
}

/**
 * Determines whether the compact floating support trigger should hide
 * to avoid visual clutter or collisions with open overlays, modals, or mobile cookie prompt.
 */
export function shouldHideFloatingLauncher(input: FloatingLauncherVisibilityInput): boolean {
  if (input.isOwnerRoute) return true;
  if (input.activeFloatingPanel !== 'none') return true;
  if (input.isCartOpen) return true;
  if (input.isSupportModalOpen) return true;
  if (input.hasSelectedProduct) return true;
  if (input.isCheckoutOpen) return true;
  if (input.isCookieBannerVisible && input.isMobileViewport) return true;
  return false;
}
