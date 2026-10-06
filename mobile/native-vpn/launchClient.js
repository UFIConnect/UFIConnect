import { Platform } from 'react-native';
import { consumeVpnLaunch } from './client';
const { createVpnLaunch } = require('./launch.cjs');
export const vpnLaunch = createVpnLaunch({consume:consumeVpnLaunch,platform:Platform.OS});
