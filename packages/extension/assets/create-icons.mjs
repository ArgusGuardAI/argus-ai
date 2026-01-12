import fs from 'fs';
import { execSync } from 'child_process';

// Download a simple placeholder icon using curl
const sizes = [16, 48, 128];

for (const size of sizes) {
  // Use placeholder.com to get a simple blue square
  try {
    execSync(`curl -s "https://via.placeholder.com/${size}/0ea5e9/ffffff?text=W" -o icon${size}.png`);
    console.log(`Downloaded icon${size}.png`);
  } catch (e) {
    console.log(`Failed to download icon${size}.png:`, e.message);
  }
}
