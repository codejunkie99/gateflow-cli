/**
 * Environment Bootstrap
 * Loads .env files before SDK clients are constructed.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables from multiple locations
// Priority (first found wins): cwd/.env > parent/.env > repo/.env > dist/.env
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Script-relative (lowest priority)
dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

// CWD and parent (higher priority)
dotenv.config({ path: path.resolve(process.cwd(), '../.env'), quiet: true });
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
