import Foundation
import Security
import CryptoKit

enum VpnFailure: Error { case unavailable, invalidLease, secureStorage, permission, cancelled, tunnel, expired, revoked }
enum VpnStorage {
  static func query(_ account: String) throws -> [String: Any] {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "UfiVpnKeychainGroup") as? String, !group.contains("$(") else { throw VpnFailure.secureStorage }
    return [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "org.uficonnect.vpn", kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
  }
  static func read(_ account: String) throws -> Data? {
    var q = try query(account); q[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else { throw VpnFailure.secureStorage }
    return data
  }
  static func write(_ account: String, _ data: Data) throws {
    let q = try query(account)
    let attributes: [String: Any] = [kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(q as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      guard SecItemAdd(q.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess else { throw VpnFailure.secureStorage }
    } else if status != errSecSuccess { throw VpnFailure.secureStorage }
  }
  static func clear() throws {
    for name in ["privateKey", "session", "lease"] {
      let status = SecItemDelete(try query(name) as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw VpnFailure.secureStorage }
    }
  }
  static func privateKey() throws -> Curve25519.KeyAgreement.PrivateKey {
    guard let bytes = try read("privateKey") else { throw VpnFailure.secureStorage }
    return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: bytes)
  }
  static func newIdentity() throws -> String {
    let key = Curve25519.KeyAgreement.PrivateKey()
    try write("privateKey", key.rawRepresentation)
    return key.publicKey.rawRepresentation.base64EncodedString()
  }
}
