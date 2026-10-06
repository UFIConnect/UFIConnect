import Foundation
import Network

struct VpnLease: Codable {
  let deviceId: String
  let gatewayId: String
  let publicKey: String
  let addresses: [String]
  let endpoint: String
  let serverPublicKey: String
  let dns: [String]
  let allowedIPs: [String]
  let persistentKeepalive: Int
  let leaseExpiresAt: String
  let ipv6Egress: String
  var expiry: Date {
    let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.date(from: leaseExpiresAt) ?? ISO8601DateFormatter().date(from: leaseExpiresAt) ?? .distantPast
  }
  static func decode(_ data: Data) throws -> VpnLease {
    let value = try JSONDecoder().decode(VpnLease.self, from: data)
    let identity = try VpnStorage.privateKey().publicKey.rawRepresentation.base64EncodedString()
    func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
    guard value.publicKey == identity, Data(base64Encoded: value.serverPublicKey)?.count == 32,
      matches(value.deviceId, "^[A-Za-z0-9_-]{1,128}$"), matches(value.gatewayId, "^[A-Za-z0-9_-]{1,128}$"),
      value.addresses.count == 2, value.addresses.contains(where: { $0.hasSuffix("/32") && IPv4Address(String($0.dropLast(3))) != nil }),
      value.addresses.contains(where: { $0.hasSuffix("/128") && IPv6Address(String($0.dropLast(4))) != nil }),
      !value.dns.isEmpty, value.dns.allSatisfy({ IPv4Address($0) != nil || IPv6Address($0) != nil }),
      value.allowedIPs.count == 2, Set(value.allowedIPs) == Set(["0.0.0.0/0", "::/0"]),
      value.persistentKeepalive == 25, value.ipv6Egress == "blocked",
      matches(value.endpoint, "^([A-Za-z0-9.-]+|\\[[a-fA-F0-9:]+\\]):[0-9]{1,5}$"),
      let port = Int(value.endpoint.split(separator: ":").last ?? ""), (1...65535).contains(port),
      value.expiry.timeIntervalSinceNow > 0, value.expiry.timeIntervalSinceNow <= 360 else { throw VpnFailure.invalidLease }
    return value
  }
  func encoded() throws -> Data { try JSONEncoder().encode(self) }
}

// Redirects are rejected so the bearer token cannot leave the fixed control-plane origin.
final class VpnHTTP: NSObject, URLSessionTaskDelegate {
  static let shared = VpnHTTP()
  lazy var session: URLSession = {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15; config.timeoutIntervalForResource = 20
    config.urlCache = nil; config.httpCookieStorage = nil
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
  func renew(_ lease: VpnLease) async throws -> VpnLease {
    guard let data = try VpnStorage.read("session"), let token = String(data: data, encoding: .utf8), !token.isEmpty else { throw VpnFailure.revoked }
    var request = URLRequest(url: URL(string: "https://api.uficonnect.org/vpn/devices")!)
    request.httpMethod = "POST"; request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: ["publicKey": lease.publicKey, "gatewayId": lease.gatewayId, "label": "UFIConnect iOS"])
    let (body, response) = try await session.data(for: request)
    guard let response = response as? HTTPURLResponse else { throw VpnFailure.unavailable }
    if [401,403,409].contains(response.statusCode) { throw VpnFailure.revoked }
    guard response.statusCode == 200 || response.statusCode == 201, body.count < 65536,
      let object = try JSONSerialization.jsonObject(with: body) as? [String: Any], object["state"] as? String == "enrolled", let device = object["device"] else { throw VpnFailure.unavailable }
    let renewed = try VpnLease.decode(JSONSerialization.data(withJSONObject: device))
    guard renewed.deviceId == lease.deviceId, renewed.gatewayId == lease.gatewayId else { throw VpnFailure.revoked }
    return renewed
  }
}
