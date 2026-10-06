Pod::Spec.new do |s|
  s.name = 'UfiVpn'
  s.version = '0.1.0'
  s.summary = 'UFIConnect native managed VPN bridge'
  s.description = 'Device-local WireGuard identity and Network Extension control.'
  s.author = 'UFIConnect'
  s.homepage = 'https://uficonnect.org'
  s.license = { :type => 'Proprietary' }
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'NetworkExtension', 'Security', 'CryptoKit', 'Network'
  s.source_files = 'UfiVpnModule.swift', 'Shared/*.swift'
  s.swift_version = '5.0'
end
