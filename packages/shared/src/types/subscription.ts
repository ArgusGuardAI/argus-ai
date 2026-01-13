export interface SubscriptionStatus {
  subscribed: boolean;
  status: 'active' | 'inactive' | 'canceled' | 'past_due' | null;
  currentPeriodEnd?: string;
  stripeCustomerId?: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  sessionId: string;
}

export interface PortalSession {
  portalUrl: string;
}
