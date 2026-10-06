const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {gunzipSync} = require('node:zlib');
const xcode = require('xcode');
const plugin = require('./withUfiVpn');
test('Android consumer enables desugaring required by the VPN library without duplicate blocks',()=>{
  const original='plugins { id "com.android.application" }\nandroid { namespace "org.uficonnect.app" }\ndependencies {}\n';
  const result=plugin.addAndroidDesugaring(original);
  assert.ok(result.startsWith(original));
  assert.match(result,/coreLibraryDesugaringEnabled true/);
  assert.match(result,/coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs:2\.1\.5'/);
  assert.equal(plugin.addAndroidDesugaring(result),result);
});
test('actual Expo template gains one embedded, signed extension with pinned WireGuard package; survives serialization and repeated prebuild',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ufi-vpn-project-'));
  try {
    const archive=gunzipSync(fs.readFileSync(path.join(path.dirname(require.resolve('expo/package.json')),'template.tgz')));
    const expected='package/ios/HelloWorld.xcodeproj/project.pbxproj';
    for(let offset=0;offset+512<=archive.length;) {
      const name=archive.subarray(offset,offset+100).toString().replace(/\0.*$/s,'');
      const length=parseInt(archive.subarray(offset+124,offset+136).toString().replace(/\0.*$/s,'').trim()||'0',8);
      assert.ok(Number.isFinite(length));
      if(name===expected) {const destination=path.join(dir,expected);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,archive.subarray(offset+512,offset+512+length));break;}
      offset+=512+Math.ceil(length/512)*512;
    }
    const file=path.join(dir,'package/ios/HelloWorld.xcodeproj/project.pbxproj');const project=xcode.project(file);project.parseSync();
    const id=plugin.addExtension(project,'org.uficonnect.app','1.0.0','2','FIXTURETEAM');
    const original=project.writeSync();assert.equal(plugin.addExtension(project,'org.uficonnect.app','1.0.0','2','FIXTURETEAM'),id);assert.equal(project.writeSync(),original);
    fs.writeFileSync(file,original);const reparsed=xcode.project(file);reparsed.parseSync();const objects=reparsed.hash.project.objects;
    const target=objects.PBXNativeTarget[id];assert.equal(target.productType,'"com.apple.product-type.app-extension"');
    assert.equal(target.packageProductDependencies.length,1);
    const refs=Object.values(objects.XCRemoteSwiftPackageReference).filter(v=>typeof v==='object');assert.equal(refs.length,1);assert.equal(refs[0].requirement.revision,plugin.WIREGUARD_REVISION);
    const config=objects.XCConfigurationList[target.buildConfigurationList].buildConfigurations[0].value;
    assert.equal(objects.XCBuildConfiguration[config].buildSettings.CODE_SIGN_ENTITLEMENTS,'"UfiVpnTunnel/UfiVpnTunnel.entitlements"');
    assert.equal(target.buildPhases[0].comment,'Build WireGuard Go bridge');
    const scripts=Object.values(objects.PBXShellScriptBuildPhase).filter(v=>typeof v==='object');assert.ok(scripts.some(v=>v.shellScript.includes('SourcePackages/checkouts/wireguard-apple')));
    const sources=Object.values(objects.PBXSourcesBuildPhase).filter(v=>typeof v==='object');assert.ok(sources.some(v=>v.files.length===3));
    const copies=Object.values(objects.PBXCopyFilesBuildPhase).filter(v=>typeof v==='object');assert.ok(copies.some(v=>v.files.some(f=>f.comment?.includes('UfiVpnTunnel'))));
    assert.ok(Object.values(objects.PBXTargetDependency).some(value=>typeof value==='object'&&value.target===id));
  } finally {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('ufi-vpn-project-'));
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
test('EAS extension declaration is additive and does not need a stored signing secret',()=>{
  const config=plugin({name:'UFIConnect',slug:'ufi',ios:{bundleIdentifier:'org.uficonnect.app'},extra:{eas:{projectId:'fixture'}}});
  assert.equal(config.extra.eas.projectId,'fixture');
  const extension=config.extra.eas.build.experimental.ios.appExtensions[0];
  assert.equal(extension.bundleIdentifier,'org.uficonnect.app.vpn-tunnel');
  assert.deepEqual(extension.entitlements['com.apple.developer.networking.networkextension'],['packet-tunnel-provider']);
  assert.equal(JSON.stringify(config).includes('privateKey'),false);
});
