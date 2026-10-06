using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace UfiConnect.Vpn {
  internal sealed class ApiError : Exception {
    public readonly int Status;
    public ApiError(int status, string message) : base(message) { Status = status; }
  }
  internal static class Json {
    internal static string Encode(object value) { return new JavaScriptSerializer().Serialize(value); }
    internal static Dictionary<string, object> Decode(string text) {
      if (text == null || text.Length > 65536) throw new InvalidDataException("Invalid server response.");
      return new JavaScriptSerializer { MaxJsonLength = 65536, RecursionLimit = 12 }.Deserialize<Dictionary<string, object>>(text);
    }
    internal static string Text(Dictionary<string, object> value, string key) {
      object result; if (!value.TryGetValue(key, out result) || !(result is string)) throw new InvalidDataException("Incomplete VPN configuration.");
      return (string)result;
    }
    internal static string[] Strings(Dictionary<string, object> value, string key) {
      object result; if (!value.TryGetValue(key, out result)) throw new InvalidDataException("Incomplete VPN configuration.");
      var sequence = result as System.Collections.IEnumerable;
      if (sequence == null || result is string) throw new InvalidDataException("Invalid VPN configuration.");
      return sequence.Cast<object>().Select(item => { if (!(item is string)) throw new InvalidDataException("Invalid VPN configuration."); return (string)item; }).ToArray();
    }
  }
  internal sealed class Lease {
    internal string Id, Gateway, PublicKey, ServerKey, Endpoint;
    internal string[] Addresses, Dns;
    internal DateTime Expires;
    internal Dictionary<string, object> PublicData;
    internal static bool KeyValid(string value) {
      if (value == null || !Regex.IsMatch(value, "^[A-Za-z0-9+/]{43}=$")) return false;
      try { var bytes = Convert.FromBase64String(value); return bytes.Length == 32 && bytes.Any(b => b != 0) && Convert.ToBase64String(bytes) == value; } catch { return false; }
    }
    internal static Lease Read(Dictionary<string, object> data, string ownPublicKey, DateTime now) {
      if(data==null)throw new InvalidDataException("Incomplete VPN configuration.");
      var lease = new Lease { Id = Json.Text(data,"deviceId"), Gateway = Json.Text(data,"gatewayId"), PublicKey = Json.Text(data,"publicKey"),
        ServerKey = Json.Text(data,"serverPublicKey"), Endpoint = Json.Text(data,"endpoint"), Addresses = Json.Strings(data,"addresses"), Dns = Json.Strings(data,"dns"), PublicData = data };
      if (!Regex.IsMatch(lease.Id, "^[A-Za-z0-9_-]{1,128}$") || !Regex.IsMatch(lease.Gateway,"^[a-z0-9-]{1,48}$")
        || lease.PublicKey != ownPublicKey || !KeyValid(lease.PublicKey) || !KeyValid(lease.ServerKey)) throw new InvalidDataException("Invalid VPN identity.");
      if (!DateTime.TryParse(Json.Text(data,"leaseExpiresAt"), CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out lease.Expires)
        || lease.Expires <= now.AddSeconds(5) || lease.Expires > now.AddSeconds(360)) throw new InvalidDataException("VPN authorization has expired. Reconnect.");
      var parts = lease.Endpoint.LastIndexOf(':'); int port;
      if (!Regex.IsMatch(lease.Endpoint, "^(?:[A-Za-z0-9.-]+|\\[[A-Fa-f0-9:]+\\]):[0-9]{1,5}$")
        || !int.TryParse(lease.Endpoint.Substring(parts+1),out port) || port < 1 || port > 65535) throw new InvalidDataException("Invalid VPN endpoint.");
      if (lease.Addresses.Length != 2 || !Address(lease.Addresses[0],false) || !Address(lease.Addresses[1],true)) throw new InvalidDataException("Invalid VPN addresses.");
      IPAddress ip;
      if (lease.Dns.Length != 1 || !IPAddress.TryParse(lease.Dns[0],out ip) || ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork) throw new InvalidDataException("Invalid VPN DNS.");
      var routes = Json.Strings(data,"allowedIPs");
      if (routes.Length != 2 || !routes.Contains("0.0.0.0/0") || !routes.Contains("::/0") || Json.Text(data,"ipv6Egress") != "blocked"
        || Convert.ToInt32(data["persistentKeepalive"],CultureInfo.InvariantCulture) != 25) throw new InvalidDataException("Invalid VPN routing policy.");
      return lease;
    }
    private static bool Address(string value, bool ipv6) {
      var suffix = ipv6 ? "/128" : "/32"; IPAddress ip;
      return value.EndsWith(suffix,StringComparison.Ordinal) && IPAddress.TryParse(value.Substring(0,value.Length-suffix.Length),out ip)
        && ip.AddressFamily == (ipv6 ? System.Net.Sockets.AddressFamily.InterNetworkV6 : System.Net.Sockets.AddressFamily.InterNetwork);
    }
    internal bool SameTunnel(Lease next) {
      return Id == next.Id && Gateway == next.Gateway && PublicKey == next.PublicKey && ServerKey == next.ServerKey && Endpoint == next.Endpoint
        && Addresses.SequenceEqual(next.Addresses) && Dns.SequenceEqual(next.Dns);
    }
    internal string Configuration(string privateKey) {
      if (!KeyValid(privateKey)) throw new InvalidDataException("Invalid local VPN identity.");
      return "[Interface]\nPrivateKey = " + privateKey + "\nAddress = " + String.Join(", ",Addresses) + "\nDNS = " + String.Join(", ",Dns)
        + "\nMTU = 1280\n[Peer]\nPublicKey = " + ServerKey + "\nEndpoint = " + Endpoint + "\nAllowedIPs = 0.0.0.0/0, ::/0\nPersistentKeepalive = 25\n";
    }
  }
  internal sealed class Api : IDisposable {
    private readonly HttpClient client;
    internal Api() {
      ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
      client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(15), MaxResponseContentBufferSize = 65536 };
    }
    internal async Task<Dictionary<string, object>> Request(string method, string path, string token, object body) {
      if (!Regex.IsMatch(path,"^/(?:auth/(?:login|logout)|vpn/(?:config|devices(?:/[A-Za-z0-9_-]+)?))$")) throw new InvalidOperationException("Unknown API operation.");
      using (var request = new HttpRequestMessage(new HttpMethod(method),"https://api.uficonnect.org" + path)) {
        if (token != null) request.Headers.Authorization = new AuthenticationHeaderValue("Bearer",token);
        if (body != null) request.Content = new StringContent(Json.Encode(body),Encoding.UTF8,"application/json");
        using (var response = await client.SendAsync(request,HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false)) {
          using (var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
          using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
          using (var output = new MemoryStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = await stream.ReadAsync(buffer,0,buffer.Length,cancel.Token).ConfigureAwait(false)) > 0) {
              if (output.Length + count > 65536) throw new InvalidDataException("Server response too large.");
              output.Write(buffer,0,count);
            }
            Dictionary<string,object> result;
            try { result = Json.Decode(Encoding.UTF8.GetString(output.ToArray())); } catch { throw new ApiError((int)response.StatusCode,"UFIConnect returned an invalid response."); }
            if (!response.IsSuccessStatusCode) {
              string message = "UFIConnect could not complete this request."; object candidate;
              if (result.TryGetValue("message",out candidate) && candidate is string && ((string)candidate).Length <= 240) message = (string)candidate;
              throw new ApiError((int)response.StatusCode,message);
            }
            return result;
          }
        }
      }
    }
    public void Dispose() { client.Dispose(); }
  }
  internal static class Health {
    internal static bool Connected(bool serviceUp, DateTime expiry, DateTime handshake, DateTime now) {
      return serviceUp && expiry > now && handshake > now.AddSeconds(-180) && handshake <= now.AddSeconds(30);
    }
    internal static bool Expired(long deadline, long monotonicNow, DateTime expiry, DateTime now) { return monotonicNow >= deadline || now >= expiry; }
  }
}
