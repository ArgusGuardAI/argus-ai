import { Storage } from '@plasmohq/storage';

const storage = new Storage();

export interface StoredWallet {
  address: string;
  connectedAt: number;
}

export interface StoredSettings {
  autoScan: boolean;
  showGraffiti: boolean;
  notificationsEnabled: boolean;
}

const KEYS = {
  WALLET: 'argusguard_wallet',
  SETTINGS: 'argusguard_settings',
  PREMIUM_STATUS: 'argusguard_premium',
} as const;

// Wallet storage

export async function getStoredWallet(): Promise<StoredWallet | null> {
  const wallet = await storage.get<StoredWallet>(KEYS.WALLET);
  return wallet || null;
}

export async function setStoredWallet(wallet: StoredWallet): Promise<void> {
  await storage.set(KEYS.WALLET, wallet);
}

export async function clearStoredWallet(): Promise<void> {
  await storage.remove(KEYS.WALLET);
}

// Settings storage

export async function getSettings(): Promise<StoredSettings> {
  const settings = await storage.get<StoredSettings>(KEYS.SETTINGS);
  return (
    settings || {
      autoScan: true,
      showGraffiti: true,
      notificationsEnabled: true,
    }
  );
}

export async function updateSettings(updates: Partial<StoredSettings>): Promise<void> {
  const current = await getSettings();
  await storage.set(KEYS.SETTINGS, { ...current, ...updates });
}

// Premium status

export async function getPremiumStatus(): Promise<boolean> {
  const status = await storage.get<boolean>(KEYS.PREMIUM_STATUS);
  return status || false;
}

export async function setPremiumStatus(isPremium: boolean): Promise<void> {
  await storage.set(KEYS.PREMIUM_STATUS, isPremium);
}
