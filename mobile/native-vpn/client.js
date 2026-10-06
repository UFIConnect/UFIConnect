import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import axios from 'axios';
import Constants from 'expo-constants';
import { resolveApiBase } from '../security/apiConfig';
const { createVpnController } = require('./controller.cjs');
const base = resolveApiBase(Constants.expoConfig?.extra?.apiUrl, __DEV__);
const native = Platform.OS === 'android' ? requireOptionalNativeModule('UfiVpn') : null;
export async function getVpnMembership(token) {
  return (await axios.get(`${base}/billing/status`, {
    timeout:15000, headers:{Authorization:`Bearer ${token}`},
  })).data;
}
export async function consumeVpnLaunch(code, platform, token) {
  return (await axios.post(`${base}/vpn/launch/consume`, {code,platform}, {
    timeout:15000, headers:{Authorization:`Bearer ${token}`},
  })).data;
}
export const vpn = createVpnController({ native, platform: Platform.OS,
  request: async (method, path, token, data) => (await axios({method, url: `${base}${path}`, data,
    timeout: 15000, headers: {Authorization: `Bearer ${token}`}})).data,
});
export async function disconnectVpnSession(token) {
  if (Platform.OS === 'ios') return {externalManaged:true};
  return vpn.disconnect(token);
}
