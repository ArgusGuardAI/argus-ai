import { Hono } from 'hono';
import Stripe from 'stripe';
import type { Bindings } from '../index';
import { createSupabaseClient } from '../services/supabase';

export const subscriptionRoutes = new Hono<{ Bindings: Bindings }>();

// Price ID for the $19.99/month subscription (set this in Stripe Dashboard)
const SUBSCRIPTION_PRICE = 1999; // $19.99 in cents

// Create a Stripe Checkout session
subscriptionRoutes.post('/create-checkout', async (c) => {
  try {
    const body = await c.req.json<{
      walletAddress: string;
      successUrl?: string;
      cancelUrl?: string;
    }>();

    if (!body.walletAddress) {
      return c.json({ error: 'walletAddress is required' }, 400);
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email: `${body.walletAddress}@argusguard.wallet`,
      limit: 1,
    });

    let customerId: string;

    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      // Create new customer with wallet address as identifier
      const customer = await stripe.customers.create({
        email: `${body.walletAddress}@argusguard.wallet`,
        metadata: {
          walletAddress: body.walletAddress,
        },
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'ArgusGuard Premium',
              description: 'AI-powered crypto scam protection',
            },
            unit_amount: SUBSCRIPTION_PRICE,
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: body.successUrl || 'https://argusguard.io/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: body.cancelUrl || 'https://argusguard.io/cancel',
      metadata: {
        walletAddress: body.walletAddress,
      },
    });

    return c.json({
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error('Create checkout error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to create checkout session', details: message }, 500);
  }
});

// Stripe webhook handler
subscriptionRoutes.post('/webhook', async (c) => {
  try {
    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

    const signature = c.req.header('stripe-signature');
    if (!signature) {
      return c.json({ error: 'Missing stripe-signature header' }, 400);
    }

    const body = await c.req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        c.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err);
      return c.json({ error: 'Invalid signature' }, 400);
    }

    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const walletAddress = session.metadata?.walletAddress;

        if (walletAddress && session.subscription) {
          // Get subscription details - use any to handle Stripe SDK type changes
          const subscriptionData = await stripe.subscriptions.retrieve(
            session.subscription as string
          ) as any;

          await supabase.from('subscribers').upsert({
            wallet_address: walletAddress,
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            status: 'active',
            current_period_start: new Date(subscriptionData.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscriptionData.current_period_end * 1000).toISOString(),
            created_at: new Date().toISOString(),
          });

          console.log(`Subscription created for wallet: ${walletAddress}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as any;
        const customer = await stripe.customers.retrieve(subscription.customer as string);

        if ('metadata' in customer && customer.metadata?.walletAddress) {
          const walletAddress = customer.metadata.walletAddress;

          await supabase
            .from('subscribers')
            .update({
              status: subscription.status === 'active' ? 'active' : 'inactive',
              current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
              current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            })
            .eq('wallet_address', walletAddress);

          console.log(`Subscription updated for wallet: ${walletAddress}, status: ${subscription.status}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const customer = await stripe.customers.retrieve(subscription.customer as string);

        if ('metadata' in customer && customer.metadata?.walletAddress) {
          const walletAddress = customer.metadata.walletAddress;

          await supabase
            .from('subscribers')
            .update({ status: 'canceled' })
            .eq('wallet_address', walletAddress);

          console.log(`Subscription canceled for wallet: ${walletAddress}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        if (invoice.subscription) {
          const subscriptionData = await stripe.subscriptions.retrieve(
            invoice.subscription as string
          ) as any;
          const customer = await stripe.customers.retrieve(subscriptionData.customer as string);

          if ('metadata' in customer && customer.metadata?.walletAddress) {
            const walletAddress = customer.metadata.walletAddress;

            await supabase
              .from('subscribers')
              .update({ status: 'past_due' })
              .eq('wallet_address', walletAddress);

            console.log(`Payment failed for wallet: ${walletAddress}`);
          }
        }
        break;
      }
    }

    return c.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return c.json({ error: 'Webhook handler failed' }, 500);
  }
});

// Check subscription status for a wallet
subscriptionRoutes.get('/status/:walletAddress', async (c) => {
  try {
    const walletAddress = c.req.param('walletAddress');

    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    const { data, error } = await supabase
      .from('subscribers')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();

    if (error || !data) {
      return c.json({
        subscribed: false,
        status: null,
      });
    }

    // Check if subscription is still valid
    const now = new Date();
    const periodEnd = new Date(data.current_period_end);
    const isValid = data.status === 'active' && periodEnd > now;

    return c.json({
      subscribed: isValid,
      status: data.status,
      currentPeriodEnd: data.current_period_end,
      stripeCustomerId: data.stripe_customer_id,
    });
  } catch (error) {
    console.error('Check subscription error:', error);
    return c.json({ error: 'Failed to check subscription status' }, 500);
  }
});

// Create a customer portal session for managing subscription
subscriptionRoutes.post('/portal', async (c) => {
  try {
    const body = await c.req.json<{
      walletAddress: string;
      returnUrl?: string;
    }>();

    if (!body.walletAddress) {
      return c.json({ error: 'walletAddress is required' }, 400);
    }

    const supabase = createSupabaseClient(c.env.SUPABASE_URL, c.env.SUPABASE_ANON_KEY);

    // Get customer ID from database
    const { data: subscriber } = await supabase
      .from('subscribers')
      .select('stripe_customer_id')
      .eq('wallet_address', body.walletAddress)
      .single();

    if (!subscriber?.stripe_customer_id) {
      return c.json({ error: 'No subscription found for this wallet' }, 404);
    }

    const stripe = new Stripe(c.env.STRIPE_SECRET_KEY);

    const session = await stripe.billingPortal.sessions.create({
      customer: subscriber.stripe_customer_id,
      return_url: body.returnUrl || 'https://argusguard.io',
    });

    return c.json({
      portalUrl: session.url,
    });
  } catch (error) {
    console.error('Create portal error:', error);
    return c.json({ error: 'Failed to create portal session' }, 500);
  }
});
