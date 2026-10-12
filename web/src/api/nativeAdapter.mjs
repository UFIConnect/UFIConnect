import axios from 'axios';
import { nativeApiRequest, base64ToBytes } from '../nativeRuntime.mjs';

// Preserve Axios response/status semantics while the host owns network origin,
// bearer validation, redirects, and platform TLS policy.
export function createNativeAxiosAdapter(request = nativeApiRequest) {
  return async config => {
    if (config.signal?.aborted) throw new axios.CanceledError('Request cancelled', config);
    const url = axios.getUri({ ...config, baseURL: undefined });
    const controller = new AbortController();
    let timer, abort;
    const cancellation = new Promise((_, reject) => {
      abort = () => { controller.abort(); reject(new axios.CanceledError('Request cancelled', config)); };
      config.signal?.addEventListener('abort', abort, { once: true });
      if (config.timeout > 0) timer = setTimeout(() => {
        controller.abort(); reject(new axios.AxiosError('Request timed out. Please try again.', 'ECONNABORTED', config));
      }, config.timeout);
    });
    try {
      const result = await Promise.race([request({ url, method: config.method, data: config.data,
        headers: config.headers?.toJSON?.() || config.headers, responseType: config.responseType, timeout: config.timeout, signal: controller.signal }), cancellation]);
      if (config.signal?.aborted) throw new axios.CanceledError('Request cancelled', config);
      let data = result.data;
      if (result.bodyType === 'base64') {
        const bytes = base64ToBytes(data);
        data = config.responseType === 'arraybuffer' ? bytes.buffer : new Blob([bytes], { type: result.headers?.['content-type'] || 'application/octet-stream' });
      } else if (config.responseType === 'blob') data = new Blob([typeof data === 'string' ? data : JSON.stringify(data)], { type: result.headers?.['content-type'] || 'application/json' });
      const response = { data, status: result.status, statusText: '', headers: result.headers || {}, config };
      if (!config.validateStatus || config.validateStatus(response.status)) return response;
      throw new axios.AxiosError('The server could not complete this request.', result.status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST', config, null, response);
    } finally {
      clearTimeout(timer);
      config.signal?.removeEventListener('abort', abort);
    }
  };
}

export const nativeAxiosAdapter = createNativeAxiosAdapter();
