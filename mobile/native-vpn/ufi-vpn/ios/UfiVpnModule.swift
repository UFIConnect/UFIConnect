import ExpoModulesCore
import Foundation
import NetworkExtension

public class UfiVpnModule: Module {
  private let controller = VpnManager()
  public func definition() -> ModuleDefinition {
    Name("UfiVpn")
    AsyncFunction("prepare") { () -> Bool in true }
    AsyncFunction("createIdentity") { () async throws -> [String: String] in try await self.controller.identity() }
    AsyncFunction("connect") { (lease: String, token: String) async throws in try await self.controller.connect(lease, token: token) }
    AsyncFunction("disconnect") { () async throws in try await self.controller.disconnect() }
    AsyncFunction("status") { () async throws -> [String: Any] in try await self.controller.status() }
  }
}

private actor VpnManager {
  private var generation = 0
  private var extensionId: String { (Bundle.main.bundleIdentifier ?? "org.uficonnect.app") + ".vpn-tunnel" }
  private func manager() async throws -> NETunnelProviderManager? {
    let values: [NETunnelProviderManager] = try await withCheckedThrowingContinuation { continuation in
      NETunnelProviderManager.loadAllFromPreferences { values, error in
        if error != nil { continuation.resume(throwing: VpnFailure.permission) }
        else { continuation.resume(returning: values ?? []) }
      }
    }
    return values.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == extensionId }
  }
  func identity() async throws -> [String: String] {
    if let current = try await manager(), ![.disconnected, .invalid].contains(current.connection.status) { throw VpnFailure.tunnel }
    try VpnStorage.clear()
    return ["publicKey": try VpnStorage.newIdentity()]
  }
  func connect(_ text: String, token: String) async throws {
    generation += 1; let operation = generation
    guard let bytes = text.data(using: .utf8), bytes.count < 65536, !token.isEmpty, token.count < 16384 else { throw VpnFailure.invalidLease }
    let lease = try VpnLease.decode(bytes)
    let current = try await manager() ?? NETunnelProviderManager()
    guard operation == generation else { throw VpnFailure.cancelled }
    try VpnStorage.write("session", Data(token.utf8)); try VpnStorage.write("lease", lease.encoded())
    let config = NETunnelProviderProtocol()
    config.providerBundleIdentifier = extensionId
    config.serverAddress = lease.endpoint
    config.includeAllNetworks = true; config.excludeLocalNetworks = false; config.enforceRoutes = true
    current.protocolConfiguration = config; current.localizedDescription = "UFIConnect VPN"
    current.isOnDemandEnabled = false; current.isEnabled = true
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      current.saveToPreferences { error in
        if error != nil { continuation.resume(throwing: VpnFailure.permission) } else { continuation.resume() }
      }
    }
    guard operation == generation else { throw VpnFailure.cancelled }
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      current.loadFromPreferences { error in
        if error != nil { continuation.resume(throwing: VpnFailure.permission) } else { continuation.resume() }
      }
    }
    guard operation == generation else { throw VpnFailure.cancelled }
    try current.connection.startVPNTunnel()
  }
  func disconnect() async throws {
    generation += 1
    if let current = try await manager() {
      current.connection.stopVPNTunnel()
      for _ in 0..<30 {
        if [.disconnected, .invalid].contains(current.connection.status) { break }
        try await Task.sleep(nanoseconds: 100_000_000)
      }
      guard [.disconnected, .invalid].contains(current.connection.status) else { throw VpnFailure.tunnel }
    }
    try VpnStorage.clear()
  }
  func status() async throws -> [String: Any] {
    guard let current = try await manager() else { return ["tunnelState": "down", "supported": true] }
    let state = current.connection.status
    var base: [String: Any] = ["tunnelState": state == .connected ? "up" : state == .connecting || state == .reasserting ? "starting" : state == .disconnecting ? "stopping" : "down", "supported": true]
    if let data = try VpnStorage.read("lease"), let stored = try? JSONDecoder().decode(VpnLease.self, from: data) {
      base["deviceId"] = stored.deviceId; base["leaseExpiresAt"] = stored.leaseExpiresAt
    }
    guard state == .connected, let session = current.connection as? NETunnelProviderSession else { return base }
    return try await withCheckedThrowingContinuation { continuation in
      let reply = StatusReply(continuation, base: base)
      DispatchQueue.global().asyncAfter(deadline: .now() + 3) { reply.finish(nil) }
      do { try session.sendProviderMessage(Data("status".utf8)) { reply.finish($0) } }
      catch { reply.finish(nil) }
    }
  }
}
private final class StatusReply {
  private let lock = NSLock()
  private var continuation: CheckedContinuation<[String: Any], Error>?
  private let base: [String: Any]
  init(_ continuation: CheckedContinuation<[String: Any], Error>, base: [String: Any]) { self.continuation = continuation; self.base = base }
  func finish(_ data: Data?) {
    lock.lock(); let next = continuation; continuation = nil; lock.unlock()
    guard let next else { return }
    var value = base
    if let data, data.count < 4096, let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
      for key in ["lastHandshakeAt", "deviceId", "leaseExpiresAt"] { if let field = object[key] { value[key] = field } }
    }
    next.resume(returning: value)
  }
}
