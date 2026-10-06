import Foundation
import NetworkExtension
import WireGuardKit

final class PacketTunnelProvider: NEPacketTunnelProvider {
  // WireGuard runtime configuration contains secrets: never forward or log it.
  private lazy var adapter = WireGuardAdapter(with: self) { _, _ in }
  private var lease: VpnLease?
  private var renewal: Task<Void, Never>?
  private var deadline: TimeInterval = 0
  private var stopped = false
  private var watchdog: DispatchSourceTimer?
  private let stateLock = NSLock()
  private func configuration(_ lease: VpnLease) throws -> TunnelConfiguration {
    guard let privateKey = PrivateKey(rawValue: try VpnStorage.privateKey().rawRepresentation), let serverKey = PublicKey(base64Key: lease.serverPublicKey) else { throw VpnFailure.invalidLease }
    var interface = InterfaceConfiguration(privateKey: privateKey)
    interface.addresses = lease.addresses.compactMap(IPAddressRange.init(from:))
    interface.dns = lease.dns.compactMap(DNSServer.init(from:)); interface.mtu = 1280
    var peer = PeerConfiguration(publicKey: serverKey)
    peer.allowedIPs = lease.allowedIPs.compactMap(IPAddressRange.init(from:))
    peer.endpoint = Endpoint(from: lease.endpoint); peer.persistentKeepAlive = 25
    guard interface.addresses.count == 2, interface.dns.count == lease.dns.count, peer.allowedIPs.count == 2, peer.endpoint != nil else { throw VpnFailure.invalidLease }
    return TunnelConfiguration(name: "UFIConnect", interface: interface, peers: [peer])
  }
  override func startTunnel(options: [String: NSObject]?, completionHandler: @escaping (Error?) -> Void) {
    do {
      guard let bytes = try VpnStorage.read("lease") else { throw VpnFailure.invalidLease }
      let initial = try VpnLease.decode(bytes)
      stateLock.lock(); lease = initial; deadline = ProcessInfo.processInfo.systemUptime + initial.expiry.timeIntervalSinceNow; stateLock.unlock()
      adapter.start(tunnelConfiguration: try configuration(initial)) { [weak self] error in
        guard let self else { completionHandler(VpnFailure.cancelled); return }
        if error != nil { completionHandler(VpnFailure.tunnel); return }
        if self.snapshot().stopped { self.adapter.stop { _ in completionHandler(VpnFailure.cancelled) }; return }
        completionHandler(nil); self.startRenewal()
      }
    } catch { completionHandler(VpnFailure.invalidLease) }
  }
  private func startRenewal() {
    stateLock.lock(); defer { stateLock.unlock() }
    guard !stopped else { return }
    let timer = DispatchSource.makeTimerSource(queue: DispatchQueue.global(qos: .utility))
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler { [weak self] in
      guard let self else { return }
      let state = self.snapshot()
      let expired = !state.stopped && (ProcessInfo.processInfo.systemUptime >= state.deadline || (state.lease?.expiry.timeIntervalSinceNow ?? 0) <= 0)
      if expired { self.end(VpnFailure.expired) }
    }
    watchdog = timer; timer.resume()
    renewal = Task { [weak self] in
      while !Task.isCancelled {
        do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch { return }
        guard let self else { return }
        let state = self.snapshot()
        guard !state.stopped, let current = state.lease else { return }
        if ProcessInfo.processInfo.systemUptime >= state.deadline { self.end(VpnFailure.expired); return }
        do {
          let next = try await VpnHTTP.shared.renew(current)
          guard !Task.isCancelled, !self.snapshot().stopped else { return }
          let changed = current.addresses != next.addresses || current.endpoint != next.endpoint || current.serverPublicKey != next.serverPublicKey || current.dns != next.dns || current.allowedIPs != next.allowedIPs
          // Renewing authorization alone must not reassert OS routing every 30 seconds.
          if changed {
            let config = try self.configuration(next)
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
              self.adapter.update(tunnelConfiguration: config) { error in
                if error != nil { continuation.resume(throwing: VpnFailure.tunnel) } else { continuation.resume() }
              }
            }
          }
          try self.storeRenewal(next)
        } catch VpnFailure.revoked { self.end(VpnFailure.revoked); return }
        catch {
          if ProcessInfo.processInfo.systemUptime >= self.snapshot().deadline { self.end(VpnFailure.expired); return }
        }
      }
    }
  }
  private func end(_ error: Error) {
    stateLock.lock(); guard !stopped else { stateLock.unlock(); return }; stopped = true
    let work = renewal; let timer = watchdog; renewal = nil; watchdog = nil; stateLock.unlock()
    work?.cancel(); timer?.cancel()
    adapter.stop { [weak self] _ in self?.cancelTunnelWithError(error) }
    try? VpnStorage.clear()
  }
  override func stopTunnel(with reason: NEProviderStopReason, completionHandler: @escaping () -> Void) {
    stateLock.lock(); stopped = true
    let work = renewal; let timer = watchdog; renewal = nil; watchdog = nil; stateLock.unlock()
    work?.cancel(); timer?.cancel()
    adapter.stop { _ in completionHandler() }
  }
  private func snapshot() -> (lease: VpnLease?, deadline: TimeInterval, stopped: Bool) {
    stateLock.lock(); defer { stateLock.unlock() }
    return (lease, deadline, stopped)
  }
  private func storeRenewal(_ next: VpnLease) throws {
    stateLock.lock(); defer { stateLock.unlock() }
    guard !stopped else { throw VpnFailure.cancelled }
    lease = next; deadline = ProcessInfo.processInfo.systemUptime + next.expiry.timeIntervalSinceNow
    try VpnStorage.write("lease", next.encoded())
  }
  override func handleAppMessage(_ messageData: Data, completionHandler: ((Data?) -> Void)?) {
    let state = snapshot()
    guard messageData == Data("status".utf8), let current = state.lease, !state.stopped else { completionHandler?(nil); return }
    adapter.getRuntimeConfiguration { text in
      let seconds = text?.split(separator: "\n").first(where: { $0.hasPrefix("last_handshake_time_sec=") }).flatMap { Double($0.dropFirst("last_handshake_time_sec=".count)) } ?? 0
      let result: [String: Any] = ["deviceId": current.deviceId, "leaseExpiresAt": current.leaseExpiresAt, "lastHandshakeAt": seconds * 1000]
      completionHandler?(try? JSONSerialization.data(withJSONObject: result))
    }
  }
}
