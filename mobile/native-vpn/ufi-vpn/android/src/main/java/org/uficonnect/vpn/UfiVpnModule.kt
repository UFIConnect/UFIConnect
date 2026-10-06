package org.uficonnect.vpn

import android.app.Activity
import android.content.Intent
import android.net.VpnService
import android.os.Build
import com.wireguard.crypto.Key
import com.wireguard.crypto.KeyPair
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class UfiVpnModule: Module() {
  private var permission: Promise? = null
  private val context get() = appContext.reactContext ?: throw IllegalStateException("VPN app context unavailable")
  private fun work(promise: Promise, action: () -> Any?) {
    VpnRuntime.executor.execute { try { promise.resolve(action()) } catch (_: Exception) { promise.reject("VPN_REQUEST_FAILED", "VPN could not complete the request", null) } }
  }
  override fun definition() = ModuleDefinition {
    Name("UfiVpn")
    AsyncFunction("prepare") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) promise.reject("VPN_PERMISSION", "Open the app to allow VPN", null)
      else activity.runOnUiThread {
        val intent = VpnService.prepare(activity)
        if (intent == null) promise.resolve(true)
        else if (permission != null) promise.reject("VPN_BUSY", "VPN permission is already requested", null)
        else { permission = promise; activity.startActivityForResult(intent, 4817) }
      }
    }
    OnActivityResult { _, (code, result, _) ->
      if (code == 4817) { val pending = permission; permission = null
        if (result == Activity.RESULT_OK) pending?.resolve(true) else pending?.reject("VPN_PERMISSION", "VPN permission was declined", null)
      }
    }
    AsyncFunction("createIdentity") { promise: Promise -> work(promise) {
      check(VpnRuntime.state == "down")
      val pair = KeyPair()
      VpnSecrets.write(context, JSONObject().put("privateKey", pair.privateKey.toBase64()))
      mapOf("publicKey" to pair.publicKey.toBase64())
    } }
    AsyncFunction("connect") { text: String, token: String, promise: Promise -> work(promise) {
      check(text.length < 65536 && token.isNotEmpty() && token.length < 16384 && VpnService.prepare(context) == null)
      val stored = VpnSecrets.read(context)
      val lease = VpnLease(JSONObject(text), Key.fromBase64(stored.getString("privateKey")))
      stored.put("lease", lease.json).put("session", token); VpnSecrets.write(context, stored)
      val generation = VpnRuntime.generation.incrementAndGet(); VpnRuntime.state = "starting"; VpnRuntime.lease = lease
      val start = Intent(context, UfiVpnService::class.java).setAction("org.uficonnect.vpn.START").putExtra("generation", generation)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(start) else context.startService(start)
      null
    } }
    AsyncFunction("disconnect") { promise: Promise ->
      // Invalidate a queued start before the serialized stop runs.
      VpnRuntime.generation.incrementAndGet()
      VpnRuntime.renewalConnection?.disconnect()
      work(promise) { VpnRuntime.stop(context); null }
    }
    AsyncFunction("status") { promise: Promise -> work(promise) { VpnRuntime.status() } }
    OnDestroy { permission?.reject("VPN_CANCELLED", "VPN permission request cancelled", null); permission = null }
  }
}
