using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

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
