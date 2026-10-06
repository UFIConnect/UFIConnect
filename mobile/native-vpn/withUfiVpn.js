const fs = require('node:fs/promises');
const path = require('node:path');
const { withInfoPlist, withEntitlementsPlist, withXcodeProject, withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');
const plist = require('@expo/plist');
const TARGET = 'UfiVpnTunnel';
const REVISION = '2fec12a6e1f6e3460b6ee483aa00ad29cddadab1';
const quote = value => JSON.stringify(value);
function addAndroidDesugaring(contents) {
  if (contents.includes('// UFIConnect VPN core-library desugaring')) return contents;
  return contents + `\n// UFIConnect VPN core-library desugaring\nandroid {\n    compileOptions { coreLibraryDesugaringEnabled true }\n}\ndependencies {\n    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2.1.5'\n}\n`;
}
function addExtension(project, bundleId, version, buildNumber, team) {
  const objects = project.hash.project.objects;
  const existing = Object.entries(objects.PBXNativeTarget || {}).find(([id, target]) => !id.endsWith('_comment') && target.name?.replaceAll('"', '') === TARGET);
  if (existing) return existing[0];
  // xcode's addTargetDependency silently skips linking when these sections are absent.
  objects.PBXTargetDependency ||= {};
  objects.PBXContainerItemProxy ||= {};
  const extension = project.addTarget(TARGET, 'app_extension', TARGET, bundleId + '.vpn-tunnel');
  project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', extension.uuid);
  const frameworks = project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', extension.uuid);
  const group = project.addPbxGroup([], TARGET, TARGET);
  project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
  for (const file of ['PacketTunnelProvider.swift', 'VpnStorage.swift', 'VpnLease.swift']) project.addSourceFile(file, {target: extension.uuid}, group.uuid);
  project.addFramework('NetworkExtension.framework', {target: extension.uuid});
  project.addFramework('Security.framework', {target: extension.uuid});
  project.addFramework('CryptoKit.framework', {target: extension.uuid});
  const configs = objects.XCConfigurationList[extension.pbxNativeTarget.buildConfigurationList].buildConfigurations;
  for (const {value} of configs) Object.assign(objects.XCBuildConfiguration[value].buildSettings, {
    INFOPLIST_FILE: quote(`${TARGET}/Info.plist`), CODE_SIGN_ENTITLEMENTS: quote(`${TARGET}/${TARGET}.entitlements`),
    PRODUCT_BUNDLE_IDENTIFIER: quote(bundleId + '.vpn-tunnel'), SWIFT_VERSION: '5.0', IPHONEOS_DEPLOYMENT_TARGET: '16.4',
    TARGETED_DEVICE_FAMILY: quote('1,2'), APPLICATION_EXTENSION_API_ONLY: 'YES', ENABLE_BITCODE: 'NO', ENABLE_USER_SCRIPT_SANDBOXING: 'NO',
    MARKETING_VERSION: quote(version), CURRENT_PROJECT_VERSION: quote(String(buildNumber)),
    LIBRARY_SEARCH_PATHS: [quote('$(inherited)'), quote('$(CONFIGURATION_BUILD_DIR)')],
    ...(team ? {DEVELOPMENT_TEAM: quote(team)} : {}),
  });
  const packageId = project.generateUuid(), productId = project.generateUuid(), buildId = project.generateUuid();
  objects.XCRemoteSwiftPackageReference ||= {};
  objects.XCRemoteSwiftPackageReference[packageId] = {isa:'XCRemoteSwiftPackageReference', repositoryURL:quote('https://git.zx2c4.com/wireguard-apple'), requirement:{kind:'revision', revision:REVISION}};
  objects.XCRemoteSwiftPackageReference[packageId + '_comment'] = 'WireGuardKit';
  const root = project.getFirstProject().firstProject; root.packageReferences ||= []; root.packageReferences.push({value:packageId,comment:'WireGuardKit'});
  objects.XCSwiftPackageProductDependency ||= {};
  objects.XCSwiftPackageProductDependency[productId] = {isa:'XCSwiftPackageProductDependency', package:packageId, productName:'WireGuardKit'};
  objects.XCSwiftPackageProductDependency[productId + '_comment'] = 'WireGuardKit';
  extension.pbxNativeTarget.packageProductDependencies = [{value:productId,comment:'WireGuardKit'}];
  objects.PBXBuildFile[buildId] = {isa:'PBXBuildFile', productRef:productId, productRef_comment:'WireGuardKit'};
  objects.PBXBuildFile[buildId + '_comment'] = 'WireGuardKit in Frameworks';
  frameworks.buildPhase.files.push({value:buildId,comment:'WireGuardKit in Frameworks'});
  // Build the official Go bridge before the extension's final link.
  const phase = project.addBuildPhase([], 'PBXShellScriptBuildPhase', 'Build WireGuard Go bridge', extension.uuid, {
    shellPath:'/bin/sh', shellScript:`set -eu\nGO_PATH_FILE="$SRCROOT/../.cache/wireguard-toolchain/go-bin-path"\ntest -f "$GO_PATH_FILE" || { echo "Run node native-vpn/prepare-go.mjs before the iOS build." >&2; exit 1; }\nexport PATH="$(cat "$GO_PATH_FILE"):$PATH:/usr/local/bin:/opt/homebrew/bin"\ncase "$(go version 2>/dev/null)" in "go version go1.19.13 darwin/"*) ;; *) echo "WireGuardKit requires the verified Go 1.19.13 toolchain." >&2; exit 1;; esac\nCHECKOUT="\${BUILD_DIR%%/Build/*}/SourcePackages/checkouts/wireguard-apple/Sources/WireGuardKitGo"\ntest -f "$CHECKOUT/Makefile"\nmake -C "$CHECKOUT" GOOS_iphonesimulator=ios\n`,
  });
  const phases = extension.pbxNativeTarget.buildPhases;
  phases.unshift(...phases.splice(phases.findIndex(value => value.value === phase.uuid), 1));
  return extension.uuid;
}
function withUfiVpn(config, { iosNativeVpn = true } = {}) {
  config = withAppBuildGradle(config, mod => {
    if (mod.modResults.language !== 'groovy') throw new Error('UFI VPN requires the Expo Groovy Android app build file');
    mod.modResults.contents = addAndroidDesugaring(mod.modResults.contents);
    return mod;
  });
  // iPhone uses the official WireGuard app. Keep the Android plugin active
  // without declaring an Apple extension or adding signing entitlements.
  if (!iosNativeVpn) return config;
  const bundle = config.ios?.bundleIdentifier;
  if (!bundle || !/^[A-Za-z0-9.-]+$/.test(bundle)) throw new Error('UFI VPN needs a valid iOS bundle identifier');
  const keychainGroup = `$(AppIdentifierPrefix)${bundle}.vpn`;
  const entitlements = {'com.apple.developer.networking.networkextension':['packet-tunnel-provider'], 'keychain-access-groups':[keychainGroup]};
  config.extra ||= {}; config.extra.eas ||= {}; config.extra.eas.build ||= {};
  config.extra.eas.build.experimental ||= {}; config.extra.eas.build.experimental.ios ||= {};
  const extensions = config.extra.eas.build.experimental.ios.appExtensions ||= [];
  if (!extensions.some(value => value.targetName === TARGET)) extensions.push({targetName:TARGET,bundleIdentifier:bundle + '.vpn-tunnel',entitlements});
  config = withInfoPlist(config, mod => { mod.modResults.UfiVpnKeychainGroup = keychainGroup; return mod; });
  config = withEntitlementsPlist(config, mod => {
    for (const [key, values] of Object.entries(entitlements)) mod.modResults[key] = [...new Set([...(mod.modResults[key] || []), ...values])];
    return mod;
  });
  config = withDangerousMod(config, ['ios', async mod => {
    const dest = path.join(mod.modRequest.platformProjectRoot, TARGET); await fs.mkdir(dest,{recursive:true});
    const source = path.join(__dirname,'ufi-vpn/ios');
    for (const [from,to] of [['Extension/PacketTunnelProvider.swift','PacketTunnelProvider.swift'],['Shared/VpnStorage.swift','VpnStorage.swift'],['Shared/VpnLease.swift','VpnLease.swift']]) await fs.copyFile(path.join(source,from),path.join(dest,to));
    await fs.writeFile(path.join(dest,'Info.plist'),plist.build({CFBundleDisplayName:'UFIConnect VPN',CFBundleExecutable:'$(EXECUTABLE_NAME)',CFBundleIdentifier:'$(PRODUCT_BUNDLE_IDENTIFIER)',CFBundleInfoDictionaryVersion:'6.0',CFBundleName:'$(PRODUCT_NAME)',CFBundlePackageType:'XPC!',CFBundleShortVersionString:'$(MARKETING_VERSION)',CFBundleVersion:'$(CURRENT_PROJECT_VERSION)',UfiVpnKeychainGroup:keychainGroup,NSExtension:{NSExtensionPointIdentifier:'com.apple.networkextension.packet-tunnel',NSExtensionPrincipalClass:'$(PRODUCT_MODULE_NAME).PacketTunnelProvider'}}));
    await fs.writeFile(path.join(dest,`${TARGET}.entitlements`),plist.build(entitlements));
    return mod;
  }]);
  return withXcodeProject(config, mod => { addExtension(mod.modResults,bundle,config.version || '1.0.0',config.ios?.buildNumber || '1',config.ios?.appleTeamId); return mod; });
}
module.exports = withUfiVpn;
module.exports.addExtension = addExtension;
module.exports.WIREGUARD_REVISION = REVISION;
module.exports.addAndroidDesugaring = addAndroidDesugaring;
