import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import axios from 'axios';
import Constants from 'expo-constants';
import { resolveApiBase } from '../security/apiConfig';
const { createVpnController } = require('./controller.cjs');
const base = resolveApiBase(Constants.expoConfig?.extra?.apiUrl, __DEV__);
const native = Platform.OS === 'web' ? null : requireOptionalNativeModule('UfiVpn');
export const vpn = createVpnController({ native, platform: Platform.OS,
  request: async (method, path, token, data) => (await axios({method, url: `${base}${path}`, data,
    timeout: 15000, headers: {Authorization: `Bearer ${token}`}})).data,
});
export async function disconnectVpnSession(token) { return vpn.disconnect(token); }
