using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace UfiConnect.Vpn {
  internal static class Tests {
    private static int checks;
    private static void Check(bool condition,string name){if(!condition)throw new Exception("FAILED: "+name);checks++;}
    private static void Reject(Action action,string name){try{action();}catch(InvalidDataException){checks++;return;}throw new Exception("FAILED: "+name);}
    public static int Main(string[] args){
      try{
        var now=new DateTime(2026,10,5,0,0,0,DateTimeKind.Utc);
        var key=Convert.ToBase64String(Enumerable.Repeat((byte)1,32).ToArray());
        var serverKey=Convert.ToBase64String(Enumerable.Repeat((byte)2,32).ToArray());
        Func<Dictionary<string,object>> data=()=>Json.Decode(Json.Encode(new{deviceId="fixture-device",gatewayId="test-us-1",publicKey=key,serverPublicKey=serverKey,
          endpoint="gateway.example.invalid:51820",addresses=new[]{"10.80.0.2/32","fd80:80:0::2/128"},dns=new[]{"10.80.0.1"},allowedIPs=new[]{"0.0.0.0/0","::/0"},persistentKeepalive=25,ipv6Egress="blocked",leaseExpiresAt=now.AddMinutes(5).ToString("o")}));
        var lease=Lease.Read(data(),key,now);
        Check(lease.Id=="fixture-device"&&lease.Expires==now.AddMinutes(5),"valid public configuration");
        Check(lease.Configuration(key).Contains("AllowedIPs = 0.0.0.0/0, ::/0"),"both IP families routed");
        Check(!lease.Configuration(key).Contains("PostUp"),"no shell commands in config");
        Reject(()=>Lease.Read(data(),serverKey,now),"wrong local key");
        Reject(()=>Lease.Read(data(),key,now.AddMinutes(5)),"expired authorization");
        Reject(()=>Lease.Read(data(),key,now.AddMinutes(-5)),"excessive authorization");
        var value=data();value["endpoint"]="host:51820\nPostUp=anything";Reject(()=>Lease.Read(value,key,now),"endpoint injection");
        value=data();value["addresses"]=new[]{"10.80.0.2/32","0.0.0.0/0"};Reject(()=>Lease.Read(value,key,now),"missing IPv6 address");
        value=data();value["dns"]=new[]{"resolver.invalid"};Reject(()=>Lease.Read(value,key,now),"DNS must be IP");
        value=data();value["allowedIPs"]=new[]{"0.0.0.0/0"};Reject(()=>Lease.Read(value,key,now),"missing IPv6 default route");
        value=data();value["serverPublicKey"]=Convert.ToBase64String(new byte[32]);Reject(()=>Lease.Read(value,key,now),"zero public key");
        Check(!Health.Connected(false,lease.Expires,now,now),"service stopped");
        Check(!Health.Connected(true,lease.Expires,DateTime.MinValue,now),"no handshake");
        Check(!Health.Connected(true,lease.Expires,now.AddMinutes(-4),now),"stale handshake");
        Check(!Health.Connected(true,now,now,now),"expired lease cannot appear connected");
        Check(Health.Connected(true,lease.Expires,now.AddSeconds(-20),now),"real current handshake");
        Check(Health.Expired(1000,1000,now.AddDays(1),now),"monotonic expiry survives wall-clock rollback");
        Check(Health.Expired(1000,100,now,now),"wall-clock expiry");
        Check(!Health.Expired(1000,100,lease.Expires,now),"live lease");
        var code=Convert.ToBase64String(Enumerable.Repeat((byte)7,32).ToArray()).TrimEnd('=').Replace('+','-').Replace('/','_');
        var uri=LaunchPolicy.Prefix+code;
        Check(LaunchPolicy.Code(uri)==code,"canonical browser link");
        foreach(var bad in new[]{"https://uficonnect.org/connect?code="+code,uri+"&platform=windows",uri+"#fragment",uri+"/",uri+"\n",uri.Replace("connect?","connect/?"),uri.Replace("uficonnect-vpn:","UFICONNECT-VPN:"),uri.Replace("?code=","?code=%"),uri.Substring(0,uri.Length-1),uri+"\" /anything",LaunchPolicy.Prefix+new string('A',42)+"B"})
          Reject(()=>LaunchPolicy.Code(bad),"malformed or noncanonical browser link");
        var account="00000000-0000-4000-8000-000000000001";
        var other="00000000-0000-4000-8000-000000000002";
        var inbox=new LaunchInbox();
        Check(inbox.Receive(uri,null,now)&&inbox.Pending,"signed-out launch stays in memory");
        Check(inbox.Take(null,now.AddSeconds(10))==null&&inbox.Pending,"no launch consumption while signed out");
        Check(inbox.Take(account,now.AddSeconds(20))==code&&!inbox.Pending,"login consumes pending link once");
        Check(inbox.Take(account,now.AddSeconds(21))==null&&!inbox.Receive(uri,account,now.AddSeconds(21)),"replayed browser link rejected");
        inbox=new LaunchInbox();inbox.Receive(uri,account,now);Check(inbox.Take(account,now.AddSeconds(180))==null&&!inbox.Pending,"expiry at 180 seconds");
        inbox=new LaunchInbox();inbox.Receive(uri,account,now);Check(inbox.Take(other,now.AddSeconds(1))==null&&!inbox.Pending,"account change discards earlier intent");
        inbox=new LaunchInbox();inbox.Receive(uri,account,now);inbox.Clear();Check(!inbox.Pending&&inbox.Take(account,now)==null,"sign-out cancels intent");
        var token=new string('x',40);
        var session=SessionPolicy.Encode(token,account);
        var encrypted=ProtectedData.Protect(Encoding.UTF8.GetBytes(session),null,DataProtectionScope.CurrentUser);
        var restored=SessionPolicy.Read(Encoding.UTF8.GetString(ProtectedData.Unprotect(encrypted,null,DataProtectionScope.CurrentUser)));
        Check(restored.Token==token&&restored.AccountId==account,"current-user DPAPI sign-in round trip");
        Check(!session.Contains("privateKey")&&!session.Contains("code"),"saved sign-in excludes tunnel keys and launch codes");
        var legacy=SessionPolicy.Read(Json.Encode(new{token=token,accountId=account,privateKey="old private key"}));
        Check(!SessionPolicy.Encode(legacy.Token,legacy.AccountId).Contains("old private key"),"restoring legacy session drops old tunnel key");
        Reject(()=>SessionPolicy.Read(Json.Encode(new{token=token})),"unbound legacy sign-in requires login");
        Reject(()=>SessionPolicy.Encode("short",account),"invalid session rejected");
        Reject(()=>SessionPolicy.Encode(token,"not-an-account"),"invalid account rejected");
        var sid=WindowsIdentity.GetCurrent().User;
        var foreign=new SecurityIdentifier(WellKnownSidType.AnonymousSid,null);
        Check(LaunchPolicy.SameUser(sid,sid)&&!LaunchPolicy.SameUser(sid,foreign)&&!LaunchPolicy.SameUser(sid,null),"IPC identity exact SID match");
        Check(LaunchPolicy.PipeName(sid)!=LaunchPolicy.PipeName(foreign),"Windows accounts have separate pipe names");
        var security=LaunchPolicy.Security(sid);var rules=security.GetAccessRules(true,true,typeof(SecurityIdentifier));
        var rule=rules[0] as System.IO.Pipes.PipeAccessRule;
        Check(rules.Count==1&&rule.IdentityReference.Equals(sid)&&rule.AccessControlType==AccessControlType.Allow&&security.AreAccessRulesProtected,"pipe ACL admits only the current SID");
        var label=LaunchPolicy.Descriptor(sid).SystemAcl[0] as CustomAce;
        var labelBytes=label.GetOpaque();
        Check((int)label.AceType==17&&BitConverter.ToInt32(labelBytes,0)==1&&new SecurityIdentifier(labelBytes,4).Value=="S-1-16-8192","pipe preserves medium mandatory label as a raw ACE");
        Check(LaunchPolicy.Arguments(new string[0],sid,false)==""&&LaunchPolicy.Arguments(new[]{uri},sid,false)==uri,"normal start and protocol arguments");
        Check(LaunchPolicy.Arguments(new[]{"--elevated-owner",sid.Value,uri},sid,true)==uri,"elevation retains exact Windows user");
        Reject(()=>LaunchPolicy.Arguments(new[]{"--elevated-owner",foreign.Value,uri},sid,true),"different-user elevation rejected");
        Reject(()=>LaunchPolicy.Arguments(new[]{"--elevated-owner",sid.Value,uri},sid,false),"non-elevated internal launch rejected");
        Reject(()=>LaunchPolicy.Arguments(new[]{uri,"--extra"},sid,true),"extra process arguments rejected");
        Check(LaunchPolicy.ProtocolCommand(@"C:\Program Files\UFIConnect VPN\UFIConnectVpn.exe")=="\"C:\\Program Files\\UFIConnect VPN\\UFIConnectVpn.exe\" \"%1\"","protocol invokes fixed quoted GUI executable");
        Reject(()=>LaunchPolicy.ProtocolCommand("relative.exe"),"relative protocol executable rejected");
        Reject(()=>LaunchPolicy.ProtocolCommand("C:\\bad\"path.exe"),"protocol command injection rejected");
        var pipeName=LaunchPolicy.PipeName(sid)+"-test-"+Guid.NewGuid().ToString("N");
        var received=new List<string>();
        using(var receiver=new LaunchPipe(item=>{lock(received)received.Add(item);},pipeName)){
          var listening=receiver.Start();
          Check(LaunchPipe.Forward(uri,pipeName),"real same-user authenticated pipe handoff");
          Check(LaunchPipe.Forward(uri,pipeName)&&LaunchPipe.Forward("",pipeName),"existing instance accepts repeated requests and focus");
          lock(received)Check(received.Count==3&&received[0]==uri&&received[2]=="","pipe preserves exact validated request");
          Reject(()=>LaunchPipe.Forward(uri+"&extra=1",pipeName),"invalid handoff never enters pipe");
          receiver.Dispose();Check(listening.Wait(4000),"pipe shuts down without retained listener");
        }
        SetupPolicy.ValidateUrl(SetupPolicy.Url);checks++;
        Reject(()=>SetupPolicy.ValidateUrl("http://download.wireguard.com/windows-client/wireguard-amd64-1.1.1.msi"),"download HTTPS required");
        Reject(()=>SetupPolicy.ValidateUrl(SetupPolicy.Url+"?mirror=other"),"download exactly pinned");
        Check(SetupPolicy.Within(@"C:\Program Files\UFIConnect VPN",@"C:\Program Files\UFIConnect VPN\UFIConnectVpn.exe"),"owned install path");
        Check(!SetupPolicy.Within(@"C:\Program Files\UFIConnect VPN",@"C:\Program Files\UFIConnect VPN-other\payload.exe"),"sibling path rejected");
        Check(!SetupPolicy.Within(@"C:\Program Files\UFIConnect VPN",@"C:\Program Files\UFIConnect VPN\..\payload.exe"),"traversal rejected");
        SetupPolicy.ValidatePackage(SetupPolicy.MsiHash,true,"WireGuard LLC");checks++;
        Reject(()=>SetupPolicy.ValidatePackage(new string('0',64),true,"WireGuard LLC"),"wrong package checksum");
        Reject(()=>SetupPolicy.ValidatePackage(SetupPolicy.MsiHash,false,"WireGuard LLC"),"untrusted signature");
        Reject(()=>SetupPolicy.ValidatePackage(SetupPolicy.MsiHash,true,"Unexpected Publisher"),"wrong signer");
        bool verified=false,installed=false;
        SetupPolicy.InstallOnlyIfApproved(false,()=>verified=true,()=>installed=true);Check(!verified&&!installed,"decline prevents installation");
        Reject(()=>SetupPolicy.InstallOnlyIfApproved(true,()=>SetupPolicy.ValidatePackage(SetupPolicy.MsiHash,false,"WireGuard LLC"),()=>installed=true),"signature failure aborts installer");
        Check(!installed,"failed verification never runs installer");
        SetupPolicy.InstallOnlyIfApproved(true,()=>verified=true,()=>{if(!verified)throw new Exception("unverified launch");installed=true;});Check(installed,"verification precedes approved installation");
        bool unsignedRejected=false;try{Platform.VerifySignature(System.Reflection.Assembly.GetExecutingAssembly().Location);}catch(InvalidOperationException){unsignedRejected=true;}
        Check(unsignedRejected,"Windows trust API rejects this unsigned test binary");
        if(args.Length==1){Platform.VerifySignature(args[0]);SetupPolicy.ValidatePackage(SetupPolicy.Hash(args[0]),true,"WireGuard LLC");checks++;}
        Console.WriteLine(checks+" Windows policy checks passed. No account request, installer, driver, service, or VPN mutation occurred.");return 0;
      }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    }
  }
}
