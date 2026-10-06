using System;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace UfiConnect.Vpn {
  internal static class Program {
    [STAThread] private static int Main(string[] args) {
      if(!Platform.Administrator){MessageBox.Show("UFIConnect VPN needs administrator permission to manage its Windows tunnel.","UFIConnect VPN");return 1;}
      if(args.Length>0&&args[0]=="--watchdog")return Watchdog.Run(args);
      bool created;
      using(var mutex=new Mutex(true,"Global\\UFIConnectManagedVpn",out created)){
        if(!created){MessageBox.Show("UFIConnect VPN is already open.","UFIConnect VPN");return 1;}
        Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);
        try{
          Platform.SafeDirectory(Platform.DataDirectory);
          if(File.Exists(Platform.OwnerFile))Platform.StopOwnedTunnel();
          Platform.ClearSecrets();
          Application.Run(new MainWindow());return 0;
        }catch(Exception){MessageBox.Show("Windows could not prepare secure VPN storage or confirm an earlier tunnel stopped. Open WireGuard and stop UFIConnectManaged before trying again.","UFIConnect VPN");return 1;}
      }
    }
  }
  internal sealed class MainWindow : Form {
    private readonly Controller controller=new Controller();
    private readonly TextBox email=new TextBox(),password=new TextBox();
    private readonly Label status=new Label();
    private readonly Button login=new Button(),connect=new Button(),disconnect=new Button(),logout=new Button();
    private readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer{Interval=1000};
    private bool busy,ticking,closing,closed;
    internal MainWindow(){
      Text="UFIConnect VPN";ClientSize=new Size(520,480);MinimumSize=new Size(536,519);MaximumSize=new Size(700,650);
      BackColor=Color.FromArgb(18,24,33);ForeColor=Color.White;Font=new Font("Segoe UI",10);StartPosition=FormStartPosition.CenterScreen;
      var title=new Label{Text="UFIConnect VPN",Font=new Font("Segoe UI",22,FontStyle.Bold),AutoSize=true,Location=new Point(28,24)};
      var intro=new Label{Text="Connect securely with your paid UFI Vault membership.",AutoSize=true,Location=new Point(30,78)};
      Controls.Add(title);Controls.Add(intro);
      Controls.Add(new Label{Text="Email",AutoSize=true,Location=new Point(30,118)});email.SetBounds(30,145,460,30);email.AccessibleName="UFIConnect email";Controls.Add(email);
      Controls.Add(new Label{Text="Password",AutoSize=true,Location=new Point(30,184)});password.SetBounds(30,211,460,30);password.UseSystemPasswordChar=true;password.AccessibleName="UFIConnect password";Controls.Add(password);
      Configure(login,"Sign in",30,260,110);Configure(connect,"Connect",150,260,110);Configure(disconnect,"Disconnect",270,260,110);Configure(logout,"Sign out",390,260,100);
      status.SetBounds(30,318,460,72);status.Text=controller.Message;status.AccessibleName="VPN connection status";Controls.Add(status);
      var note=new Label{Text="Keep this window open while connected. Closing stops VPN.\nIPv6 traffic is blocked by the gateway.\nRequires official WireGuard for Windows and administrator access.",Location=new Point(30,398),Size=new Size(460,65),ForeColor=Color.LightGray};Controls.Add(note);
      login.Click+=async(sender,args)=>await Action(async()=>{var secret=password.Text;password.Clear();await controller.Login(email.Text.Trim(),secret);});
      connect.Click+=async(sender,args)=>await Action(()=>controller.Connect());
      disconnect.Click+=async(sender,args)=>await Action(()=>controller.Disconnect());
      logout.Click+=async(sender,args)=>await Action(()=>controller.Logout());
      timer.Tick+=async(sender,args)=>{
        if(ticking||closed)return;ticking=true;
        try{await controller.Tick();}catch{if(controller.Active)controller.Message="Waiting for a verified VPN handshake. Authorization remains time limited.";}
        finally{ticking=false;if(!closed)RefreshState();}
      };
      FormClosing+=async(sender,args)=>{
        if(closed)return;args.Cancel=true;if(closing)return;closing=true;Enabled=false;
        try{await controller.Logout();closed=true;timer.Stop();controller.Dispose();Close();}
        catch{closing=false;Enabled=true;MessageBox.Show("Windows could not confirm the VPN stopped. Stop UFIConnectManaged in WireGuard, then close this window.","VPN still stopping");}
      };
      timer.Start();RefreshState();
    }
    private void Configure(Button button,string text,int x,int y,int width){button.Text=text;button.SetBounds(x,y,width,36);button.BackColor=Color.FromArgb(33,110,211);button.ForeColor=Color.White;button.FlatStyle=FlatStyle.Flat;Controls.Add(button);}
    private async Task Action(Func<Task> action){if(busy)return;busy=true;RefreshState();try{await action();}catch(ApiError error){controller.Message=error.Message;}catch(InvalidOperationException error){controller.Message=error.Message;}catch{controller.Message="VPN could not complete this request. Check your connection and try again.";}finally{busy=false;RefreshState();}}
    private void RefreshState(){status.Text=controller.Message;login.Enabled=!busy&&!controller.SignedIn;email.Enabled=login.Enabled;password.Enabled=login.Enabled;connect.Enabled=!busy&&controller.SignedIn&&!controller.Active;disconnect.Enabled=!busy&&controller.Active;logout.Enabled=!busy&&controller.SignedIn;}
  }
}
